import { z } from "zod";
import { biInline } from "../i18n";
import { assertSafeOutboundUrl, redactUrlForOutput, safeKey } from "../security";
import type { Env } from "../types";

const MAX_RESPONSE_TEXT = 24_000;
const MAX_TEMPLATE_DEPTH = 20;

let schemaReady: Promise<void> | null = null;

type JsonObject = Record<string, unknown>;

type ConnectorMode = "internal" | "child_worker";

type AuthConfig =
  | { type: "none" }
  | { type: "bearer_secret"; secret_name: string }
  | { type: "api_key_header_secret"; secret_name: string; header_name: string }
  | { type: "api_key_query_secret"; secret_name: string; query_name: string }
  | { type: "basic_secret"; secret_name: string; username?: string };

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

const authSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer_secret"), secret_name: z.string().min(2).max(80) }),
  z.object({ type: z.literal("api_key_header_secret"), secret_name: z.string().min(2).max(80), header_name: z.string().min(2).max(80) }),
  z.object({ type: z.literal("api_key_query_secret"), secret_name: z.string().min(2).max(80), query_name: z.string().min(1).max(80) }),
  z.object({ type: z.literal("basic_secret"), secret_name: z.string().min(2).max(80), username: z.string().max(120).optional() }),
]);

const actionSchema = z.object({
  name: z.string().min(1).max(80).describe(biInline("Action name, for example create_lead.", "Назва дії, наприклад create_lead.")),
  description: z.string().max(500).optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
  url: z.string().url().describe(biInline("Public HTTPS API URL.", "Публічний HTTPS URL API.")),
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
    schemaReady = db.exec(`
      CREATE TABLE IF NOT EXISTS connectors (
        connector_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        mode TEXT NOT NULL DEFAULT 'internal',
        child_worker_url TEXT,
        child_worker_token_secret TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS connector_actions (
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
      );
      CREATE TABLE IF NOT EXISTS connector_audit_log (
        id TEXT PRIMARY KEY,
        connector_id TEXT,
        action_name TEXT,
        event TEXT NOT NULL,
        ok INTEGER NOT NULL,
        message TEXT,
        created_at INTEGER NOT NULL
      );
    `).then(() => undefined);
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
    const url = assertSafeOutboundUrl(action.url);
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
      url.toString(),
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
    if (args.include_actions) item.actions = await listActionsForConnector(db, row.connector_id);
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
  const actions = await listActionsForConnector(db, connectorId);
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
  const url = assertSafeOutboundUrl(action.url);
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
  applyAuth(env, url, headers, auth);

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
    response: {
      status: response.status,
      status_text: response.statusText,
      content_type: response.headers.get("content-type"),
      text: truncate(text, MAX_RESPONSE_TEXT),
      truncated: text.length > MAX_RESPONSE_TEXT,
    },
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
    response: {
      status: response.status,
      content_type: response.headers.get("content-type"),
      text: truncate(text, MAX_RESPONSE_TEXT),
      truncated: text.length > MAX_RESPONSE_TEXT,
    },
  };
}

async function listActionsForConnector(db: D1Database, connectorId: string) {
  const rows = await db.prepare("SELECT * FROM connector_actions WHERE connector_id = ? ORDER BY action_name").bind(connectorId).all<ActionRow>();
  return (rows.results || []).map((row) => ({
    name: row.action_name,
    description: row.description,
    method: row.method,
    url: redactUrlForOutput(assertSafeOutboundUrl(row.url)),
    auth: publicAuth(parseJson<AuthConfig>(row.auth_json, { type: "none" })),
    input_schema: row.input_schema_json ? JSON.parse(row.input_schema_json) : null,
  }));
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

function applyAuth(env: Env, url: URL, headers: Headers, auth: AuthConfig) {
  if (!auth || auth.type === "none") return;
  validateAuth(auth);
  const secret = getSecret(env, auth.secret_name);
  if (auth.type === "bearer_secret") {
    headers.set("authorization", `Bearer ${secret}`);
    return;
  }
  if (auth.type === "api_key_header_secret") {
    headers.set(auth.header_name, secret);
    return;
  }
  if (auth.type === "api_key_query_secret") {
    url.searchParams.set(auth.query_name, secret);
    return;
  }
  if (auth.type === "basic_secret") {
    headers.set("authorization", `Basic ${btoa(`${auth.username || ""}:${secret}`)}`);
  }
}

function getSecret(env: Env, name: string): string {
  validateSecretName(name);
  const value = (env as Record<string, unknown>)[name];
  if (typeof value !== "string" || !value) {
    throw new Error(`${biInline("Secret is not configured", "Secret не налаштований")}: ${name}`);
  }
  return value;
}

function validateAuth(auth: AuthConfig) {
  if (!auth || auth.type === "none") return;
  validateSecretName(auth.secret_name);
  if (auth.type === "api_key_header_secret") validateHeaderName(auth.header_name);
  if (auth.type === "api_key_query_secret" && !/^[A-Za-z0-9_.-]{1,80}$/.test(auth.query_name)) throw new Error(biInline("Invalid query key name.", "Некоректна назва query key."));
}

function validateSecretName(name: string) {
  if (!/^[A-Z][A-Z0-9_]{1,80}$/.test(name)) {
    throw new Error(biInline("Secret name must use uppercase letters, numbers, and underscores.", "Назва secret має містити великі літери, цифри й підкреслення."));
  }
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

function publicAuth(auth: AuthConfig) {
  if (!auth || auth.type === "none") return { type: "none" };
  return { ...auth, secret_configured: true, secret_value: "[hidden]" };
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
