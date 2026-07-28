import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "oneaiworkers-security-"));

await build({
  entryPoints: {
    security: path.join(root, "src", "security.ts"),
    connectorResponse: path.join(root, "src", "tools", "connectors", "response.ts"),
    connectorTemplates: path.join(root, "src", "tools", "connectors", "templates.ts"),
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outdir: outputDirectory,
});

const security = await import(pathToFileURL(path.join(outputDirectory, "security.js")));
const connectorResponse = await import(pathToFileURL(path.join(outputDirectory, "connectorResponse.js")));
const connectorTemplates = await import(pathToFileURL(path.join(outputDirectory, "connectorTemplates.js")));

test.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));

test("redacts secret values while preserving Cloudflare secret references", () => {
  const telegramToken = ["123456789", "ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghi"].join(":");
  const bearerToken = "bearer-value-that-must-never-be-returned";
  const apiKey = "api-key-value-that-must-never-be-returned";
  const password = "password-value-that-must-never-be-returned";
  const payload = {
    access_token: bearerToken,
    secret_name: "CRM_API_TOKEN",
    child_worker_token_secret: "CHILD_CRM_TOKEN",
    nested: {
      password,
      apiKey,
      endpoint: `https://api.telegram.org/bot${telegramToken}/sendMessage?api_key=${apiKey}`,
    },
    safe_value: "hello",
  };

  const redacted = security.redactSensitiveValue(payload);
  const serialized = JSON.stringify(redacted);

  assert.equal(redacted.secret_name, "CRM_API_TOKEN");
  assert.equal(redacted.child_worker_token_secret, "CHILD_CRM_TOKEN");
  assert.equal(redacted.safe_value, "hello");
  assert.equal(redacted.access_token, "[redacted]");
  assert.equal(redacted.nested.password, "[redacted]");
  assert.equal(redacted.nested.apiKey, "[redacted]");
  assert.ok(!serialized.includes(telegramToken));
  assert.ok(!serialized.includes(bearerToken));
  assert.ok(!serialized.includes(apiKey));
  assert.ok(!serialized.includes(password));
});

test("connector response never keeps raw JSON secrets", () => {
  const telegramToken = ["987654321", "ZYXWVUTSRQPONMLKJIHGFEDCBA_abcdef"].join(":");
  const opaqueRequestSecret = "opaque-request-secret-without-a-known-prefix";
  const body = JSON.stringify({
    result: {
      authorization: "Bearer abcdefghijklmnopqrstuvwxyz0123456789",
      callback_url: `https://api.telegram.org/bot${telegramToken}/sendMessage`,
      value: opaqueRequestSecret,
    },
  });
  const response = new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  const result = connectorResponse.buildConnectorResponse(response, body, [opaqueRequestSecret]);
  const serialized = JSON.stringify(result);

  assert.ok(!serialized.includes(telegramToken));
  assert.ok(!serialized.includes("abcdefghijklmnopqrstuvwxyz0123456789"));
  assert.ok(!serialized.includes(opaqueRequestSecret));
  assert.ok(serialized.includes("[redacted]"));
});

test("URL templates cannot change the API host", () => {
  assert.throws(
    () => connectorTemplates.validateTemplatedUrl("https://{{host}}/v1/items"),
    /host must be fixed|Адреса API має бути сталою/,
  );
  assert.doesNotThrow(
    () => connectorTemplates.validateTemplatedUrl("https://api.example.com/v1/items/{{id}}?page={{page}}"),
  );
  assert.equal(
    connectorTemplates.redactTemplatedUrl("https://n8n.example/webhook/opaque-credential-value"),
    "https://n8n.example/webhook/[redacted]",
  );
});

test("redirects are rechecked before a request follows them", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, {
    status: 302,
    headers: { location: "https://127.0.0.1/private" },
  });
  try {
    await assert.rejects(
      security.fetchWithSafeRedirects("https://public.example/start"),
      /Private, local|Приватні, локальні/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
