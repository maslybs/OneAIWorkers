import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerPath = path.join(root, "node_modules", ".bin", "wrangler");
const sharedSecret = "oauth-integration-secret-that-is-long-enough";
const callbackUrl = "https://client.example/callback";

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startWorker() {
  const port = await reservePort();
  const persistencePath = fs.mkdtempSync(path.join(os.tmpdir(), "oneaiworkers-oauth-"));
  const child = spawn(wranglerPath, [
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--persist-to",
    persistencePath,
    "--var",
    `MCP_SHARED_SECRET:${sharedSecret}`,
    "--log-level",
    "error",
  ], {
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Worker exited before ready:\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return {
          baseUrl,
          async stop() {
            if (child.exitCode === null) child.kill("SIGTERM");
            await new Promise((resolve) => {
              if (child.exitCode !== null) resolve();
              else child.once("exit", resolve);
            });
            fs.rmSync(persistencePath, { recursive: true, force: true });
          },
        };
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  child.kill("SIGKILL");
  fs.rmSync(persistencePath, { recursive: true, force: true });
  throw new Error(`Worker did not become ready:\n${output}`);
}

function form(fields) {
  return new URLSearchParams(fields);
}

async function registerClient(baseUrl, redirectUris = [callbackUrl]) {
  const response = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "OAuth integration test",
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const payload = await response.json();
  return { response, payload };
}

function authorizationUrl(baseUrl, clientId, overrides = {}) {
  const verifier = "oauth-integration-verifier-0123456789-abcdefghijk";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(`${baseUrl}/oauth/authorize`);
  const values = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: "mcp offline_access",
    resource: `${baseUrl}/mcp`,
    state: "test-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return { url, verifier };
}

async function tokenRequest(baseUrl, fields) {
  const response = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form(fields),
  });
  const payload = await response.json();
  return { response, payload };
}

test("OAuth uses S256, rotates refresh tokens, checks resource, revokes, and rate limits", async (t) => {
  const worker = await startWorker();
  t.after(() => worker.stop());

  const metadataResponse = await fetch(`${worker.baseUrl}/.well-known/oauth-authorization-server`);
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  assert.ok(metadata.grant_types_supported.includes("refresh_token"));
  assert.equal(metadata.revocation_endpoint, `${worker.baseUrl}/oauth/revoke`);

  const invalidRegistration = await registerClient(worker.baseUrl, ["http://public.example/callback"]);
  assert.equal(invalidRegistration.response.status, 400);

  const registration = await registerClient(worker.baseUrl);
  assert.equal(registration.response.status, 201);
  const clientId = registration.payload.client_id;
  assert.ok(clientId);

  const missingPkce = authorizationUrl(worker.baseUrl, clientId, {
    code_challenge: null,
    code_challenge_method: null,
  });
  assert.equal((await fetch(missingPkce.url)).status, 400);

  const invalidScope = authorizationUrl(worker.baseUrl, clientId, { scope: "mcp admin" });
  assert.equal((await fetch(invalidScope.url)).status, 400);

  const invalidResource = authorizationUrl(worker.baseUrl, clientId, {
    resource: "https://other.example/mcp",
  });
  assert.equal((await fetch(invalidResource.url)).status, 400);

  const missingResource = authorizationUrl(worker.baseUrl, clientId, { resource: null });
  assert.equal((await fetch(missingResource.url)).status, 400);

  const authorization = authorizationUrl(worker.baseUrl, clientId);
  const consentPage = await fetch(authorization.url);
  assert.equal(consentPage.status, 200);

  const approval = await fetch(authorization.url, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ secret: sharedSecret }),
  });
  assert.equal(approval.status, 302);
  const redirect = new URL(approval.headers.get("location"));
  assert.equal(redirect.searchParams.get("state"), "test-state");
  const code = redirect.searchParams.get("code");
  assert.ok(code);

  const missingTokenResource = await tokenRequest(worker.baseUrl, {
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: callbackUrl,
    code,
    code_verifier: authorization.verifier,
  });
  assert.equal(missingTokenResource.response.status, 400);

  const issued = await tokenRequest(worker.baseUrl, {
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: callbackUrl,
    resource: `${worker.baseUrl}/mcp`,
    code,
    code_verifier: authorization.verifier,
  });
  assert.equal(issued.response.status, 200);
  assert.equal(issued.payload.expires_in, 3600);
  assert.ok(issued.payload.access_token);
  assert.ok(issued.payload.refresh_token);

  const codeReplay = await tokenRequest(worker.baseUrl, {
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: callbackUrl,
    resource: `${worker.baseUrl}/mcp`,
    code,
    code_verifier: authorization.verifier,
  });
  assert.equal(codeReplay.response.status, 401);

  const headerAccess = await fetch(`${worker.baseUrl}/mcp`, {
    headers: { authorization: `Bearer ${issued.payload.access_token}` },
  });
  assert.notEqual(headerAccess.status, 401);

  const queryAccess = await fetch(
    `${worker.baseUrl}/mcp?access_token=${encodeURIComponent(issued.payload.access_token)}`,
  );
  assert.equal(queryAccess.status, 401);

  const missingRefreshResource = await tokenRequest(worker.baseUrl, {
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: issued.payload.refresh_token,
  });
  assert.equal(missingRefreshResource.response.status, 400);

  const refreshed = await tokenRequest(worker.baseUrl, {
    grant_type: "refresh_token",
    client_id: clientId,
    resource: `${worker.baseUrl}/mcp`,
    refresh_token: issued.payload.refresh_token,
  });
  assert.equal(refreshed.response.status, 200);
  assert.ok(refreshed.payload.access_token);
  assert.ok(refreshed.payload.refresh_token);
  assert.notEqual(refreshed.payload.refresh_token, issued.payload.refresh_token);

  const refreshReplay = await tokenRequest(worker.baseUrl, {
    grant_type: "refresh_token",
    client_id: clientId,
    resource: `${worker.baseUrl}/mcp`,
    refresh_token: issued.payload.refresh_token,
  });
  assert.equal(refreshReplay.response.status, 401);

  const revokeResponse = await fetch(`${worker.baseUrl}/oauth/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ token: refreshed.payload.refresh_token }),
  });
  assert.equal(revokeResponse.status, 200);

  const revokedRefresh = await tokenRequest(worker.baseUrl, {
    grant_type: "refresh_token",
    client_id: clientId,
    resource: `${worker.baseUrl}/mcp`,
    refresh_token: refreshed.payload.refresh_token,
  });
  assert.equal(revokedRefresh.response.status, 401);

  const limitedRegistration = await registerClient(worker.baseUrl, ["https://limited.example/callback"]);
  const limitedClientId = limitedRegistration.payload.client_id;
  const limitedAuthorization = authorizationUrl(worker.baseUrl, limitedClientId, {
    redirect_uri: "https://limited.example/callback",
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failed = await fetch(limitedAuthorization.url, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ secret: "wrong-secret" }),
    });
    assert.equal(failed.status, 401);
  }
  const blocked = await fetch(limitedAuthorization.url, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ secret: "wrong-secret" }),
  });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});
