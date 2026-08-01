import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "oneaiworkers-w-gateway-"));

await build({
  entryPoints: { gateway: path.join(root, "src", "w-gateway", "index.ts") },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  external: ["cloudflare:*"],
  outdir: outputDirectory,
});

const gateway = await import(pathToFileURL(path.join(outputDirectory, "gateway.js")));
const database = new DatabaseSync(":memory:");
database.exec("PRAGMA foreign_keys = ON");
const d1 = d1Adapter(database);
const env = {
  OAUTH_DB: d1,
  AI: {
    async run(_model, input) {
      const values = Array.isArray(input.text) ? input.text : [input.text];
      return { data: values.map(testEmbedding), shape: [values.length, 24] };
    },
  },
};
const request = new Request("https://worker.example/mcp", {
  headers: {
    authorization: "Bearer test-user-token",
    "mcp-session-id": "test-session-0001",
  },
});
const context = {
  tenantId: "default",
  userId: await userIdFor("test-user-token"),
  endpointId: "meta:/mcp",
  sessionId: "test-session-0001",
  exposureMode: "meta",
  baseUrl: "https://worker.example",
};

test.after(() => {
  database.close();
  fs.rmSync(outputDirectory, { recursive: true, force: true });
});

test("meta mode always exposes exactly the six stable W tools", async () => {
  const serverWithoutDatabase = await gateway.createWGatewayServer({}, request);
  assert.equal(
    Object.keys(serverWithoutDatabase._registeredTools).length,
    6,
    "building tools/list must not read or initialize the plugin registry",
  );

  const server = await gateway.createWGatewayServer(env, request);
  assert.deepEqual(
    Object.keys(server._registeredTools).sort(),
    ["w_agent_run", "w_call", "w_describe", "w_present", "w_result_read", "w_search"],
  );

  const before = Object.keys(server._registeredTools).sort();
  await gateway.syncWRegistry(env, { force: true, embeddings: false });
  await seedLegacyPlugin(d1);
  const afterServer = await gateway.createWGatewayServer(env, request);
  assert.deepEqual(Object.keys(afterServer._registeredTools).sort(), before);
});

test("registry normalizes installed actions into immutable plugin tool references", async () => {
  const result = await gateway.syncWRegistry(env, { force: true, embeddings: true, clusters: true });
  assert.equal(result.changed, true);
  const row = await d1.prepare(
    "SELECT tool_ref FROM w_tools WHERE tool_ref LIKE 'sample:%' AND enabled = 1",
  ).first();
  assert.equal(row.tool_ref, "sample:api/items-list@1.0.0");

  const pluginKind = await d1.prepare(
    "SELECT kind FROM w_capabilities WHERE plugin_version_id = 'sample@1.0.0'",
  ).first();
  assert.equal(pluginKind.kind, "plugin");
});

test("a validated executable skill becomes searchable and uses its fixed runtime", async () => {
  const admin = await gateway.createWAdminServer(env, request);
  const manifest = executableSkillManifest();
  const validated = await admin._registeredTools.w_plugin_validate.handler({ manifest });
  assert.equal(validated.structuredContent.data.ok, true);
  const imported = await admin._registeredTools.w_plugin_import.handler({ manifest });
  assert.equal(imported.structuredContent.data.callable_tools, 1);
  const published = await admin._registeredTools.w_plugin_publish.handler({ plugin_id: "project-helper", version: "1.0.0" });
  assert.equal(published.structuredContent.data.status, "published");

  const found = await gateway.wSearch(env, context, {
    query: "create a project plan",
    limit: 8,
    filters: { connected_only: false, target: "oneaiworkers-cloudflare" },
  });
  assert.ok(found.results.some((item) => item.tool_ref === "project-helper:planning/request_plan@1.0.0"));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => Response.json({ received: JSON.parse(init.body) });
  try {
    const called = await gateway.wCall(env, context, {
      tool_ref: "project-helper:planning/request_plan@1.0.0",
      arguments: { task: "Plan the migration" },
    });
    assert.equal(called.ok, true, JSON.stringify(called));
    const received = JSON.parse(called.result.response.json_preview.received.input);
    assert.equal(received.mode, "request_plan");
    assert.equal(received.task, "Plan the migration");
    const audit = await d1.prepare(
      "SELECT http_status FROM w_execution_events WHERE tool_ref = ? ORDER BY created_at DESC LIMIT 1",
    ).bind("project-helper:planning/request_plan@1.0.0").first();
    assert.equal(audit.http_status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an instructional skill stays non-callable", async () => {
  const admin = await gateway.createWAdminServer(env, request);
  const manifest = {
    format: "oneai.plugin.v1",
    id: "guide-only",
    name: "Guide only",
    version: "1.0.0",
    targets: ["oneaiworkers-cloudflare"],
    capabilities: [{ kind: "skill", id: "guide", artifact: "skills/guide/SKILL.md" }],
  };
  const imported = await admin._registeredTools.w_plugin_import.handler({ manifest });
  assert.equal(imported.structuredContent.data.callable_tools, 0);
});

test("published plugin versions are immutable and rollback selects one version", async () => {
  const admin = await gateway.createWAdminServer(env, request);
  const changedSameVersion = executableSkillManifest();
  changedSameVersion.description = "Changed after publication";
  const refused = await admin._registeredTools.w_plugin_import.handler({ manifest: changedSameVersion });
  assert.equal(refused.structuredContent.data.ok, false);

  const nextVersion = executableSkillManifest();
  nextVersion.version = "1.1.0";
  await admin._registeredTools.w_plugin_import.handler({ manifest: nextVersion });
  await admin._registeredTools.w_plugin_publish.handler({ plugin_id: "project-helper", version: "1.1.0" });
  let current = await gateway.wSearch(env, context, {
    query: "create a project plan",
    filters: { connected_only: false, target: "oneaiworkers-cloudflare" },
  });
  assert.ok(current.results.some((item) => item.tool_ref.endsWith("@1.1.0")));
  assert.equal(current.results.some((item) => item.plugin_id === "project-helper" && item.tool_ref.endsWith("@1.0.0")), false);

  await admin._registeredTools.w_plugin_rollback.handler({ plugin_id: "project-helper", version: "1.0.0" });
  current = await gateway.wSearch(env, context, {
    query: "create a project plan",
    filters: { connected_only: false, target: "oneaiworkers-cloudflare" },
  });
  assert.ok(current.results.some((item) => item.tool_ref.endsWith("@1.0.0")));
  assert.equal(current.results.some((item) => item.plugin_id === "project-helper" && item.tool_ref.endsWith("@1.1.0")), false);
});

test("empty search returns an overview and normal search omits full schemas", async () => {
  const overview = await gateway.wSearch(env, context, {
    query: "",
    limit: 20,
    filters: { connected_only: false, target: "oneaiworkers-cloudflare" },
  });
  assert.ok(overview.plugins.some((item) => item.plugin_id === "sample"));

  const result = await gateway.wSearch(env, context, {
    query: "show sample items",
    limit: 8,
    filters: { connected_only: false, target: "oneaiworkers-cloudflare" },
  });
  const sample = result.results.find((item) => item.plugin_id === "sample");
  assert.ok(sample);
  assert.equal(sample.tool_ref, "sample:api/items-list@1.0.0");
  assert.equal("input_schema" in sample, false);
  assert.equal("output_schema" in sample, false);
});

test("discovery permissions are applied before lexical and vector search", async () => {
  const beforeRevision = await gateway.catalogRevision?.(env) ?? Number((await d1.prepare("SELECT value FROM w_meta WHERE key = 'catalog_revision'").first()).value);
  await d1.prepare(
    "INSERT INTO w_endpoint_permissions (endpoint_id, subject_type, subject_id, permission) VALUES (?, 'plugin', 'oneaiworkers', 'discover')",
  ).bind(context.endpointId).run();
  const result = await gateway.wSearch(env, context, {
    query: "sample items",
    limit: 8,
    filters: { connected_only: false, target: "oneaiworkers-cloudflare" },
  });
  assert.equal(result.results.some((item) => item.plugin_id === "sample"), false);
  const restrictedRevision = Number((await d1.prepare("SELECT value FROM w_meta WHERE key = 'catalog_revision'").first()).value);
  assert.equal(restrictedRevision, beforeRevision + 1);
  await d1.prepare("DELETE FROM w_endpoint_permissions WHERE endpoint_id = ? AND permission = 'discover'")
    .bind(context.endpointId).run();
  const restoredRevision = Number((await d1.prepare("SELECT value FROM w_meta WHERE key = 'catalog_revision'").first()).value);
  assert.equal(restoredRevision, restrictedRevision + 1);
});

test("plugin connection state is isolated by tenant, user, and granted scopes", async () => {
  const toolRef = "sample:api/items-list@1.0.0";
  await d1.prepare("UPDATE w_tools SET connection_type = 'sample', required_scopes_json = '[\"items.read\"]' WHERE tool_ref = ?")
    .bind(toolRef).run();
  const now = new Date().toISOString();
  await d1.prepare(
    `INSERT INTO w_connections
       (id, tenant_id, user_id, plugin_id, connection_type, display_name, auth_type,
        encrypted_credentials, granted_scopes_json, status, credential_version, created_at, updated_at)
     VALUES ('conn_foreign', 'other', NULL, 'sample', 'sample', 'Foreign', 'test', '{}', '["items.read"]', 'active', 1, ?, ?)`,
  ).bind(now, now).run();
  let result = await gateway.wSearch(env, context, {
    query: "show sample items",
    filters: { connected_only: true, target: "oneaiworkers-cloudflare" },
  });
  assert.equal(result.results.some((item) => item.tool_ref === toolRef), false);

  await d1.prepare(
    `INSERT INTO w_connections
       (id, tenant_id, user_id, plugin_id, connection_type, display_name, auth_type,
        encrypted_credentials, granted_scopes_json, status, credential_version, created_at, updated_at)
     VALUES ('conn_wrong_user', 'default', 'user_someone_else', 'sample', 'sample', 'Wrong user', 'test', '{}', '["items.read"]', 'active', 1, ?, ?)`,
  ).bind(now, now).run();
  result = await gateway.wSearch(env, context, {
    query: "show sample items",
    filters: { connected_only: true, target: "oneaiworkers-cloudflare" },
  });
  assert.equal(result.results.some((item) => item.tool_ref === toolRef), false);

  await d1.prepare(
    `INSERT INTO w_connections
       (id, tenant_id, user_id, plugin_id, connection_type, display_name, auth_type,
        encrypted_credentials, granted_scopes_json, status, credential_version, created_at, updated_at)
     VALUES ('conn_current', 'default', ?, 'sample', 'sample', 'Current user', 'test', '{}', '[]', 'active', 1, ?, ?)`,
  ).bind(context.userId, now, now).run();
  await assert.rejects(
    gateway.wCall(env, context, { tool_ref: toolRef, arguments: {} }),
    /additional account permissions/u,
  );
  await d1.prepare("UPDATE w_connections SET granted_scopes_json = '[\"items.read\"]' WHERE id = 'conn_current'").run();
  result = await gateway.wSearch(env, context, {
    query: "show sample items",
    filters: { connected_only: true, target: "oneaiworkers-cloudflare" },
  });
  assert.equal(result.results.some((item) => item.tool_ref === toolRef), true);

  await d1.prepare("DELETE FROM w_connections WHERE id IN ('conn_foreign', 'conn_wrong_user', 'conn_current')").run();
  await d1.prepare("UPDATE w_tools SET connection_type = NULL, required_scopes_json = '[]' WHERE tool_ref = ?").bind(toolRef).run();
});

test("describe permissions hide schemas from forbidden plugins", async () => {
  const server = await gateway.createWGatewayServer(env, request);
  await d1.prepare(
    "INSERT INTO w_endpoint_permissions (endpoint_id, subject_type, subject_id, permission) VALUES (?, 'plugin', 'oneaiworkers', 'describe')",
  ).bind(context.endpointId).run();
  const response = await server._registeredTools.w_describe.handler({
    tool_refs: ["sample:api/items-list@1.0.0"],
  });
  assert.equal(response.structuredContent.data.tools.length, 0);
  assert.equal(response.structuredContent.data.errors[0].code, "permission_denied");
  await d1.prepare("DELETE FROM w_endpoint_permissions WHERE endpoint_id = ? AND permission = 'describe'")
    .bind(context.endpointId).run();
});

test("execution rejects arbitrary fields before the runtime router", async () => {
  const result = await gateway.wCall(env, context, {
    tool_ref: "sample:api/items-list@1.0.0",
    arguments: { arbitrary_url: "https://attacker.example" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_arguments");
});

test("execute permission is checked by both W calls and direct compatibility calls", async () => {
  await d1.prepare(
    "INSERT INTO w_endpoint_permissions (endpoint_id, subject_type, subject_id, permission) VALUES (?, 'plugin', 'oneaiworkers', 'execute')",
  ).bind(context.endpointId).run();
  await assert.rejects(
    gateway.wCall(env, context, { tool_ref: "sample:api/items-list@1.0.0", arguments: {} }),
    /Permission denied/u,
  );
  await assert.rejects(
    gateway.wCallLegacyAction(env, context, { plugin_id: "sample", action_name: "items-list", arguments: {} }),
    /Permission denied/u,
  );
  await d1.prepare("DELETE FROM w_endpoint_permissions WHERE endpoint_id = ? AND permission = 'execute'")
    .bind(context.endpointId).run();
});

test("an expired search id grants no execution access", async () => {
  const expired = "ws_expired_test";
  await d1.prepare(
    `INSERT INTO w_search_sessions
       (id, tenant_id, user_id, endpoint_id, catalog_revision, tool_refs_json, created_at, expires_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
  ).bind(expired, context.tenantId, context.userId, context.endpointId,
    JSON.stringify(["sample:api/items-list@1.0.0"]), new Date(Date.now() - 120_000).toISOString(), new Date(Date.now() - 60_000).toISOString()).run();
  await assert.rejects(
    gateway.wCall(env, context, { tool_ref: "sample:api/items-list@1.0.0", arguments: {}, search_id: expired }),
    /expired|another user/u,
  );
});

test("disabled tools never return through semantic search", async () => {
  await d1.prepare("UPDATE w_tools SET enabled = 0 WHERE tool_ref = 'sample:api/items-list@1.0.0'").run();
  const hidden = await gateway.wSearch(env, context, {
    query: "show sample items",
    filters: { connected_only: false, target: "oneaiworkers-cloudflare" },
  });
  assert.equal(hidden.results.some((item) => item.tool_ref === "sample:api/items-list@1.0.0"), false);
  await d1.prepare("UPDATE w_tools SET enabled = 1 WHERE tool_ref = 'sample:api/items-list@1.0.0'").run();
});

test("confirmation tokens are bound to the user, operation, and unchanged arguments", async () => {
  const toolRef = await firstConfirmationTool(d1);
  const argumentsValue = validArgumentsFor(toolRef);
  const first = await gateway.wCall(env, context, { tool_ref: toolRef, arguments: argumentsValue });
  assert.equal(first.confirmation_required, true, JSON.stringify(first));
  assert.match(first.confirmation_token, /^[A-Za-z0-9_-]{20,}$/u);
  assert.equal(first.confirmation_url, `https://worker.example/confirm/${first.confirmation_token}`);

  const selfApproved = await gateway.wCall(env, context, {
    tool_ref: toolRef,
    arguments: argumentsValue,
    confirmation_token: first.confirmation_token,
  });
  assert.equal(selfApproved.confirmation_required, true, "A token returned to an agent must not approve its own action.");

  const browser = await gateway.openConfirmationApproval(env, first.confirmation_token);
  assert.ok(browser);
  const approved = await gateway.approveConfirmation(env, first.confirmation_token, browser.browserNonce);
  assert.equal(approved.ok, true);
  const afterHumanApproval = await gateway.wCall(env, context, {
    tool_ref: toolRef,
    arguments: argumentsValue,
    confirmation_token: first.confirmation_token,
  });
  assert.notEqual(afterHumanApproval.confirmation_required, true);

  const changed = await gateway.wCall(env, context, {
    tool_ref: toolRef,
    arguments: { ...argumentsValue, unexpected: true },
    confirmation_token: first.confirmation_token,
  });
  assert.equal(changed.ok, false);
  assert.equal(changed.error.code, "invalid_arguments");

  const otherUser = { ...context, userId: "user_someone_else" };
  const other = await gateway.wCall(env, otherUser, {
    tool_ref: toolRef,
    arguments: argumentsValue,
    confirmation_token: first.confirmation_token,
  });
  assert.equal(other.confirmation_required, true);
  assert.notEqual(other.confirmation_token, first.confirmation_token);
});

test("the public MCP response preserves the one-time confirmation token", async () => {
  const server = await gateway.createWGatewayServer(env, request);
  const toolRef = await firstConfirmationTool(d1);
  const response = await server._registeredTools.w_call.handler({
    tool_ref: toolRef,
    arguments: validArgumentsFor(toolRef),
  });
  assert.equal(response.structuredContent.data.confirmation_required, true);
  assert.match(response.structuredContent.data.confirmation_token, /^[A-Za-z0-9_-]{20,}$/u);
  assert.notEqual(response.structuredContent.data.confirmation_token, "[redacted]");
});

test("large result references cannot be read by another tenant or session", async () => {
  const now = new Date();
  const expires = new Date(now.getTime() + 60_000);
  await d1.prepare("INSERT INTO w_result_payloads (storage_key, payload_json) VALUES ('payload-test', ?)")
    .bind(JSON.stringify({ data: { items: [1, 2, 3] } })).run();
  await d1.prepare(
    `INSERT INTO w_result_refs
       (id, tenant_id, user_id, endpoint_id, session_id, content_type, storage_type,
        storage_key, original_chars, content_hash, created_at, expires_at)
     VALUES ('wres_test', ?, ?, ?, ?, 'application/json', 'd1', 'payload-test', 30, 'hash', ?, ?)`,
  ).bind(context.tenantId, context.userId, context.endpointId, context.sessionId, now.toISOString(), expires.toISOString()).run();

  const own = await gateway.readStoredResult(env, context, { result_id: "wres_test", pointer: "/data/items", limit: 2 });
  assert.deepEqual(own.data, [1, 2]);
  const foreign = await gateway.readStoredResult(env, { ...context, tenantId: "other" }, { result_id: "wres_test" });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.error.code, "result_unavailable");
});

test("large-result reads remain bounded even when selected items are huge", async () => {
  const now = new Date();
  const expires = new Date(now.getTime() + 60_000);
  const payload = { data: { items: Array.from({ length: 60 }, (_, index) => ({ index, body: "x".repeat(20_000) })) } };
  await d1.prepare("INSERT INTO w_result_payloads (storage_key, payload_json) VALUES ('payload-bounded', ?)")
    .bind(JSON.stringify(payload)).run();
  await d1.prepare(
    `INSERT INTO w_result_refs
       (id, tenant_id, user_id, endpoint_id, session_id, content_type, storage_type,
        storage_key, original_chars, content_hash, created_at, expires_at)
     VALUES ('wres_bounded', ?, ?, ?, ?, 'application/json', 'd1', 'payload-bounded', 1200000, 'hash', ?, ?)`,
  ).bind(context.tenantId, context.userId, context.endpointId, context.sessionId, now.toISOString(), expires.toISOString()).run();

  const result = await gateway.readStoredResult(env, context, {
    result_id: "wres_bounded",
    pointer: "/data/items",
    limit: 50,
  });
  assert.equal(result.ok, true);
  assert.ok(JSON.stringify(result).length < 14_000);
});

test("search and execution logs store hashes instead of raw inputs", async () => {
  const secretText = "credential-value-that-must-not-appear";
  await gateway.wSearch(env, context, {
    query: `find items ${secretText}`,
    filters: { connected_only: false, target: "oneaiworkers-cloudflare" },
  });
  const searchLog = await d1.prepare("SELECT query_hash, query_text_redacted FROM w_search_events ORDER BY created_at DESC LIMIT 1").first();
  assert.ok(searchLog.query_hash);
  assert.equal(searchLog.query_text_redacted, null);
  assert.equal(JSON.stringify(searchLog).includes(secretText), false);
});

test("query embeddings never receive credentials pasted into search", async () => {
  const syntheticSecret = ["sk", "query-secret-value-1234567890"].join("-");
  const seen = [];
  const originalRun = env.AI.run;
  env.AI.run = async (_model, input) => {
    seen.push(...(Array.isArray(input.text) ? input.text : [input.text]));
    return { data: (Array.isArray(input.text) ? input.text : [input.text]).map(testEmbedding) };
  };
  try {
    await gateway.wSearch(env, context, {
      query: `find items Authorization: Bearer ${syntheticSecret}`,
      filters: { connected_only: false, target: "oneaiworkers-cloudflare" },
    });
  } finally {
    env.AI.run = originalRun;
  }
  assert.equal(seen.join(" ").includes("query-secret-value"), false);
  assert.match(seen.join(" "), /\[redacted\]/u);
});

test("plugin search documents and embeddings never contain secret values", async () => {
  const admin = await gateway.createWAdminServer(env, request);
  const manifest = executableSkillManifest();
  manifest.id = "secret-safe-plugin";
  manifest.name = "Secret-safe plugin";
  const syntheticSecret = ["sk", "example-secret-value-1234567890"].join("-");
  manifest.description = `Accidental key ${syntheticSecret}`;
  manifest.capabilities[0].description = "Authorization: Bearer hidden-token-value";
  manifest.capabilities[0].api_contract.methods[0].description = "password=must-not-be-indexed";
  manifest.capabilities[0].api_contract.methods[0].aliases = ["api_key=alias-must-not-be-indexed"];
  await admin._registeredTools.w_plugin_import.handler({ manifest });
  await admin._registeredTools.w_plugin_publish.handler({ plugin_id: manifest.id, version: manifest.version });

  const rows = await d1.prepare(
    `SELECT p.description AS plugin_description, c.description AS capability_description,
            t.title, t.description, t.search_text, f.aliases, f.search_text AS fts_search_text
     FROM w_tools t
     JOIN w_capabilities c ON c.id = t.capability_id
     JOIN w_plugin_versions pv ON pv.id = c.plugin_version_id
     JOIN w_plugins p ON p.id = pv.plugin_id
     JOIN w_tool_fts f ON f.tool_ref = t.tool_ref
     WHERE t.tool_ref LIKE 'secret-safe-plugin:%'`,
  ).all();
  const serialized = JSON.stringify(rows.results || []);
  assert.equal(serialized.includes("example-secret-value"), false);
  assert.equal(serialized.includes("hidden-token-value"), false);
  assert.equal(serialized.includes("must-not-be-indexed"), false);
  assert.equal(serialized.includes("alias-must-not-be-indexed"), false);
  assert.match(serialized, /\[redacted\]/u);
});

async function seedLegacyPlugin(db) {
  const now = Math.floor(Date.now() / 1_000);
  await db.prepare(
    `INSERT INTO connectors
       (connector_id, name, description, mode, child_worker_url, child_worker_binding,
        child_worker_token_secret, child_worker_token_credential, enabled, created_at, updated_at)
     VALUES ('sample', 'Sample', 'Lists sample records.', 'internal', NULL, NULL, NULL, NULL, 1, ?, ?)`,
  ).bind(now, now).run();
  await db.prepare(
    `INSERT INTO connector_actions
       (connector_id, action_name, description, method, url, auth_json, headers_json,
        query_json, body_template_json, input_schema_json, created_at, updated_at)
     VALUES ('sample', 'skill-run', 'Run a fixed skill operation.', 'POST', 'https://api.example.com/skill',
       '{"type":"none"}', '{"content-type":"application/json"}', '{}', '{"input":"{{input}}"}',
       '{"type":"object","properties":{"input":{"type":"object","properties":{"mode":{"type":"string"},"task":{"type":"string"}},"required":["mode","task"],"additionalProperties":true}},"required":["input"],"additionalProperties":false}', ?, ?)`,
  ).bind(now, now).run();
  await db.prepare(
    `INSERT INTO connector_actions
       (connector_id, action_name, description, method, url, auth_json, headers_json,
        query_json, body_template_json, input_schema_json, created_at, updated_at)
     VALUES ('sample', 'items-list', 'List sample items.', 'GET', 'https://api.example.com/items',
       '{"type":"none"}', '{}', '{}', NULL,
       '{"type":"object","properties":{"limit":{"type":"integer","minimum":1,"maximum":50}},"additionalProperties":false}', ?, ?)`,
  ).bind(now, now).run();
  await db.prepare(
    `INSERT INTO connector_packages
       (connector_id, package_id, target_id, installed_version, checksum, child_script_name,
        credential_fields_json, catalog_url, installed_at, updated_at)
     VALUES ('sample', 'sample', 'cloudflare-worker', '1.0.0', 'sha256:test', NULL, '[]',
       'https://marketplace.example/api/catalog', ?, ?)`,
  ).bind(now, now).run();
}

function executableSkillManifest() {
  return {
    format: "oneai.plugin.v1",
    id: "project-helper",
    name: "Project helper",
    version: "1.0.0",
    description: "Creates project plans.",
    targets: ["oneaiworkers-cloudflare"],
    capabilities: [{
      kind: "skill",
      id: "planning",
      title: "Project planning",
      artifact: "skills/planning/SKILL.md",
      api: "skills/planning/skill-api.json",
      runtime: { plugin_id: "sample", operation: "skill-run", argument_root: "input" },
      api_contract: {
        format: "oneai.skill-api.v1",
        runtime: "javascript",
        entry: "scripts/runner.js",
        methods: [{
          name: "request_plan",
          description: "Create a deterministic project plan.",
          dispatch: { "input.mode": "request_plan" },
          input_schema: {
            type: "object",
            properties: { task: { type: "string", minLength: 1 } },
            required: ["task"],
            additionalProperties: false,
          },
          output_schema: { type: "object" },
          annotations: { read_only: true, destructive: false, requires_confirmation: false, idempotent: true },
          aliases: ["create project plan", "план проєкту"],
        }],
      },
    }],
  };
}

async function firstConfirmationTool(db) {
  const row = await db.prepare(
    "SELECT tool_ref FROM w_tools WHERE tool_ref LIKE 'oneaiworkers:workers-ai/ai_chat@%' AND requires_confirmation = 1 AND enabled = 1 LIMIT 1",
  ).first();
  assert.ok(row?.tool_ref);
  return row.tool_ref;
}

function validArgumentsFor(toolRef) {
  if (toolRef.includes("ai_chat")) {
    return { profile: "fast", messages: [{ role: "user", content: "Hello" }], max_tokens: 64, temperature: 0.2 };
  }
  if (toolRef.includes("agent_team_propose")) {
    return { task: "Test", max_agents: 2, priority: "balanced", max_rounds: 1, expected_input_tokens_per_call: 1000, expected_output_tokens_per_call: 400 };
  }
  return {};
}

function testEmbedding(value) {
  const vector = new Array(24).fill(0);
  for (const word of String(value).toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []) {
    let hash = 2166136261;
    for (const char of word) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
    vector[(hash >>> 0) % vector.length] += 1;
  }
  if (!vector.some(Boolean)) vector[0] = 1;
  return vector;
}

async function userIdFor(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return `user_${Buffer.from(digest).toString("base64url").slice(0, 24)}`;
}

function d1Adapter(sqlite) {
  return {
    prepare(sql) {
      return new D1Statement(sqlite, sql, []);
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
}

class D1Statement {
  constructor(sqlite, sql, values) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new D1Statement(this.sqlite, this.sql, values.map(sqliteValue));
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
  }

  async all() {
    return { success: true, results: this.sqlite.prepare(this.sql).all(...this.values) };
  }

  async first(column) {
    const row = this.sqlite.prepare(this.sql).get(...this.values) || null;
    return column && row ? row[column] : row;
  }
}

function sqliteValue(value) {
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}
