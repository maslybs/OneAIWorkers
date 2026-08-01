import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { benchmarkIntents, benchmarkTools, negativeIntents } from "../benchmarks/w-search-intents.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "oneaiworkers-w-benchmark-"));
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
const sqlite = new DatabaseSync(":memory:");
const db = d1Adapter(sqlite);
const env = {
  OAUTH_DB: db,
  W_SEMANTIC_PLUGIN_THRESHOLD: "1",
  AI: { run: async (_model, input) => ({ data: (Array.isArray(input.text) ? input.text : [input.text]).map(embedding) }) },
};
const request = new Request("https://worker.example/mcp", { headers: { "mcp-session-id": "benchmark-session" } });
const context = {
  tenantId: "default",
  userId: await userIdFor("benchmark-user"),
  endpointId: "meta:/mcp",
  sessionId: "benchmark-session",
  exposureMode: "meta",
  baseUrl: "https://worker.example",
};

test.before(async () => {
  await gateway.createWGatewayServer(env, request);
  await gateway.syncWRegistry(env, { force: true, embeddings: false });
  await seedBenchmarkRegistry(db);
  const admin = await gateway.createWAdminServer(env, request);
  await admin._registeredTools.w_cluster_rebuild.handler({});
});

test.after(() => {
  sqlite.close();
  fs.rmSync(outputDirectory, { recursive: true, force: true });
});

test("hybrid search meets the 200-intent quality and latency targets", async () => {
  const expectedVector = await db.prepare("SELECT embedding_blob FROM w_tool_vectors WHERE tool_id = 'bench_github_items_create'").first();
  const unrelatedVector = await db.prepare("SELECT embedding_blob FROM w_tool_vectors WHERE tool_id = 'bench_cloudflare_files_download'").first();
  const queryVector = Float32Array.from(embedding("create a new record in GitHub"));
  assert.ok(cosine(queryVector, decodeVector(expectedVector.embedding_blob)) > cosine(queryVector, decodeVector(unrelatedVector.embedding_blob)));
  let top1 = 0;
  let top5 = 0;
  let wrongDestructiveTop1 = 0;
  let nonDestructiveQueries = 0;
  const misses = [];
  const latencies = [];
  for (const intent of benchmarkIntents) {
    const started = performance.now();
    const result = await gateway.wSearch(env, context, {
      query: intent.query,
      limit: 20,
      filters: { connected_only: true, target: "oneaiworkers-cloudflare" },
    });
    latencies.push(performance.now() - started);
    const refs = result.results.slice(0, 5).map((item) => item.tool_ref);
    if (refs[0] === intent.expectedToolRef) top1 += 1;
    if (refs.includes(intent.expectedToolRef)) top5 += 1;
    else misses.push({ id: intent.id, query: intent.query, expected: intent.expectedToolRef, refs, position: result.results.findIndex((item) => item.tool_ref === intent.expectedToolRef), results: result.results.slice(0, 10) });
    if (!intent.expectedDestructive) {
      nonDestructiveQueries += 1;
      if (result.results[0]?.destructive) wrongDestructiveTop1 += 1;
    }
    assert.equal(JSON.stringify(result).includes("input_schema"), false);
  }
  latencies.sort((left, right) => left - right);
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  assert.ok(top5 / benchmarkIntents.length >= 0.90, `top-5 recall was ${top5 / benchmarkIntents.length}; misses: ${JSON.stringify(misses.slice(0, 12))}`);
  assert.ok(top1 / benchmarkIntents.length >= 0.75, `top-1 accuracy was ${top1 / benchmarkIntents.length}`);
  assert.ok(wrongDestructiveTop1 / nonDestructiveQueries <= 0.01, `wrong destructive top-1 was ${wrongDestructiveTop1 / nonDestructiveQueries}`);
  assert.ok(p95 < 1_500, `warm p95 was ${p95.toFixed(1)} ms`);
});

test("an exact operation reference skips vector search even for a large catalog", async () => {
  let calls = 0;
  const originalRun = env.AI.run;
  env.AI.run = async (...args) => {
    calls += 1;
    return originalRun(...args);
  };
  try {
    const result = await gateway.wSearch(env, context, {
      query: benchmarkTools[0].toolRef,
      limit: 5,
      filters: { connected_only: true, target: "oneaiworkers-cloudflare" },
    });
    assert.equal(result.search_mode, "text");
    assert.equal(result.results[0]?.tool_ref, benchmarkTools[0].toolRef);
    assert.equal(calls, 0);
  } finally {
    env.AI.run = originalRun;
  }
});

test("forbidden and disconnected plugins never leak into search", async () => {
  for (const intent of negativeIntents) {
    const result = await gateway.wSearch(env, context, {
      query: intent.query,
      limit: 20,
      filters: { connected_only: true, target: "oneaiworkers-cloudflare" },
    });
    assert.equal(result.results.some((item) => item.plugin_id === intent.forbiddenPlugin), false);
  }
});

async function seedBenchmarkRegistry(database) {
  const now = new Date().toISOString();
  const allowedPlugins = [...new Set(benchmarkTools.map((tool) => tool.pluginId))];
  for (const pluginId of allowedPlugins) {
    const versionId = `${pluginId}@1.0.0`;
    const capabilityId = `${versionId}:api`;
    await database.prepare(
      "INSERT INTO w_plugins (id, name, description, publisher_id, enabled, current_version_id, created_at, updated_at) VALUES (?, ?, ?, 'benchmark', 1, ?, ?, ?)",
    ).bind(pluginId, benchmarkTools.find((tool) => tool.pluginId === pluginId).pluginName, `${pluginId} test plugin`, versionId, now, now).run();
    await database.prepare(
      "INSERT INTO w_plugin_versions (id, plugin_id, version, package_format, package_hash, target_json, manifest_json, status, created_at, published_at) VALUES (?, ?, '1.0.0', 'oneai.plugin.v1', ?, '[\"oneaiworkers-cloudflare\"]', '{}', 'published', ?, ?)",
    ).bind(versionId, pluginId, `hash:${pluginId}`, now, now).run();
    await database.prepare(
      "INSERT INTO w_capabilities (id, plugin_version_id, capability_id, kind, target, title, description, enabled, runtime_type, runtime_config_json, permission_manifest_json, created_at) VALUES (?, ?, 'api', 'plugin', 'oneaiworkers-cloudflare', ?, ?, 1, 'test', '{}', '{}', ?)",
    ).bind(capabilityId, versionId, `${pluginId} API`, `${pluginId} operations`, now).run();
    await database.prepare(
      "INSERT INTO w_endpoint_permissions (endpoint_id, subject_type, subject_id, permission) VALUES (?, 'plugin', ?, 'discover')",
    ).bind(context.endpointId, pluginId).run();
  }

  for (const tool of benchmarkTools) {
    const id = `bench_${tool.pluginId}_${tool.method.replaceAll('.', '_')}`;
    const title = `${tool.pluginName} ${tool.method.replaceAll('.', ' ')}`;
    const text = `${tool.pluginName} ${tool.pluginId} ${tool.method} ${tool.en} ${tool.uk}`;
    const vector = Float32Array.from(embedding(text));
    await database.prepare(
      `INSERT INTO w_tools
         (id, capability_id, tool_ref, method_name, version, title, description, search_text,
          input_schema_json, output_schema_json, execution_plan_json, read_only, destructive,
          idempotent, requires_confirmation, connection_type, required_scopes_json,
          semantic_family, presentation_mode, enabled, status, schema_hash, search_text_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, '1.0.0', ?, ?, ?, '{}', '{}', '{}', ?, ?, ?, ?, NULL, '[]', ?, 'data', 1, 'published', ?, ?, ?, ?)`,
    ).bind(id, `${tool.pluginId}@1.0.0:api`, tool.toolRef, tool.method, title, `${tool.en}; ${tool.uk}`, text,
      tool.readOnly ? 1 : 0, tool.destructive ? 1 : 0, tool.readOnly ? 1 : 0, tool.readOnly ? 0 : 1,
      `${tool.pluginId}:${tool.method.split('.')[0]}`, `schema:${id}`, `search:${id}`, now, now).run();
    await database.prepare(
      "INSERT INTO w_tool_fts (tool_ref, plugin_id, capability_id, title, description, aliases, search_text) VALUES (?, ?, 'api', ?, ?, ?, ?)",
    ).bind(tool.toolRef, tool.pluginId, title, `${tool.en}; ${tool.uk}`, `${tool.en} ${tool.uk}`, text).run();
    await database.prepare(
      "INSERT INTO w_tool_vectors (tool_id, embedding_model, embedding_dimensions, embedding_blob, embedding_norm, embedding_hash, source_text_hash, cluster_id, created_at, updated_at) VALUES (?, '@cf/qwen/qwen3-embedding-0.6b', ?, ?, ?, ?, ?, NULL, ?, ?)",
    ).bind(id, vector.length, new Uint8Array(vector.buffer), norm(vector), `vector:${id}`, `search:${id}`, now, now).run();
  }

  await seedHiddenPlugin(database, "forbidden", false, now);
  await seedHiddenPlugin(database, "disconnected", true, now);
}

async function seedHiddenPlugin(database, pluginId, disconnected, now) {
  const versionId = `${pluginId}@1.0.0`;
  const capabilityId = `${versionId}:api`;
  const toolId = `bench_${pluginId}`;
  await database.prepare("INSERT INTO w_plugins (id, name, description, publisher_id, enabled, current_version_id, created_at, updated_at) VALUES (?, ?, '', 'benchmark', 1, ?, ?, ?)")
    .bind(pluginId, pluginId, versionId, now, now).run();
  await database.prepare("INSERT INTO w_plugin_versions (id, plugin_id, version, package_format, package_hash, target_json, manifest_json, status, created_at, published_at) VALUES (?, ?, '1.0.0', 'oneai.plugin.v1', 'hash', '[\"oneaiworkers-cloudflare\"]', '{}', 'published', ?, ?)")
    .bind(versionId, pluginId, now, now).run();
  await database.prepare("INSERT INTO w_capabilities (id, plugin_version_id, capability_id, kind, target, title, description, enabled, runtime_type, runtime_config_json, permission_manifest_json, created_at) VALUES (?, ?, 'api', 'plugin', 'oneaiworkers-cloudflare', ?, '', 1, 'test', '{}', '{}', ?)")
    .bind(capabilityId, versionId, pluginId, now).run();
  await database.prepare(
    `INSERT INTO w_tools
       (id, capability_id, tool_ref, method_name, version, title, description, search_text,
        input_schema_json, output_schema_json, execution_plan_json, read_only, destructive,
        idempotent, requires_confirmation, connection_type, required_scopes_json,
        semantic_family, presentation_mode, enabled, status, schema_hash, search_text_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'hidden.run', '1.0.0', ?, '', ?, '{}', '{}', '{}', 1, 0, 1, 0, ?, '[]', 'hidden', 'data', 1, 'published', 'schema', 'search', ?, ?)`,
  ).bind(toolId, capabilityId, `${pluginId}:api/hidden.run@1.0.0`, pluginId, `${pluginId} unknown quantum accounting delete everything private service`, disconnected ? pluginId : null, now, now).run();
  await database.prepare("INSERT INTO w_tool_fts (tool_ref, plugin_id, capability_id, title, description, aliases, search_text) VALUES (?, ?, 'api', ?, '', '', ?)")
    .bind(`${pluginId}:api/hidden.run@1.0.0`, pluginId, pluginId, `${pluginId} unknown quantum accounting delete everything private service`).run();
}

function embedding(value) {
  const vector = new Array(256).fill(0);
  for (const word of String(value).toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []) {
    let hash = 2166136261;
    for (const character of word) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
    vector[(hash >>> 0) % vector.length] += 1;
  }
  if (!vector.some(Boolean)) vector[0] = 1;
  return vector;
}

function norm(vector) {
  return Math.sqrt([...vector].reduce((sum, value) => sum + value * value, 0));
}

function decodeVector(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function cosine(left, right) {
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) dot += left[index] * right[index];
  return dot / (norm(left) * norm(right));
}

async function userIdFor(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return `user_${Buffer.from(digest).toString("base64url").slice(0, 24)}`;
}

function d1Adapter(database) {
  return {
    prepare(sql) { return new Statement(database, sql, []); },
    async batch(statements) { const output = []; for (const statement of statements) output.push(await statement.run()); return output; },
  };
}

class Statement {
  constructor(database, sql, values) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.database, this.sql, values.map(sqliteValue)); }
  async run() { const result = this.database.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes || 0) } }; }
  async all() { return { success: true, results: this.database.prepare(this.sql).all(...this.values) }; }
  async first(column) { const row = this.database.prepare(this.sql).get(...this.values) || null; return column && row ? row[column] : row; }
}

function sqliteValue(value) {
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}
