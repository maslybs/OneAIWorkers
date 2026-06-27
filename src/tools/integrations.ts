import { z } from "zod";
import { biInline } from "../i18n";
import { assertSafeOutboundUrl, redactUrlForOutput, safeKey } from "../security";
import type { Env } from "../types";
import { applyConnectorAuth, authSchema, getAuthSecretNames, getSecret, isSecretConfigured, publicAuth, redactHeaders, validateAuth, validateSafeHeaders, validateSecretName } from "./connectors/auth";
import { buildConnectorResponse } from "./connectors/response";
import { assertUrlTemplateInput, parseJson, parseJsonObject, redactTemplatedUrl, renderScalar, renderTemplate, renderUrlString, truncate, validateTemplatedUrl } from "./connectors/templates";
import type { ActionRow, AuthConfig, ConnectorMode, ConnectorRow, JsonObject } from "./connectors/types";

const MAX_RESPONSE_TEXT = 24_000;

let schemaReady: Promise<void> | null = null;

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

export const connectorSetupStatusSchema = {
  include_connectors: z.boolean().default(true),
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

export async function connectorSetupStatus(env: Env, args: z.infer<z.ZodObject<typeof connectorSetupStatusSchema>>) {
  const base = {
    d1_database: Boolean(env.OAUTH_DB),
    mcp_shared_secret: Boolean(env.MCP_SHARED_SECRET),
    worker_builder: Boolean(env.CF_ACCOUNT_ID && env.CF_API_TOKEN),
    notifications: {
      telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
      discord: Boolean(env.DISCORD_WEBHOOK_URL),
      slack: Boolean(env.SLACK_WEBHOOK_URL),
      default_webhook: Boolean(env.DEFAULT_WEBHOOK_URL),
    },
  };

  if (!env.OAUTH_DB) return { ok: false, configured: base, message: biInline("D1 database is not configured.", "D1 база не налаштована.") };

  const db = getDb(env);
  await ensureConnectorSchema(env);
  const rows = await db.prepare("SELECT * FROM connector_actions ORDER BY connector_id, action_name").all<ActionRow>();
  const requiredSecrets = collectRequiredSecrets(env, rows.results || []);
  return {
    ok: true,
    configured: base,
    connectors: args.include_connectors ? (await listConnectors(env, { include_actions: true })).connectors : undefined,
    required_secrets: requiredSecrets,
    missing_secrets: requiredSecrets.filter((item) => !item.configured).map((item) => item.name),
  };
}

export async function saveConnector(env: Env, args: z.infer<z.ZodObject<typeof saveConnectorSchema>>) {
  const db = getDb(env);
  await ensureConnectorSchema(env);

  const connectorId = safeKey(args.connector_id).replaceAll(":", "-");
  const now = nowSeconds();
  const mode = args.mode || "internal";
  if (mode === "child_worker") validateChildWorkerConfig(args.child_worker_url, args.child_worker_token_secret);

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

  for (const action of args.actions) await saveConnectorAction(db, connectorId, action, now);

  await audit(db, connectorId, null, "save_connector", true, `Saved ${args.actions.length} actions`);
  return { ok: true, connector_id: connectorId, actions: args.actions.length, mode };
}

export async function listConnectors(env: Env, args: z.infer<z.ZodObject<typeof listConnectorsSchema>>) {
  const db = getDb(env);
  await ensureConnectorSchema(env);
  const rows = await db.prepare("SELECT * FROM connectors WHERE enabled = 1 ORDER BY connector_id").all<ConnectorRow>();
  const connectors: JsonObject[] = [];
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
  const connectorId = normalizeKey(args.connector_id);
  await db.prepare("DELETE FROM connector_actions WHERE connector_id = ?").bind(connectorId).run();
  await db.prepare("DELETE FROM connectors WHERE connector_id = ?").bind(connectorId).run();
  await audit(db, connectorId, null, "delete_connector", true, "Deleted connector");
  return { ok: true, connector_id: connectorId };
}

export async function testConnector(env: Env, args: z.infer<z.ZodObject<typeof testConnectorSchema>>) {
  const db = getDb(env);
  await ensureConnectorSchema(env);
  const connectorId = normalizeKey(args.connector_id);
  const actionName = args.action_name ? normalizeKey(args.action_name) : null;
  const actions = await listActionsForConnector(env, db, connectorId);
  if (!actions.length) throw new Error(biInline("Connector not found or has no actions.", "Конектор не знайдено або він не має дій."));
  if (!actionName) return { ok: true, connector_id: connectorId, actions };
  return callConnectorTool(env, { connector_id: connectorId, action_name: actionName, input: args.input || {}, dry_run: args.dry_run ?? true });
}

export async function callConnectorTool(env: Env, args: z.infer<z.ZodObject<typeof callConnectorToolSchema>>) {
  const db = getDb(env);
  await ensureConnectorSchema(env);
  const connectorId = normalizeKey(args.connector_id);
  const actionName = normalizeKey(args.action_name);
  const connector = await db.prepare("SELECT * FROM connectors WHERE connector_id = ? AND enabled = 1").bind(connectorId).first<ConnectorRow>();
  if (!connector) throw new Error(biInline("Connector not found.", "Конектор не знайдено."));

  if (connector.mode === "child_worker") return callChildWorkerConnector(env, connector, actionName, args.input || {}, args.dry_run || false);

  const action = await db.prepare("SELECT * FROM connector_actions WHERE connector_id = ? AND action_name = ?").bind(connectorId, actionName).first<ActionRow>();
  if (!action) throw new Error(biInline("Connector action not found.", "Дію конектора не знайдено."));

  const result = await callInternalAction(env, action, args.input || {}, args.dry_run || false);
  await audit(db, connectorId, actionName, args.dry_run ? "dry_run_action" : "call_action", true, `${action.method} ${action.url}`);
  return result;
}

async function saveConnectorAction(db: D1Database, connectorId: string, action: z.infer<typeof actionSchema>, now: number): Promise<void> {
  const actionName = normalizeKey(action.name);
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

async function callInternalAction(env: Env, action: ActionRow, input: JsonObject, dryRun: boolean) {
  assertUrlTemplateInput(action.url, input);
  const url = assertSafeOutboundUrl(renderUrlString(action.url, input));
  const method = action.method.toUpperCase();
  const headers = new Headers({ accept: "application/json, text/plain;q=0.9, */*;q=0.1" });

  const customHeaders = parseJsonObject(action.headers_json);
  validateSafeHeaders(customHeaders);
  for (const [key, value] of Object.entries(customHeaders)) headers.set(key, renderScalar(value, input));

  const query = parseJsonObject(action.query_json);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, renderScalar(value, input));

  await applyConnectorAuth(env, url, headers, parseJson<AuthConfig>(action.auth_json, { type: "none" }));

  const body = buildRequestBody(action, input, method, headers);
  const prepared = {
    method,
    url: redactUrlForOutput(url),
    headers: redactHeaders(headers),
    body_preview: body ? truncate(body, 2_000) : null,
  };

  if (dryRun) return { ok: true, dry_run: true, prepared_request: prepared };

  const response = await fetch(url.toString(), { method, headers, body, redirect: "manual" });
  const text = await response.text();
  return { ok: response.ok, request: prepared, response: buildConnectorResponse(response, text) };
}

function buildRequestBody(action: ActionRow, input: JsonObject, method: string, headers: Headers): string | undefined {
  if (["GET", "DELETE"].includes(method) || !action.body_template_json) return undefined;
  const template = JSON.parse(action.body_template_json) as unknown;
  const rendered = renderTemplate(template, input);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return typeof rendered === "string" ? rendered : JSON.stringify(rendered);
}

async function callChildWorkerConnector(env: Env, connector: ConnectorRow, actionName: string, input: JsonObject, dryRun: boolean) {
  if (!connector.child_worker_url) throw new Error(biInline("Child Worker URL is not configured.", "URL child Worker не налаштований."));
  const endpoint = new URL("/tools/call", assertSafeOutboundUrl(connector.child_worker_url));
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (connector.child_worker_token_secret) headers.set("x-oneaiworkers-child-token", getSecret(env, connector.child_worker_token_secret));

  const payload = { name: actionName, arguments: input, dry_run: dryRun };
  if (dryRun) return { ok: true, dry_run: true, child_worker_url: redactUrlForOutput(endpoint), payload };

  const response = await fetch(endpoint.toString(), { method: "POST", headers, body: JSON.stringify(payload), redirect: "manual" });
  const text = await response.text();
  return { ok: response.ok, child_worker_url: redactUrlForOutput(endpoint), response: buildConnectorResponse(response, text) };
}

async function listActionsForConnector(env: Env, db: D1Database, connectorId: string) {
  const rows = await db.prepare("SELECT * FROM connector_actions WHERE connector_id = ? ORDER BY action_name").bind(connectorId).all<ActionRow>();
  return (rows.results || []).map((row) => ({
    name: row.action_name,
    description: row.description,
    method: row.method,
    url: redactTemplatedUrl(row.url),
    auth: publicAuth(parseJson<AuthConfig>(row.auth_json, { type: "none" }), env),
    input_schema: row.input_schema_json ? parseJson<unknown>(row.input_schema_json, null) : null,
  }));
}

function collectRequiredSecrets(env: Env, actions: ActionRow[]) {
  const secretNames = new Set<string>();
  for (const action of actions) for (const name of getAuthSecretNames(parseJson<AuthConfig>(action.auth_json, { type: "none" }))) secretNames.add(name);
  return [...secretNames].sort().map((name) => ({ name, configured: isSecretConfigured(env, name), value: "[hidden]" }));
}

function validateChildWorkerConfig(childWorkerUrl?: string, childWorkerTokenSecret?: string): void {
  if (!childWorkerUrl) throw new Error(biInline("child_worker_url is required for child_worker mode.", "Для режиму child_worker потрібен child_worker_url."));
  assertSafeOutboundUrl(childWorkerUrl);
  if (childWorkerTokenSecret) validateSecretName(childWorkerTokenSecret);
}

function publicConnector(row: ConnectorRow) {
  return {
    connector_id: row.connector_id,
    name: row.name,
    description: row.description,
    mode: row.mode as ConnectorMode,
    child_worker_url: row.child_worker_url ? redactUrlForOutput(assertSafeOutboundUrl(row.child_worker_url)) : null,
    child_worker_token_secret: row.child_worker_token_secret || null,
    enabled: Boolean(row.enabled),
    updated_at: row.updated_at,
  };
}

function normalizeKey(value: string): string {
  return safeKey(value).replaceAll(":", "-");
}

function getDb(env: Env): D1Database {
  if (!env.OAUTH_DB) throw new Error(biInline("D1 database is not configured.", "D1 база не налаштована."));
  return env.OAUTH_DB;
}

async function audit(db: D1Database, connectorId: string | null, actionName: string | null, event: string, ok: boolean, message: string) {
  await db.prepare(
    "INSERT INTO connector_audit_log (id, connector_id, action_name, event, ok, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), connectorId, actionName, event, ok ? 1 : 0, message.slice(0, MAX_RESPONSE_TEXT), nowSeconds()).run();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
