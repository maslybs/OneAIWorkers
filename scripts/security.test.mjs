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
    response: path.join(root, "src", "response.ts"),
    homeHtml: path.join(root, "src", "html.ts"),
    crypto: path.join(root, "src", "crypto.ts"),
    marketplace: path.join(root, "src", "marketplace.ts"),
    connectorPages: path.join(root, "src", "connector-pages.ts"),
    vault: path.join(root, "src", "vault.ts"),
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outdir: outputDirectory,
});

const security = await import(pathToFileURL(path.join(outputDirectory, "security.js")));
const connectorResponse = await import(pathToFileURL(path.join(outputDirectory, "connectorResponse.js")));
const connectorTemplates = await import(pathToFileURL(path.join(outputDirectory, "connectorTemplates.js")));
const responseHelpers = await import(pathToFileURL(path.join(outputDirectory, "response.js")));
const homeHtmlHelpers = await import(pathToFileURL(path.join(outputDirectory, "homeHtml.js")));
const cryptoHelpers = await import(pathToFileURL(path.join(outputDirectory, "crypto.js")));
const marketplaceHelpers = await import(pathToFileURL(path.join(outputDirectory, "marketplace.js")));
const connectorPageHelpers = await import(pathToFileURL(path.join(outputDirectory, "connectorPages.js")));
const vaultHelpers = await import(pathToFileURL(path.join(outputDirectory, "vault.js")));

test.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));

test("routes protected child Worker calls through the public Cloudflare front door", () => {
  const wranglerConfig = fs.readFileSync(path.join(root, "wrangler.toml"), "utf8");
  assert.match(wranglerConfig, /compatibility_flags\s*=\s*\[[^\]]*"nodejs_compat"[^\]]*"global_fetch_strictly_public"[^\]]*\]/u);
});

test("home page names ChatGPT, Claude, and other MCP-compatible clients", () => {
  const html = homeHtmlHelpers.homeHtml({}, "https://worker.example");
  assert.match(html, /ChatGPT, Claude/u);
  assert.match(html, /other MCP-compatible clients/u);
  assert.match(html, /Streamable HTTP/u);
  assert.match(html, /https:\/\/worker\.example\/mcp/u);
});

test("connector settings links wait for an explicit same-site confirmation", () => {
  const html = connectorPageHelpers.connectorAccessPageHtml("uk");
  assert.match(html, /<form method="post">/u);
  assert.match(html, /Продовжити до налаштувань/u);
  assert.doesNotMatch(html, /http-equiv=["']refresh/u);
  assert.match(vaultHelpers.connectorSessionCookie("test-session"), /SameSite=Lax/u);
});

test("same-origin connector forms accept browser privacy headers without trusting foreign sites", () => {
  const baseUrl = "https://worker.example";
  const formRequest = (headers = {}, url = `${baseUrl}/connectors/access/token`) => new Request(url, {
    method: "POST",
    headers,
  });

  assert.equal(security.isSameOriginFormRequest(formRequest({ origin: baseUrl }), baseUrl), true);
  assert.equal(security.isSameOriginFormRequest(formRequest({ "sec-fetch-site": "same-origin" }), baseUrl), true);
  assert.equal(security.isSameOriginFormRequest(formRequest({ origin: "null", "sec-fetch-site": "same-origin" }), baseUrl), true);
  assert.equal(security.isSameOriginFormRequest(formRequest(), baseUrl), false);
  assert.equal(security.isSameOriginFormRequest(formRequest({ origin: "https://foreign.example", "sec-fetch-site": "cross-site" }), baseUrl), false);
  assert.equal(security.isSameOriginFormRequest(formRequest({ "sec-fetch-site": "same-origin" }, "https://foreign.example/connectors/access/token"), baseUrl), false);
});

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

test("update notices lead with a browser link in text and structured content", () => {
  const updateUrl = "https://worker.example/update";
  const result = responseHelpers.mcpText({
    ok: true,
    data: { result: "regular tool output" },
    update: {
      available: true,
      current_version: "0.6.1",
      latest_version: "0.6.2",
      critical: false,
      update_url: updateUrl,
      message: { en: "Update available.", uk: "Доступне оновлення." },
    },
  });

  const text = result.content[0].text;
  assert.ok(text.startsWith("UPDATE AVAILABLE / ДОСТУПНЕ ОНОВЛЕННЯ"));
  assert.ok(text.indexOf(updateUrl) < text.indexOf("regular tool output"));
  assert.equal(result.structuredContent.user_action_required, true);
  assert.equal(result.structuredContent.update_url, updateUrl);
  assert.equal(result.structuredContent.open_update_url_in_browser, true);
  assert.equal(result.structuredContent.do_not_fetch_update_url_from_a_tool, true);
});

test("encrypts connector credentials with authenticated context", async () => {
  const masterKey = "test-master-key-with-more-than-thirty-two-characters";
  const encrypted = await cryptoHelpers.encryptJson(masterKey, { api_key: "top-secret" }, "connector:n8n:user");
  assert.notEqual(encrypted.ciphertext, "top-secret");
  assert.deepEqual(
    await cryptoHelpers.decryptJson(masterKey, encrypted, "connector:n8n:user"),
    { api_key: "top-secret" },
  );
  await assert.rejects(
    cryptoHelpers.decryptJson(masterKey, encrypted, "connector:other:user"),
  );
});

test("verifies installer tickets with the matching ECDSA public key", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicDer = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const publicPem = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(publicDer).toString("base64")}\n-----END PUBLIC KEY-----`;
  const payload = Buffer.from(JSON.stringify({ aud: "https://worker.example", nonce: "test" })).toString("base64url");
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(payload),
  ));
  const verified = await cryptoHelpers.verifyEcdsaTicket(
    publicPem,
    `${payload}.${Buffer.from(signature).toString("base64url")}`,
  );
  assert.equal(verified.aud, "https://worker.example");
});

test("searches a downloaded marketplace catalog without sending the user query", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const requestOptions = [];
  globalThis.fetch = async (input, init) => {
    requests.push(String(input));
    requestOptions.push(init);
    return Response.json({
      items: [
        {
          id: "n8n",
          type: "connector",
          name: "n8n",
          description: "Workflow automation",
          version: "0.1.0",
          capabilities: ["list workflows", "inspect executions"],
          targets: [{
            id: "cloudflare-worker",
            runtime: "cloudflare-worker",
            version: "0.1.0",
            package_url: "https://marketplace.example/n8n",
            package_format: "oneaiworkers.connector.v1",
            checksum: "sha256:example",
          }],
        },
        {
          id: "local-only",
          type: "connector",
          name: "Local only",
          description: "Inspect workflow executions locally",
          version: "0.1.0",
          targets: [{
            id: "local",
            runtime: "local",
            version: "0.1.0",
            package_url: "https://marketplace.example/local",
            package_format: "oneaihub.connector.v1",
            checksum: "sha256:local",
          }],
        },
        {
          id: "mislabeled",
          type: "connector",
          name: "Mislabeled cloud package",
          description: "Inspect workflow executions",
          version: "0.1.0",
          targets: [{
            id: "cloudflare-worker",
            runtime: "local",
            version: "0.1.0",
            package_url: "https://marketplace.example/mislabeled",
            package_format: "oneaihub.connector.v1",
            checksum: "sha256:mislabeled",
          }],
        },
      ],
    });
  };
  try {
    const result = await marketplaceHelpers.findCapability(
      { MARKETPLACE_CATALOG_URL: "https://marketplace.example/catalog" },
      "https://worker.example",
      { query: "inspect workflow executions", limit: 5, language: "en" },
    );
    assert.equal(result.matches[0].connector_id, "n8n");
    assert.deepEqual(result.matches.map((match) => match.connector_id), ["n8n"]);
    assert.match(result.matches[0].install_url, /^https:\/\/worker\.example\/connectors\/install\/n8n/u);
    assert.equal(result.available, true);
    assert.equal(result.browser_action.type, "install_connector");
    assert.equal(result.browser_action.url, result.matches[0].install_url);
    assert.equal(result.browser_action.open_in_normal_browser, true);
    assert.match(result.credential_next_step, /Never ask for the service key in chat/u);
    await marketplaceHelpers.findCapability(
      { MARKETPLACE_CATALOG_URL: "https://marketplace.example/catalog" },
      "https://worker.example",
      { query: "inspect workflow executions", limit: 5, language: "en" },
    );
    await marketplaceHelpers.findCapability(
      {},
      "https://worker.example",
      { query: "inspect workflow executions", limit: 5, language: "en" },
    );
    assert.deepEqual(requests, [
      "https://marketplace.example/catalog",
      "https://marketplace.example/catalog",
      "https://marketplace.bgdn.dev/api/catalog?target=cloudflare-worker&type=connector",
    ]);
    assert.equal(requestOptions[0].headers["cache-control"], "no-cache");
    assert.equal(requestOptions[0].cf.cacheTtl, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generic connector installation help prevents invented marketplace steps", () => {
  const result = marketplaceHelpers.connectorInstallationHelp({ language: "uk" });
  assert.equal(result.safety.worker_home_has_marketplace_page, false);
  assert.equal(result.safety.never_invent_catalog_items, true);
  assert.equal(result.safety.never_request_credentials_in_chat, true);
  assert.match(result.exact_reply, /^Назвіть сервіс або опишіть дію/u);
  assert.match(result.response_instruction, /Не вигадуйте розділ Marketplace/u);
  assert.equal(result.installation_flow[0], "Після назви сервісу або задачі викликати find_capability.");
});

test("connector installation result puts the exact browser link first", () => {
  const installUrl = "https://worker.example/connectors/install/n8n?lang=uk";
  const result = responseHelpers.mcpText({
    ok: true,
    data: {
      browser_action: {
        type: "install_connector",
        url: installUrl,
        response_instruction: "Use the exact link.",
      },
      matches: [{ connector_id: "n8n", install_url: installUrl }],
    },
  });
  assert.ok(result.content[0].text.startsWith(installUrl));
  assert.equal(result.structuredContent.user_action_required, true);
  assert.equal(result.structuredContent.install_url, installUrl);
  assert.equal(result.structuredContent.open_install_url_in_browser, true);
  assert.equal(result.structuredContent.do_not_fetch_install_url_from_a_tool, true);
});
