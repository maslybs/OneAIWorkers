import { z } from "zod";
import { biInline } from "../i18n";
import { assertSafeOutboundUrl, redactUrlForOutput, safeKey } from "../security";
import type { Env } from "../types";

const MAX_RESPONSE_TEXT = 24_000;
const MAX_RESPONSE_PREVIEW_TEXT = 4_000;
const MAX_JSON_DEPTH = 6;
const MAX_JSON_ARRAY_ITEMS = 12;
const MAX_JSON_OBJECT_KEYS = 30;
const MAX_TEMPLATE_DEPTH = 20;

let schemaReady: Promise<void> | null = null;

type JsonObject = Record<string, unknown>;

type ConnectorMode = "internal" | "child_worker";

type OAuthClientAuthMethod = "basic" | "body";

type AuthConfig =
  | { type: "none" }
  | { type: "bearer_secret"; secret_name: string }
  | { type: "auth_header_secret"; secret_name: string; scheme?: string }
  | { type: "api_key_header_secret"; secret_name: string; header_name: string }
  | { type: "api_key_query_secret"; secret_name: string; query_name: string }
  | { type: "basic_secret"; secret_name: string; username?: string }
  | { type: "basic_secret_pair"; username_secret_name: string; password_secret_name: string }
  | { type: "oauth2_client_credentials"; token_url: string; client_id_secret_name: string; client_secret_secret_name: string; scope?: string; audience?: string; client_auth_method?: OAuthClientAuthMethod; access_token_field?: string; token_type?: string }
  | { type: "oauth2_refresh_token"; token_url: string; refresh_token_secret_name: string; client_id_secret_name?: string; client_secret_secret_name?: string; scope?: string; client_auth_method?: OAuthClientAuthMethod; access_token_field?: string; token_type?: string }
  | { type: "google_oauth2_refresh_token"; client_id_secret_name: string; client_secret_secret_name: string; refresh_token_secret_name: string; scope?: string };

interface ConnectorRow {
  connector_id: string;
  name: string;
  description: string | null;
  mode: ConnectorMode;
  child_worker_url: string | null;
  child_worker_token_secret: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

interface ActionRow {
  connector_id: string;
  action_name: string;
  description: string | null;
  method: string;
  url: string;
  auth_json: string;
  headers_json: string;
  query_json: string;
  body_template_json: string | null;
  input_schema_json: string | null;
  created_at: number;
  updated_at: number;
}

const oauthClientAuthMethodSchema = z.enum(["basic", "body"]).default("body");

const authSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer_secret"), secret_name: z.string().min(2).max(80) }),
  z.object({ type: z.literal("auth_header_secret"), secret_name: z.string().min(2).max(80), scheme: z.string().min(1).max(30).optional() }),
  z.object({ type: z.literal("api_key_header_secret"), secret_name: z.string().min(2).max(80), header_name: z.string().min(2).max(80) }),
  z.object({ type: z.literal("api_key_query_secret"), secret_name: z.string().min(2).max(80), query_name: z.string().min(1).max(80) }),
  z.object({ type: z.literal("basic_secret"), secret_name: z.string().min(2).max(80), username: z.string().max(120).optional() }),
  z.object({ type: z.literal("basic_secret_pair"), username_secret_name: z.string().min(2).max(80), password_secret_name: z.string().min(2).max(80) }),
  z.object({
    type: z.literal("oauth2_client_credentials"),
    token_url: z.string().url(),
    client_id_secret_name: z.string().min(2).max(80),
    client_secret_secret_name: z.string().min(2).max(80),
    scope: z.string().max(1000).optional(),
    audience: z.string().max(1000).optional(),
    client_auth_method: oauthClientAuthMethodSchema.optional(),
    access_token_field: z.string().min(1).max(80).optional(),
    token_type: z.string().min(1).max(30).optional(),
  }),
  z.object({
    type: z.literal("oauth2_refresh_token"),
    token_url: z.string().url(),
    refresh_token_secret_name: z.string().min(2).max(80),
    client_id_secret_name: z.string().min(2).max(80).optional(),
    client_secret_secret_name: z.string().min(2).max(80).optional(),
    scope: z.string().max(1000).optional(),
    client_auth_method: oauthClientAuthMethodSchema.optional(),
    access_token_field: z.string().min(1).max(80).optional(),
    token_type: z.string().min(1).max(30).optional(),
  }),
  z.object({
    type: z.literal("google_oauth2_refresh_token"),
    client_id_secret_name: z.string().min(2).max(80),
    client_secret_secret_name: z.string().min(2).max(80),
    refresh_token_secret_name: z.string().min(2).max(80),
    scope: z.string().max(1000).optional(),
  }),
]);

const actionSchema = z.object({
  name: z.string().min(1).max(80).describe(biInline("Action name, for example create_lead.", "Назва дії, наприклад create_lead.")),
  description: z.string().max(500).optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
  url: z.string().min(8).max(4000).describe(biInline("Public HTTPS API URL. Path templates like /workflows/{{id}} are supported.", "Публічний HTTPS URL API. Підтримуються path templates типу /workflows/{{id}}.")),
  auth: authSchema.default({ type: "none" }),
  headers: z.record(z.string(), z.string()).default({}).describe(biInline("Optional safe request headers. Do not include Authorization or Cookie.", "Опційні безпечні headers. Не додавайте Authorization або Cookie.")),
  query: z.record(z.string(), z.unknown()).default({}).describe(biInline("Optional query values. Templates like {{email}} are supported.", "Опційні query значення. Підтримуються шаблони типу {{email}}.")),
  body_template: z.unknown().optional().describe(biInline("JSON body template. Use {{field}} placeholders from input.", "Шаблон JSON body. Використовуйте {{field}} з input.")),
  input_schema: z.record(z.string(), z.unknown()).optional().describe(biInline("Optional JSON schema that describes expected input for the LLM.", "Опційна JSON schema, яка описує очікуваний input для LLM.")),
});

export const saveConnectorSchema = {
  connector_id: z.string().min(2).max(80).describe(biInline("Short connector id, for example crm or billing.", "Короткий id конектора, наприклад crm або billing.")),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  mode: z.enum(["internal", "child_worker"]).default("internal"),
  child_worker_url: z.string().url().optional().describe(biInline("Only for advanced mode. Public HTTPS URL of the child Worker.", "Тільки для розширеного режиму. Публічний HTTPS URL child Worker.")),
  child_worker_token_secret: z.string().min(2).max(80).optional().describe(biInline("Secret name that stores the internal token for the child Worker.", "Назва secret, де зберігається внутрішній token для child Worker.")),
  actions: z.array(actionSchema).min(1).max(50).describe(biInline("Actions exposed by this connector.", "Дії, які надає цей конектор.")),
};

export const listConnectorsSchema = {
  include_actions: z.boolean().default(false),
};

export const connectorIdSchema = {
  connector_id: z.string().min(2).max(80),
};

export const callConnectorToolSchema = {
  connector_id: z.string().min(2).max(80),
  action_name: z.string().min(1).max(80),
  input: z.record(z.string(), z.unknown()).default({}),
  dry_run: z.boolean().default(false).describe(biInline("If true, show the prepared request without calling the API.", "Якщо true, показати підготовлений запит без виклику API.")),
};

export const testConnectorSchema = {
  connector_id: z.string().min(2).max(80),
  action_name: z.string().min(1).max(80).optional(),
  input: z.record(z.string(), z.unknown()).default({}),
  dry_run: z.boolean().default(true),
};

export async function ensureConnectorSchema(env: Env): Promise<void> {
  const db = getDb(env);
  if (!schemaReady) {
    schemaReady = (async () => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS connectors (
          connector_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          mode TEXT NOT NULL DEFAULT 'internal',
          child_worker_url TEXT,
          child_worker_token_secret TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS connector_actions (
          connector_id TEXT NOT NULL,
          action_name TEXT NOT NULL,
          description TEXT,
          method TEXT NOT NULL,
          url TEXT NOT NULL,
          auth_json TEXT NOT NULL,
          headers_json TEXT NOT NULL,
          query_json TEXT NOT NULL,
          body_template_json TEXT,
          input_schema_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (connector_id, action_name)
        )`,
        `CREATE TABLE IF NOT EXISTS connector_audit_log (
          id TEXT PRIMARY KEY,
          connector_id TEXT,
          action_name TEXT,
          event TEXT NOT NULL,
          ok INTEGER NOT NULL,
          message TEXT,
          created_at INTEGER NOT NULL
        )`,
      ];
      for (const sql of statements) await db.prepare(sql).run();
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function saveConnector(env: Env, args: z.infer<z.ZodObject<typeof saveConnectorSchema>>) {
  const db = getDb(env);
  await ensureConnectorSchema(env);

  const connectorId = safeKey(args.connector_id).replaceAll(":", "-");
  const now = nowSeconds();
  const mode = args.mode || "internal";
  if (mode === "child_worker") {
    if (!args.child_worker_url) throw new Error(biInline("child_worker_url is required for child_worker mode.", "Для режиму child_worker потрібен child_worker_url."));
    assertSafeOutboundUrl(args.child_worker_url);
    if (args.child_worker_token_secret) validateSecretName(args.child_worker_token_secret);
  }

  await db.prepare(
    `INSERT INTO connectors (connector_id, name, description, mode, child_worker_url, child_worker_token_secret, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(connector_id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       mode = excluded.mode,
       child_worker_url = excluded.child_worker_url,
       child_worker_token_secret = excluded.child_worker_token_secret,
       enabled = 1,
       updated_at = excluded.updated_at`,
  ).bind(connectorId, args.name, args.description || null, mode, args.child_worker_url || null, args.child_worker_token_secret || null, now, now).run();

  await db.prepare("DELETE FROM connector_actions WHERE connector_id = ?").bind(connectorId).run();

  for (const action of args.actions) {
    const actionName = safeKey(action.name).replaceAll(":", "-");
    validateTemplatedUrl(action.url);
    validateAuth(action.auth as AuthConfig);
    validateSafeHeaders(action.headers || {});
    await db.prepare(
      `INSERT INTO connector_actions
       (connector_id, action_name, description, method, url, auth_json, headers_json, query_json, body_template_json, input_schema_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      connectorId,
      actionName,
      action.description || null,
      action.method || "POST",
      action.url,
      JSON.stringify(action.auth || { type: "none" }),
      JSON.stringify(action.headers || {}),
      JSON.stringify(action.query || {}),
      action.body_template === undefined ? null : JSON.stringify(action.body_template),
      action.input_schema === undefined ? null : JSON.stringify(action.input_schema),
      now,
      now,
    ).run();
  }

  await audit(db, connectorId, null, "save_connector", true, `Saved ${args.actions.length} actions`);
  return { ok: true, connector_id: connectorId, actions: args.actions.length, mode };
}

export async function listConnectors(env: Env, args: z.infer<z.ZodObject<typeof listConnectorsSchema>>) {
  const db = getDb(env);
  await ensureConnectorSchema(env);
  const rows = await db.prepare("SELECT * FROM connectors WHERE enabled = 1 ORDER BY connector_id").all<ConnectorRow>();
  const connectors = [];
  for (const row of rows.results || []) {
    const item: JsonObject = publicConnector(row);
    if (args.include_actions) item.actions = await listActionsForConnector(env, db, row.connector_id);
    connectors.push(item);
  }
  return { connectors };
}

export async function deleteConnector(env: Env, args: z.infer<z.ZodObject<typeof connectorIdSchema>>) {
  const db = getDb(env);
  await ensureConnectorSchema(env);
  const connectorId = safeKey(args.connector_id).replaceAll(":", "-");
  await db.prepare("DELETE FROM connector_actions WHERE connector_id = ?").bind(connectorId).run();
  await db.prepare("DELETE FROM connectors WHERE connector_id = ?").bind(connectorId).run();
  await audit(db, connectorId, null, "delete_connector", true, "Deleted connector");
  return { ok: true, connector_id: connectorId };
}

export async function testConnector(env: Env, args: z.infer<z.ZodObject<typeof testConnectorSchema>>) {
  const db = getDb(env);
  await ensureConnectorSchema(env);
  const connectorId = safeKey(args.connector_id).replaceAll(":", "-");
  const actionName = args.action_name ? safeKey(args.action_name).replaceAll(":", "-") : null;
  const actions = await listActionsForConnector(env, db, connectorId);
  if (!actions.length) throw new Error(biInline("Connector not found or has no actions.", "Конектор не знайдено або він не має дій."));
  if (!actionName) return { ok: true, connector_id: connectorId, actions };
  return callConnectorTool(env, { connector_id: connectorId, action_name: actionName, input: args.input || {}, dry_run: args.dry_run ?? true });
}

export async function callConnectorTool(env: Env, args: z.infer<z.ZodObject<typeof callConnectorToolSchema>>) {
  const db = getDb(env);
  await ensureConnectorSchema(env);
  const connectorId = safeKey(args.connector_id).replaceAll(":", "-");
  const actionName = safeKey(args.action_name).replaceAll(":", "-");
  const connector = await db.prepare("SELECT * FROM connectors WHERE connector_id = ? AND enabled = 1").bind(connectorId).first<ConnectorRow>();
  if (!connector) throw new Error(biInline("Connector not found.", "Конектор не знайдено."));

  if (connector.mode === "child_worker") {
    return callChildWorkerConnector(env, connector, actionName, args.input || {}, args.dry_run || false);
  }

  const action = await db.prepare(
    "SELECT * FROM connector_actions WHERE connector_id = ? AND action_name = ?",
  ).bind(connectorId, actionName).first<ActionRow>();
  if (!action) throw new Error(biInline("Connector action not found.", "Дію конектора не знайдено."));

  const result = await callInternalAction(env, action, args.input || {}, args.dry_run || false);
  await audit(db, connectorId, actionName, args.dry_run ? "dry_run_action" : "call_action", true, `${action.method} ${action.url}`);
  return result;
}

async function callInternalAction(env: Env, action: ActionRow, input: JsonObject, dryRun: boolean) {
  assertUrlTemplateInput(action.url, input);
  const url = assertSafeOutboundUrl(renderUrlString(action.url, input));
  const method = action.method.toUpperCase();
  const headers = new Headers();
  headers.set("accept", "application/json, text/plain;q=0.9, */*;q=0.1");

  const customHeaders = parseJsonObject(action.headers_json);
  validateSafeHeaders(customHeaders);
  for (const [key, value] of Object.entries(customHeaders)) {
    headers.set(key, renderScalar(value, input));
  }

  const query = parseJsonObject(action.query_json);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, renderScalar(value, input));
  }

  const auth = parseJson<AuthConfig>(action.auth_json, { type: "none" });
  await applyAuth(env, url, headers, auth);

  let body: string | undefined;
  if (!["GET", "DELETE"].includes(method) && action.body_template_json) {
    const template = JSON.parse(action.body_template_json) as unknown;
    const rendered = renderTemplate(template, input);
    body = typeof rendered === "string" ? rendered : JSON.stringify(rendered);
    if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  }

  const prepared = {
    method,
    url: redactUrlForOutput(url),
    headers: redactHeaders(headers),
    body_preview: body ? truncate(body, 2000) : null,
  };

  if (dryRun) return { ok: true, dry_run: true, prepared_request: prepared };

  const response = await fetch(url.toString(), { method, headers, body, redirect: "manual" });
  const text = await response.text();
  return {
    ok: response.ok,
    request: prepared,
    response: buildConnectorResponse(response, text),
  };
}

async function callChildWorkerConnector(env: Env, connector: ConnectorRow, actionName: string, input: JsonObject, dryRun: boolean) {
  if (!connector.child_worker_url) throw new Error(biInline("Child Worker URL is not configured.", "URL child Worker не налаштований."));
  const base = assertSafeOutboundUrl(connector.child_worker_url);
  const endpoint = new URL("/tools/call", base);
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (connector.child_worker_token_secret) {
    validateSecretName(connector.child_worker_token_secret);
    const token = getSecret(env, connector.child_worker_token_secret);
    headers.set("x-oneaiworkers-child-token", token);
  }

  const payload = { name: actionName, arguments: input, dry_run: dryRun };
  if (dryRun) {
    return { ok: true, dry_run: true, child_worker_url: redactUrlForOutput(endpoint), payload };
  }

  const response = await fetch(endpoint.toString(), { method: "POST", headers, body: JSON.stringify(payload), redirect: "manual" });
  const text = await response.text();
  return {
    ok: response.ok,
    child_worker_url: redactUrlForOutput(endpoint),
    response: buildConnectorResponse(response, text),
  };
}

async function listActionsForConnector(env: Env, db: D1Database, connectorId: string) {
  const rows = await db.prepare("SELECT * FROM connector_actions WHERE connector_id = ? ORDER BY action_name").bind(connectorId).all<ActionRow>();
  return (rows.results || []).map((row) => ({
    name: row.action_name,
    description: row.description,
    method: row.method,
    url: redactTemplatedUrl(row.url),
    auth: publicAuth(parseJson<AuthConfig>(row.auth_json, { type: "none" }), env),
    input_schema: row.input_schema_json ? JSON.parse(row.input_schema_json) : null,
  }));
}

function buildConnectorResponse(response: Response, text: string) {
  const contentType = response.headers.get("content-type");
  const parsedJson = parseJsonMaybe(text);
  const bodyKind = parsedJson.ok ? "json" : "text";
  const jsonSummary = parsedJson.ok ? summarizeJson(parsedJson.value) : null;
  const jsonPreview = parsedJson.ok ? compactJson(parsedJson.value) : null;
  return {
    status: response.status,
    status_text: response.statusText,
    ok: response.ok,
    content_type: contentType,
    body_kind: bodyKind,
    summary: jsonSummary,
    json_preview: jsonPreview,
    text_preview: parsedJson.ok ? null : truncate(text, MAX_RESPONSE_PREVIEW_TEXT),
    raw_text_preview: truncate(text, MAX_RESPONSE_PREVIEW_TEXT),
    truncated: text.length > MAX_RESPONSE_PREVIEW_TEXT,
  };
}

function parseJsonMaybe(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function summarizeJson(value: unknown): JsonObject {
  if (Array.isArray(value)) {
    return {
      root_type: "array",
      item_count: value.length,
      first_item_keys: value[0] && typeof value[0] === "object" && !Array.isArray(value[0]) ? Object.keys(value[0] as JsonObject).slice(0, 30) : [],
    };
  }
  if (value && typeof value === "object") {
    const objectValue = value as JsonObject;
    const keys = Object.keys(objectValue);
    const arrays: JsonObject = {};
    for (const key of keys) {
      const child = objectValue[key];
      if (Array.isArray(child)) arrays[key] = { item_count: child.length };
    }
    return {
      root_type: "object",
      top_level_keys: keys.slice(0, 50),
      array_fields: arrays,
    };
  }
  return { root_type: value === null ? "null" : typeof value };
}

function compactJson(value: unknown, depth = 0): unknown {
  if (depth > MAX_JSON_DEPTH) return "[max depth reached]";
  if (typeof value === "string") return truncate(value, 2000);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_JSON_ARRAY_ITEMS).map((item) => compactJson(item, depth + 1));
    if (value.length > MAX_JSON_ARRAY_ITEMS) items.push(`[...${value.length - MAX_JSON_ARRAY_ITEMS} more items]`);
    return items;
  }
  if (value && typeof value === "object") {
    const out: JsonObject = {};
    const entries = Object.entries(value as JsonObject);
    for (const [key, child] of entries.slice(0, MAX_JSON_OBJECT_KEYS)) out[key] = compactJson(child, depth + 1);
    if (entries.length > MAX_JSON_OBJECT_KEYS) out.__truncated_keys = entries.length - MAX_JSON_OBJECT_KEYS;
    return out;
  }
  return String(value);
}

function publicConnector(row: ConnectorRow) {
  return {
    connector_id: row.connector_id,
    name: row.name,
    description: row.description,
    mode: row.mode,
    child_worker_url: row.child_worker_url ? redactUrlForOutput(assertSafeOutboundUrl(row.child_worker_url)) : null,
    child_worker_token_secret: row.child_worker_token_secret || null,
    enabled: Boolean(row.enabled),
    updated_at: row.updated_at,
  };
}

async function applyAuth(env: Env, url: URL, headers: Headers, auth: AuthConfig) {
  if (!auth || auth.type === "none") return;
  validateAuth(auth);

  if (auth.type === "bearer_secret") {
    headers.set("authorization", `Bearer ${getSecret(env, auth.secret_name)}`);
    return;
  }
  if (auth.type === "auth_header_secret") {
    const scheme = auth.scheme || "Bearer";
    headers.set("authorization", `${scheme} ${getSecret(env, auth.secret_name)}`);
    return;
  }
  if (auth.type === "api_key_header_secret") {
    headers.set(auth.header_name, getSecret(env, auth.secret_name));
    return;
  }
  if (auth.type === "api_key_query_secret") {
    url.searchParams.set(auth.query_name, getSecret(env, auth.secret_name));
    return;
  }
  if (auth.type === "basic_secret") {
    headers.set("authorization", `Basic ${btoa(`${auth.username || ""}:${getSecret(env, auth.secret_name)}`)}`);
    return;
  }
  if (auth.type === "basic_secret_pair") {
    const username = getSecret(env, auth.username_secret_name);
    const password = getSecret(env, auth.password_secret_name);
    headers.set("authorization", `Basic ${btoa(`${username}:${password}`)}`);
    return;
  }
  if (auth.type === "oauth2_client_credentials") {
    const token = await fetchOAuthAccessToken(env, {
      grant_type: "client_credentials",
      token_url: auth.token_url,
      client_id_secret_name: auth.client_id_secret_name,
      client_secret_secret_name: auth.client_secret_secret_name,
      scope: auth.scope,
      audience: auth.audience,
      client_auth_method: auth.client_auth_method || "body",
      access_token_field: auth.access_token_field || "access_token",
    });
    headers.set("authorization", `${auth.token_type || "Bearer"} ${token}`);
    return;
  }
  if (auth.type === "oauth2_refresh_token") {
    const token = await fetchOAuthAccessToken(env, {
      grant_type: "refresh_token",
      token_url: auth.token_url,
      refresh_token_secret_name: auth.refresh_token_secret_name,
      client_id_secret_name: auth.client_id_secret_name,
      client_secret_secret_name: auth.client_secret_secret_name,
      scope: auth.scope,
      client_auth_method: auth.client_auth_method || "body",
      access_token_field: auth.access_token_field || "access_token",
    });
    headers.set("authorization", `${auth.token_type || "Bearer"} ${token}`);
    return;
  }
  if (auth.type === "google_oauth2_refresh_token") {
    const token = await fetchOAuthAccessToken(env, {
      grant_type: "refresh_token",
      token_url: "https://oauth2.googleapis.com/token",
      refresh_token_secret_name: auth.refresh_token_secret_name,
      client_id_secret_name: auth.client_id_secret_name,
      client_secret_secret_name: auth.client_secret_secret_name,
      scope: auth.scope,
      client_auth_method: "body",
      access_token_field: "access_token",
    });
    headers.set("authorization", `Bearer ${token}`);
  }
}

function renderUrlString(template: string, input: JsonObject): string {
  return renderString(template, input);
}

function validateTemplatedUrl(template: string) {
  assertSafeOutboundUrl(templateUrlForValidation(template));
}

function assertUrlTemplateInput(template: string, input: JsonObject) {
  const missing = templateKeys(template).filter((key) => getPath(input, key) === undefined || getPath(input, key) === null || getPath(input, key) === "");
  if (missing.length) {
    throw new Error(`${biInline("Missing input values for URL template", "Бракує input значень для URL template")}: ${missing.join(", ")}`);
  }
}

function templateKeys(template: string): string[] {
  return Array.from(template.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)).map((match) => match[1]);
}

function templateUrlForValidation(template: string): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, path: string) => {
    const lower = path.toLowerCase();
    if (lower.includes("token") || lower.includes("secret") || lower.includes("password") || lower.includes("key")) return "REDACTED";
    return "example";
  });
}

function redactTemplatedUrl(template: string): string {
  return template.replace(/([?&][^=]*(?:token|key|secret|password|auth|signature)[^=]*=)([^&]+)/gi, "$1[redacted]");
}

function getSecret(env: Env, name: string): string {
  validateSecretName(name);
  const value = (env as Record<string, unknown>)[name];
  if (typeof value !== "string" || !value) {
    throw new Error(`${biInline("Secret is not configured", "Secret не налаштований")}: ${name}`);
  }
  return value;
}

interface OAuthTokenRequestConfig {
  grant_type: "client_credentials" | "refresh_token";
  token_url: string;
  client_id_secret_name?: string;
  client_secret_secret_name?: string;
  refresh_token_secret_name?: string;
  scope?: string;
  audience?: string;
  client_auth_method: OAuthClientAuthMethod;
  access_token_field: string;
}

async function fetchOAuthAccessToken(env: Env, config: OAuthTokenRequestConfig): Promise<string> {
  const tokenUrl = assertSafeOutboundUrl(config.token_url);
  const body = new URLSearchParams();
  body.set("grant_type", config.grant_type);
  if (config.scope) body.set("scope", config.scope);
  if (config.audience) body.set("audience", config.audience);
  if (config.refresh_token_secret_name) body.set("refresh_token", getSecret(env, config.refresh_token_secret_name));

  const clientId = config.client_id_secret_name ? getSecret(env, config.client_id_secret_name) : "";
  const clientSecret = config.client_secret_secret_name ? getSecret(env, config.client_secret_secret_name) : "";
  const headers = new Headers({
    "accept": "application/json",
    "content-type": "application/x-www-form-urlencoded; charset=utf-8",
  });

  if (config.client_auth_method === "basic" && clientId && clientSecret) {
    headers.set("authorization", `Basic ${btoa(`${clientId}:${clientSecret}`)}`);
  } else {
    if (clientId) body.set("client_id", clientId);
    if (clientSecret) body.set("client_secret", clientSecret);
  }

  const response = await fetch(tokenUrl.toString(), { method: "POST", headers, body, redirect: "manual" });
  const payload = await response.json().catch(() => null) as JsonObject | null;
  if (!response.ok || !payload) {
    throw new Error(`${biInline("OAuth token request failed", "OAuth token запит не вдався")}: ${response.status}`);
  }

  const token = payload[config.access_token_field];
  if (typeof token !== "string" || !token) {
    throw new Error(biInline("OAuth token response does not include an access token.", "OAuth token відповідь не містить access token."));
  }
  return token;
}

function validateAuth(auth: AuthConfig) {
  if (!auth || auth.type === "none") return;

  if (auth.type === "bearer_secret" || auth.type === "auth_header_secret" || auth.type === "api_key_header_secret" || auth.type === "api_key_query_secret" || auth.type === "basic_secret") {
    validateSecretName(auth.secret_name);
  }
  if (auth.type === "basic_secret_pair") {
    validateSecretName(auth.username_secret_name);
    validateSecretName(auth.password_secret_name);
  }
  if (auth.type === "oauth2_client_credentials") {
    assertSafeOutboundUrl(auth.token_url);
    validateSecretName(auth.client_id_secret_name);
    validateSecretName(auth.client_secret_secret_name);
    validateTokenOptions(auth.client_auth_method, auth.access_token_field, auth.token_type);
  }
  if (auth.type === "oauth2_refresh_token") {
    assertSafeOutboundUrl(auth.token_url);
    validateSecretName(auth.refresh_token_secret_name);
    if (auth.client_id_secret_name) validateSecretName(auth.client_id_secret_name);
    if (auth.client_secret_secret_name) validateSecretName(auth.client_secret_secret_name);
    validateTokenOptions(auth.client_auth_method, auth.access_token_field, auth.token_type);
  }
  if (auth.type === "google_oauth2_refresh_token") {
    validateSecretName(auth.client_id_secret_name);
    validateSecretName(auth.client_secret_secret_name);
    validateSecretName(auth.refresh_token_secret_name);
  }
  if (auth.type === "auth_header_secret") validateAuthScheme(auth.scheme || "Bearer");
  if (auth.type === "api_key_header_secret") validateHeaderName(auth.header_name);
  if (auth.type === "api_key_query_secret" && !/^[A-Za-z0-9_.-]{1,80}$/.test(auth.query_name)) throw new Error(biInline("Invalid query key name.", "Некоректна назва query key."));
}

function validateSecretName(name: string) {
  if (!/^[A-Z][A-Z0-9_]{1,80}$/.test(name)) {
    throw new Error(biInline("Secret name must use uppercase letters, numbers, and underscores.", "Назва secret має містити великі літери, цифри й підкреслення."));
  }
}

function validateTokenOptions(clientAuthMethod?: OAuthClientAuthMethod, accessTokenField?: string, tokenType?: string) {
  if (clientAuthMethod && !["basic", "body"].includes(clientAuthMethod)) throw new Error(biInline("Invalid OAuth client auth method.", "Некоректний OAuth client auth method."));
  if (accessTokenField && !/^[A-Za-z0-9_.-]{1,80}$/.test(accessTokenField)) throw new Error(biInline("Invalid OAuth access token field.", "Некоректне OAuth access token field."));
  if (tokenType) validateAuthScheme(tokenType);
}

function validateAuthScheme(value: string) {
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,29}$/.test(value)) throw new Error(biInline("Invalid authorization scheme.", "Некоректна authorization scheme."));
}

function validateHeaderName(name: string) {
  const lower = name.toLowerCase();
  if (!/^[a-z0-9-]{2,80}$/i.test(name) || ["authorization", "cookie", "set-cookie", "host"].includes(lower)) {
    throw new Error(biInline("This header name is not allowed.", "Ця назва header не дозволена."));
  }
}

function validateSafeHeaders(headers: Record<string, unknown>) {
  for (const key of Object.keys(headers)) validateHeaderName(key);
}

function renderTemplate(value: unknown, input: JsonObject, depth = 0): unknown {
  if (depth > MAX_TEMPLATE_DEPTH) throw new Error(biInline("Template is too deep.", "Шаблон занадто глибокий."));
  if (typeof value === "string") return renderString(value, input);
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, input, depth + 1));
  if (value && typeof value === "object") {
    const out: JsonObject = {};
    for (const [key, child] of Object.entries(value as JsonObject)) out[key] = renderTemplate(child, input, depth + 1);
    return out;
  }
  return value;
}

function renderScalar(value: unknown, input: JsonObject): string {
  if (typeof value === "string") return renderString(value, input);
  if (value === null || value === undefined) return "";
  return String(value);
}

function renderString(template: string, input: JsonObject): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, path: string) => {
    const value = getPath(input, path);
    if (value === undefined || value === null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

function getPath(input: JsonObject, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && !Array.isArray(current)) return (current as JsonObject)[part];
    return undefined;
  }, input);
}

function parseJsonObject(value: string): JsonObject {
  return parseJson<JsonObject>(value, {});
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function publicAuth(auth: AuthConfig, env: Env) {
  if (!auth || auth.type === "none") return { type: "none" };
  const secretNames = getAuthSecretNames(auth);
  return {
    type: auth.type,
    ...publicAuthDetails(auth),
    secrets: secretNames.map((name) => ({
      name,
      configured: isSecretConfigured(env, name),
      value: "[hidden]",
    })),
  };
}

function publicAuthDetails(auth: AuthConfig): JsonObject {
  if (auth.type === "api_key_header_secret") return { header_name: auth.header_name };
  if (auth.type === "api_key_query_secret") return { query_name: auth.query_name };
  if (auth.type === "auth_header_secret") return { scheme: auth.scheme || "Bearer" };
  if (auth.type === "oauth2_client_credentials" || auth.type === "oauth2_refresh_token") {
    return {
      token_url: redactTemplatedUrl(auth.token_url),
      scope: auth.scope || null,
      audience: "audience" in auth ? auth.audience || null : null,
      client_auth_method: auth.client_auth_method || "body",
    };
  }
  if (auth.type === "google_oauth2_refresh_token") return { token_url: "https://oauth2.googleapis.com/token", scope: auth.scope || null };
  return {};
}

function getAuthSecretNames(auth: AuthConfig): string[] {
  if (auth.type === "bearer_secret" || auth.type === "auth_header_secret" || auth.type === "api_key_header_secret" || auth.type === "api_key_query_secret" || auth.type === "basic_secret") return [auth.secret_name];
  if (auth.type === "basic_secret_pair") return [auth.username_secret_name, auth.password_secret_name];
  if (auth.type === "oauth2_client_credentials") return [auth.client_id_secret_name, auth.client_secret_secret_name];
  if (auth.type === "oauth2_refresh_token") return [auth.refresh_token_secret_name, auth.client_id_secret_name, auth.client_secret_secret_name].filter(Boolean) as string[];
  if (auth.type === "google_oauth2_refresh_token") return [auth.client_id_secret_name, auth.client_secret_secret_name, auth.refresh_token_secret_name];
  return [];
}

function isSecretConfigured(env: Env, name: string): boolean {
  const value = (env as Record<string, unknown>)[name];
  return typeof value === "string" && value.length > 0;
}

function redactHeaders(headers: Headers) {
  const out: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    out[key] = /authorization|token|key|secret|cookie/i.test(key) ? "[redacted]" : value;
  }
  return out;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value;
}

function getDb(env: Env): D1Database {
  if (!env.OAUTH_DB) throw new Error(biInline("D1 database is not configured.", "D1 база не налаштована."));
  return env.OAUTH_DB;
}

async function audit(db: D1Database, connectorId: string | null, actionName: string | null, event: string, ok: boolean, message: string) {
  await db.prepare(
    "INSERT INTO connector_audit_log (id, connector_id, action_name, event, ok, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), connectorId, actionName, event, ok ? 1 : 0, message, nowSeconds()).run();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
