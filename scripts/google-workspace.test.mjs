import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";

const root = process.cwd();
const workerPath = path.join(root, "cloud-connectors/google-workspace/index.mjs");
const manifest = JSON.parse(await fs.readFile(path.join(root, "cloud-connectors/google-workspace/connector.json"), "utf8"));

async function loadWorker(label) {
  return (await import(`${pathToFileURL(workerPath).href}?test=${encodeURIComponent(label)}-${Date.now()}-${Math.random()}`)).default;
}

function callRequest(childToken, name, credentials, args = {}, dryRun = false) {
  return new Request("https://google-workspace.example/tools/call", {
    method: "POST",
    headers: { "content-type": "application/json", "x-oneaiworkers-child-token": childToken },
    body: JSON.stringify({ name, arguments: args, credentials, dry_run: dryRun }),
  });
}

test("Google Workspace cloud manifest keeps the refresh token managed", () => {
  assert.equal(manifest.id, "google-workspace");
  assert.equal(manifest.runtime, "cloudflare-worker");
  assert.ok(manifest.actions.length >= 30);
  const refreshToken = manifest.credential_fields.find((field) => field.id === "refresh_token");
  assert.equal(refreshToken.required, true);
  assert.equal(refreshToken.managed, true);
});

test("Google Workspace cloud plugin refreshes access and never returns the refresh token", async () => {
  const worker = await loadWorker("refresh");
  const childToken = "child-token-that-is-long-enough-123456789";
  const refreshToken = "refresh-token-that-must-never-be-returned";
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") {
      assert.match(String(init.body), /grant_type=refresh_token/u);
      assert.match(String(init.body), new RegExp(refreshToken));
      return Response.json({ access_token: "short-lived-access-token", expires_in: 3600 });
    }
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer short-lived-access-token");
    return Response.json({ user: { displayName: "Test User" }, storageQuota: { usage: "10" } });
  };
  try {
    const request = callRequest(childToken, "check_connection", {
      client_id: "client-id.apps.googleusercontent.com",
      client_secret: "client-secret",
      refresh_token: refreshToken,
    });
    const response = await worker.fetch(request, { CHILD_TOKEN: childToken });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(body).data.connected, true);
    assert.equal(body.includes(refreshToken), false);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google Workspace cloud plugin refreshes once and retries after a Google 401", async () => {
  const worker = await loadWorker("retry");
  const childToken = "child-token-that-is-long-enough-987654321";
  let tokenCalls = 0;
  let apiCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      tokenCalls += 1;
      return Response.json({ access_token: `access-${tokenCalls}`, expires_in: 3600 });
    }
    apiCalls += 1;
    if (apiCalls === 1) return Response.json({ error: { message: "expired" } }, { status: 401 });
    return Response.json({ user: { displayName: "Recovered" }, storageQuota: {} });
  };
  try {
    const response = await worker.fetch(callRequest(childToken, "check_connection", {
      client_id: "retry.apps.googleusercontent.com",
      client_secret: "secret",
      refresh_token: "refresh-retry",
    }), { CHILD_TOKEN: childToken });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.user.displayName, "Recovered");
    assert.equal(tokenCalls, 2);
    assert.equal(apiCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google Workspace cloud plugin asks for reconnection after invalid_grant", async () => {
  const worker = await loadWorker("invalid-grant");
  const childToken = "child-token-that-is-long-enough-invalid-grant";
  const refreshToken = "revoked-refresh-token-secret";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: "invalid_grant" }, { status: 400 });
  try {
    const response = await worker.fetch(callRequest(childToken, "check_connection", {
      client_id: "invalid.apps.googleusercontent.com",
      client_secret: "secret",
      refresh_token: refreshToken,
    }), { CHILD_TOKEN: childToken });
    const body = await response.text();
    assert.equal(response.status, 401);
    assert.equal(JSON.parse(body).code, "reauthorization_required");
    assert.match(body, /connect Google again/u);
    assert.equal(body.includes(refreshToken), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("managed Google OAuth uses PKCE, offline access, and encrypted state", async () => {
  const source = await fs.readFile(path.join(root, "src/plugin-oauth.ts"), "utf8");
  assert.match(source, /code_challenge_method", "S256"/u);
  assert.match(source, /access_type", "offline"/u);
  assert.match(source, /prompt", "consent select_account"/u);
  assert.match(source, /encryptJson/u);
  assert.match(source, /storeCredentialProfile/u);
  assert.doesNotMatch(source, /access_token:\s*String/u);
});

test("Google plugin rejects direct access without the parent secret", async () => {
  const worker = await loadWorker("protected");
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error("Unexpected Google request"); };
  try {
    for (const token of ["", "wrong-secret"]) {
      const response = await worker.fetch(callRequest(token, "check_connection", {}), { CHILD_TOKEN: "private-parent-secret-that-is-long-enough" });
      assert.equal(response.status, 401);
    }
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google sign-in stores encrypted credentials and rejects reused, invalid, and expired state", async () => {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "oneaiworkers-google-oauth-"));
  const sqlite = new DatabaseSync(":memory:");
  const originalFetch = globalThis.fetch;
  function statement(sql, values = []) {
    return {
      bind(...args) { return statement(sql, args); },
      async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
    };
  }
  try {
    await build({
      entryPoints: { oauth: path.join(root, "src/plugin-oauth.ts"), vault: path.join(root, "src/vault.ts") },
      bundle: true, format: "esm", platform: "node", target: "es2022", outdir: outputDirectory,
    });
    const oauth = await import(pathToFileURL(path.join(outputDirectory, "oauth.js")));
    const vault = await import(pathToFileURL(path.join(outputDirectory, "vault.js")));
    const env = {
      CREDENTIALS_MASTER_KEY: "google-oauth-test-master-key-0123456789abcdef",
      OAUTH_DB: { prepare: statement, async batch(statements) { return Promise.all(statements.map((item) => item.run())); } },
    };
    await vault.storeCredentialProfile(env, "google-workspace", "user", {
      client_id: "test.apps.googleusercontent.com", client_secret: "private-client-secret",
    });
    const authorization = new URL(await oauth.beginManagedPluginOAuth(env, "https://worker.example", "google-workspace", "uk"));
    assert.equal(authorization.searchParams.get("access_type"), "offline");
    assert.equal(authorization.searchParams.get("redirect_uri"), "https://worker.example/plugins/google-workspace/oauth/callback");
    const callback = new URL(authorization.searchParams.get("redirect_uri"));
    callback.searchParams.set("state", authorization.searchParams.get("state"));
    callback.searchParams.set("code", "one-use-google-code");
    let exchanges = 0;
    globalThis.fetch = async (url, init) => {
      exchanges += 1;
      assert.equal(String(url), "https://oauth2.googleapis.com/token");
      const params = new URLSearchParams(init.body);
      assert.equal(params.get("code"), "one-use-google-code");
      assert.ok(params.get("code_verifier"));
      return Response.json({ refresh_token: "private-refresh-token", access_token: "temporary-access-token", expires_in: 3600 });
    };
    assert.deepEqual(await oauth.completeManagedPluginOAuth(env, "google-workspace", callback), { connectorId: "google-workspace", language: "uk" });
    const credentials = await vault.loadCredentialProfile(env, "google-workspace", "user");
    assert.equal(credentials.refresh_token, "private-refresh-token");
    assert.equal(credentials.access_token, undefined);
    const stored = sqlite.prepare("SELECT encrypted_json FROM connector_credentials").get().encrypted_json;
    assert.equal(stored.includes("private-refresh-token"), false);
    assert.equal(stored.includes("private-client-secret"), false);
    await assert.rejects(oauth.completeManagedPluginOAuth(env, "google-workspace", callback), /already used|expired/u);
    callback.searchParams.set("state", "forged-state");
    await assert.rejects(oauth.completeManagedPluginOAuth(env, "google-workspace", callback), /already used|expired/u);
    const expired = new URL(await oauth.beginManagedPluginOAuth(env, "https://worker.example", "google-workspace", "en"));
    sqlite.prepare("UPDATE plugin_oauth_states SET expires_at = 0").run();
    callback.searchParams.set("state", expired.searchParams.get("state"));
    await assert.rejects(oauth.completeManagedPluginOAuth(env, "google-workspace", callback), /already used|expired/u);
    assert.equal(exchanges, 1);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
    await fs.rm(outputDirectory, { recursive: true, force: true });
  }
});
