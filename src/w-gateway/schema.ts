import type { Env } from "../types";

let schemaReady: Promise<void> | null = null;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS w_plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    publisher_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    current_version_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS w_plugin_versions (
    id TEXT PRIMARY KEY,
    plugin_id TEXT NOT NULL,
    version TEXT NOT NULL,
    package_format TEXT NOT NULL,
    package_hash TEXT NOT NULL,
    target_json TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    published_at TEXT,
    UNIQUE(plugin_id, version),
    FOREIGN KEY(plugin_id) REFERENCES w_plugins(id)
  )`,
  `CREATE TABLE IF NOT EXISTS w_capabilities (
    id TEXT PRIMARY KEY,
    plugin_version_id TEXT NOT NULL,
    capability_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    runtime_type TEXT,
    runtime_config_json TEXT,
    permission_manifest_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(plugin_version_id, capability_id),
    FOREIGN KEY(plugin_version_id) REFERENCES w_plugin_versions(id)
  )`,
  `CREATE TABLE IF NOT EXISTS w_tools (
    id TEXT PRIMARY KEY,
    capability_id TEXT NOT NULL,
    tool_ref TEXT NOT NULL UNIQUE,
    method_name TEXT NOT NULL,
    version TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    search_text TEXT NOT NULL,
    input_schema_json TEXT NOT NULL,
    output_schema_json TEXT,
    execution_plan_json TEXT NOT NULL,
    read_only INTEGER NOT NULL DEFAULT 0,
    destructive INTEGER NOT NULL DEFAULT 0,
    idempotent INTEGER NOT NULL DEFAULT 0,
    requires_confirmation INTEGER NOT NULL DEFAULT 0,
    connection_type TEXT,
    required_scopes_json TEXT,
    semantic_family TEXT,
    presentation_mode TEXT NOT NULL DEFAULT 'data',
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'published',
    schema_hash TEXT NOT NULL,
    search_text_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(capability_id) REFERENCES w_capabilities(id)
  )`,
  `CREATE TABLE IF NOT EXISTS w_tool_aliases (
    tool_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    alias_type TEXT NOT NULL DEFAULT 'synonym',
    PRIMARY KEY(tool_id, alias),
    FOREIGN KEY(tool_id) REFERENCES w_tools(id)
  )`,
  `CREATE TABLE IF NOT EXISTS w_tool_examples (
    id TEXT PRIMARY KEY,
    tool_id TEXT NOT NULL,
    example_type TEXT NOT NULL,
    text TEXT NOT NULL,
    FOREIGN KEY(tool_id) REFERENCES w_tools(id)
  )`,
  `CREATE TABLE IF NOT EXISTS w_tool_vectors (
    tool_id TEXT PRIMARY KEY,
    embedding_model TEXT NOT NULL,
    embedding_dimensions INTEGER NOT NULL,
    embedding_blob BLOB NOT NULL,
    embedding_norm REAL NOT NULL,
    embedding_hash TEXT NOT NULL,
    source_text_hash TEXT NOT NULL,
    cluster_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tool_id) REFERENCES w_tools(id)
  )`,
  `CREATE TABLE IF NOT EXISTS w_vector_clusters (
    id INTEGER PRIMARY KEY,
    embedding_model TEXT NOT NULL,
    embedding_dimensions INTEGER NOT NULL,
    centroid_blob BLOB NOT NULL,
    centroid_norm REAL NOT NULL,
    tools_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS w_embedding_jobs (
    id TEXT PRIMARY KEY,
    tool_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY(tool_id) REFERENCES w_tools(id)
  )`,
  `CREATE TABLE IF NOT EXISTS w_connections (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT,
    plugin_id TEXT NOT NULL,
    connection_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    auth_type TEXT NOT NULL,
    encrypted_credentials TEXT NOT NULL,
    granted_scopes_json TEXT,
    status TEXT NOT NULL,
    expires_at TEXT,
    credential_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS w_endpoint_configs (
    endpoint_id TEXT PRIMARY KEY,
    exposure_mode TEXT NOT NULL DEFAULT 'meta',
    exposed_plugins_json TEXT NOT NULL DEFAULT '[]',
    exposed_capability_kinds_json TEXT NOT NULL DEFAULT '["plugin","skill","agent"]',
    allow_direct_tools_json TEXT NOT NULL DEFAULT '[]',
    access_level TEXT NOT NULL DEFAULT 'edit',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS w_endpoint_permissions (
    endpoint_id TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    permission TEXT NOT NULL,
    PRIMARY KEY(endpoint_id, subject_type, subject_id, permission)
  )`,
  `CREATE TABLE IF NOT EXISTS w_confirmation_tokens (
    token_hash TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,
    tool_ref TEXT NOT NULL,
    arguments_hash TEXT NOT NULL,
    intent_ciphertext TEXT,
    intent_iv TEXT,
    intent_version INTEGER,
    result_json TEXT,
    completed_at TEXT,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS w_confirmation_approvals (
    token_hash TEXT PRIMARY KEY,
    browser_nonce_hash TEXT NOT NULL,
    approved_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(token_hash) REFERENCES w_confirmation_tokens(token_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS w_plugin_confirmation_policies (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,
    plugin_id TEXT NOT NULL,
    plugin_version_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id, user_id, endpoint_id, plugin_id)
  )`,
  `CREATE TABLE IF NOT EXISTS w_idempotency_keys (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    tool_ref TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    arguments_hash TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    result_json TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id, user_id, tool_ref, key_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS w_result_refs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,
    session_id TEXT,
    content_type TEXT NOT NULL,
    storage_type TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    original_chars INTEGER,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS w_result_payloads (
    storage_key TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS w_search_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,
    catalog_revision INTEGER NOT NULL,
    tool_refs_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS w_search_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT,
    endpoint_id TEXT NOT NULL,
    query_hash TEXT NOT NULL,
    query_text_redacted TEXT,
    candidates_count INTEGER NOT NULL,
    returned_count INTEGER NOT NULL,
    selected_tool_ref TEXT,
    latency_ms INTEGER NOT NULL,
    embedding_model TEXT,
    reranker_used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS w_execution_events (
    id TEXT PRIMARY KEY,
    tool_ref TEXT NOT NULL,
    plugin_version_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    user_id TEXT,
    endpoint_id TEXT NOT NULL,
    connection_id TEXT,
    arguments_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    http_status INTEGER,
    error_code TEXT,
    confirmation_used INTEGER NOT NULL DEFAULT 0,
    idempotency_key_hash TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS w_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS trg_w_permissions_insert_revision
   AFTER INSERT ON w_endpoint_permissions
   BEGIN
     UPDATE w_meta SET value = CAST(value AS INTEGER) + 1, updated_at = datetime('now')
     WHERE key = 'catalog_revision';
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_w_permissions_update_revision
   AFTER UPDATE ON w_endpoint_permissions
   BEGIN
     UPDATE w_meta SET value = CAST(value AS INTEGER) + 1, updated_at = datetime('now')
     WHERE key = 'catalog_revision';
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_w_permissions_delete_revision
   AFTER DELETE ON w_endpoint_permissions
   BEGIN
     UPDATE w_meta SET value = CAST(value AS INTEGER) + 1, updated_at = datetime('now')
     WHERE key = 'catalog_revision';
   END`,
  `CREATE INDEX IF NOT EXISTS idx_w_tools_capability ON w_tools(capability_id, enabled, status)`,
  `CREATE INDEX IF NOT EXISTS idx_w_vectors_cluster ON w_tool_vectors(cluster_id, embedding_model)`,
  `CREATE INDEX IF NOT EXISTS idx_w_permissions_endpoint ON w_endpoint_permissions(endpoint_id, permission)`,
  `CREATE INDEX IF NOT EXISTS idx_w_confirmation_policy_owner ON w_plugin_confirmation_policies(tenant_id, user_id, endpoint_id)`,
  `CREATE INDEX IF NOT EXISTS idx_w_results_owner ON w_result_refs(tenant_id, user_id, endpoint_id, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_w_search_expiry ON w_search_sessions(expires_at)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS w_tool_fts USING fts5(
    tool_ref UNINDEXED,
    plugin_id UNINDEXED,
    capability_id UNINDEXED,
    title,
    description,
    aliases,
    search_text,
    tokenize = 'unicode61'
  )`,
];

export async function ensureWGatewaySchema(env: Env): Promise<void> {
  const db = getDb(env);
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const sql of SCHEMA) await db.prepare(sql).run();
      await ensureConfirmationColumns(db);
      const now = new Date().toISOString();
      await db.prepare(
        "INSERT OR IGNORE INTO w_meta (key, value, updated_at) VALUES ('catalog_revision', '0', ?)",
      ).bind(now).run();
      await db.batch([
        db.prepare(
          `UPDATE w_endpoint_configs
           SET exposed_capability_kinds_json = '["plugin","skill","agent"]', updated_at = ?
           WHERE exposed_capability_kinds_json = '["connector","skill","agent"]'`,
        ).bind(now),
        db.prepare("UPDATE w_capabilities SET kind = 'plugin' WHERE kind = 'connector'"),
      ]);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

async function ensureConfirmationColumns(db: D1Database): Promise<void> {
  const existing = await db.prepare("PRAGMA table_info(w_confirmation_tokens)").all<{ name: string }>();
  const columns = new Set((existing.results || []).map((column) => column.name));
  for (const [name, type] of [
    ["intent_ciphertext", "TEXT"],
    ["intent_iv", "TEXT"],
    ["intent_version", "INTEGER"],
    ["result_json", "TEXT"],
    ["completed_at", "TEXT"],
  ] as const) {
    if (!columns.has(name)) await db.prepare(`ALTER TABLE w_confirmation_tokens ADD COLUMN ${name} ${type}`).run();
  }
}

export async function catalogRevision(env: Env): Promise<number> {
  await ensureWGatewaySchema(env);
  const row = await getDb(env).prepare("SELECT value FROM w_meta WHERE key = 'catalog_revision'").first<{ value: string }>();
  return Number.parseInt(row?.value || "0", 10) || 0;
}

export async function bumpCatalogRevision(env: Env): Promise<number> {
  await ensureWGatewaySchema(env);
  const db = getDb(env);
  const next = (await catalogRevision(env)) + 1;
  await db.prepare(
    "INSERT INTO w_meta (key, value, updated_at) VALUES ('catalog_revision', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).bind(String(next), new Date().toISOString()).run();
  return next;
}

export async function metaValue(env: Env, key: string): Promise<string | null> {
  await ensureWGatewaySchema(env);
  const row = await getDb(env).prepare("SELECT value FROM w_meta WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMetaValue(env: Env, key: string, value: string): Promise<void> {
  await ensureWGatewaySchema(env);
  await getDb(env).prepare(
    "INSERT INTO w_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).bind(key, value, new Date().toISOString()).run();
}

export function wDatabase(env: Env): D1Database {
  return getDb(env);
}

function getDb(env: Env): D1Database {
  if (!env.OAUTH_DB) throw new Error("D1 database is required for W Gateway.");
  return env.OAUTH_DB;
}
