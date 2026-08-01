import { z } from "zod";
import { APP_VERSION } from "../update";
import {
  createConnectorAccessToken,
  credentialsReady,
  ensureCredentialSchema,
  getPluginConnectionHealth,
  loadCredentialProfile,
  setPluginConnectionHealth,
  storeCredentialProfile,
  type CredentialField,
} from "../vault";
import {
  connectorInstallationHelp,
  connectorInstallationHelpSchema,
  connectorSettingsLinkSchema,
  connectorUpdatesSchema,
  ensureMarketplaceSchema,
  fetchMarketplaceCatalog,
  findCapability,
  findCapabilitySchema,
  getInstalledPackage,
  listConnectorUpdates,
} from "../marketplace";
import { biInline } from "../i18n";
import { errorMessage } from "../response";
import { assertSafeOutboundUrl, redactSensitiveText, redactSensitiveValue, redactUrlForOutput, safeKey } from "../security";
import type { Env } from "../types";
import { applyConnectorAuth, authSchema, getAuthSecretNames, getSecret, isSecretConfigured, publicAuth, redactHeaders, validateAuth, validateSafeHeaders, validateSecretName } from "./connectors/auth";
import { buildConnectorResponse } from "./connectors/response";
import { assertUrlTemplateInput, parseJson, parseJsonObject, redactTemplatedUrl, renderScalar, renderTemplate, renderUrlString, truncate, validateTemplatedUrl } from "./connectors/templates";
import type { ActionRow, AuthConfig, ConnectorMode, ConnectorRow, JsonObject } from "./connectors/types";
import { callNativeTool, isNativeConnectorId, nativeConnectorView } from "./native";

const MAX_RESPONSE_TEXT = 24_000;
const SYSTEM_CONNECTOR_ID = "system";

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
  child_worker_url: z.string().url().optional().describe(biInline("Advanced mode fallback. Protected HTTPS URL of the child Worker. Users should still call it through the main gateway by default.", "Fallback для розширеного режиму. Захищений HTTPS URL child Worker. Користувачі за замовчуванням все одно мають викликати його через основний gateway.")),
  child_worker_binding: z.string().min(2).max(80).optional().describe(biInline("Advanced production mode. Cloudflare Service Binding name for a private child Worker, for example TELEGRAM_CHILD.", "Production-режим. Назва Cloudflare Service Binding для приватного child Worker, наприклад TELEGRAM_CHILD.")),
  child_worker_token_secret: z.string().min(2).max(80).optional().describe(biInline("Secret name that stores the internal token for the child Worker URL/binding, if the child requires it.", "Назва secret, де зберігається внутрішній token для child Worker URL/binding, якщо child його вимагає.")),
  child_worker_token_credential: z.string().min(2).max(80).optional().describe(biInline("Managed encrypted credential key for an installed child Worker.", "Ключ зашифрованого службового значення для встановленого дочірнього Worker.")),
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

export const deletePluginsSchema = {
  plugin_ids: z.array(z.string().min(2).max(80)).min(1).max(20),
};

export const callConnectorToolSchema = {
  connector_id: z.string().min(2).max(80),
  action_name: z.string().min(1).max(80),
  input: z.record(z.string(), z.unknown()).default({}),
  dry_run: z.boolean().default(false).describe(biInline("If true, show the prepared request without calling the API.", "Якщо true, показати підготовлений запит без виклику API.")),
  confirmed: z.boolean().default(false).describe(biInline("Required for actions that can create external side effects.", "Потрібно для actions, які можуть створити зовнішні side effects.")),
  confirmation_token: z.string().min(20).max(300).optional(),
  idempotency_key: z.string().min(1).max(200).optional(),
};

export const testConnectorSchema = {
  connector_id: z.string().min(2).max(80),
  action_name: z.string().min(1).max(80).optional(),
  input: z.record(z.string(), z.unknown()).default({}),
  dry_run: z.boolean().default(true),
  confirmed: z.boolean().default(false).describe(biInline("Required when dry_run=false for an action that can create an external side effect.", "Потрібно, коли dry_run=false для action, яка може створити зовнішній side effect.")),
};

export interface SystemActionDefinition {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  read_only: boolean;
  requires_confirmation: boolean;
}

function systemAction(
  name: string,
  description: string,
  shape: Record<string, z.ZodType>,
  options: { readOnly?: boolean; requiresConfirmation?: boolean } = {},
): SystemActionDefinition {
  return {
    name,
    description,
    schema: z.object(shape),
    read_only: options.readOnly ?? true,
    requires_confirmation: options.requiresConfirmation ?? false,
  };
}

export const SYSTEM_ACTIONS: SystemActionDefinition[] = [
  systemAction("runtime_info", "Returns the live Worker version and stable gateway contract.", {}),
  systemAction("list_connectors", "Reads the current connector registry directly from D1.", listConnectorsSchema),
  systemAction("connector_setup_status", "Reads the current connector engine and credential readiness.", connectorSetupStatusSchema),
  systemAction("connector_installation_help", "Returns the current connector installation flow.", connectorInstallationHelpSchema),
  systemAction("find_capability", "Searches the live marketplace catalog for a compatible connector.", findCapabilitySchema),
  systemAction("list_connector_updates", "Checks the live marketplace for installed connector updates.", connectorUpdatesSchema),
  systemAction("get_connector_settings_link", "Creates a short-lived protected browser link for connector credentials.", connectorSettingsLinkSchema, { readOnly: false }),
  systemAction("save_connector", "Creates or updates a connector manifest in D1.", saveConnectorSchema, { readOnly: false, requiresConfirmation: true }),
  systemAction("test_connector", "Tests a connector action, using dry-run by default.", testConnectorSchema, { readOnly: false }),
  systemAction("delete_connector", "Deletes a connector and its stored credentials.", connectorIdSchema, { readOnly: false, requiresConfirmation: true }),
  systemAction("delete_plugins", "Deletes several plugins and all of their stored settings in one confirmed action.", deletePluginsSchema, { readOnly: false, requiresConfirmation: true }),
];

export interface ConnectorMcpTool {
  tool_name: string;
  title: string;
  description: string;
  connector_id: string;
  connector_name: string;
  action_name: string;
  method: string;
  input_schema: unknown;
  read_only: boolean;
  destructive: boolean;
  side_effect: boolean;
}

export interface PluginCredentialDefinition {
  connector_id: string;
  name: string;
  fields: CredentialField[];
  source: "marketplace" | "manifest" | "none";
}

export interface PluginCredentialState extends PluginCredentialDefinition {
  required: boolean;
  ready: boolean;
  storage: "encrypted_d1" | "cloudflare_secret" | "none" | "incomplete";
  verification: "not_required" | "not_checked" | "active" | "error";
  last_checked_at: number | null;
  last_http_status: number | null;
  last_error: string | null;
  updated_at: number;
}

interface ConnectorActionToolRow extends ActionRow {
  connector_name: string;
  connector_description: string | null;
  connector_mode: ConnectorMode;
}

export async function listConnectorMcpTools(env: Env): Promise<ConnectorMcpTool[]> {
  const db = getDb(env);
  await ensureConnectorSchema(env);
  const rows = await db.prepare(
    `SELECT
       a.*,
       c.name AS connector_name,
       c.description AS connector_description,
       c.mode AS connector_mode
     FROM connector_actions a
     JOIN connectors c ON c.connector_id = a.connector_id
     WHERE c.enabled = 1
     ORDER BY a.connector_id, a.action_name`,
  ).all<ConnectorActionToolRow>();

  const usedNames = new Set<string>();
  return (rows.results || []).map((row) => {
    const toolName = uniqueToolName(`${toolNamePart(row.connector_id)}_${toolNamePart(row.action_name)}`, usedNames);
    const readOnly = isReadOnlyConnectorAction(row);
    const destructive = isDestructiveConnectorAction(row);
    return {
      tool_name: toolName,
      title: `${row.connector_name}: ${humanizeActionName(row.action_name)}`,
      description: buildConnectorToolDescription(row, readOnly, destructive),
      connector_id: row.connector_id,
      connector_name: row.connector_name,
      action_name: row.action_name,
      method: row.method,
      input_schema: row.input_schema_json ? parseJson<unknown>(row.input_schema_json, null) : null,
      read_only: readOnly,
      destructive,
      side_effect: !readOnly,
    };
  });
}

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
          child_worker_binding TEXT,
          child_worker_token_secret TEXT,
          child_worker_token_credential TEXT,
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
      await ensureColumn(db, "connectors", "child_worker_binding", "TEXT");
      await ensureColumn(db, "connectors", "child_worker_token_credential", "TEXT");
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function connectorSetupStatus(env: Env, args: z.infer<z.ZodObject<typeof connectorSetupStatusSchema>>) {
  let marketplaceLive: { reachable: boolean; plugins: number; items: Array<{ plugin_id: string; version: string }>; error?: string };
  try {
    const marketplaceItems = await fetchMarketplaceCatalog(env);
    marketplaceLive = {
      reachable: true,
      plugins: marketplaceItems.length,
      items: marketplaceItems.map((item) => ({ plugin_id: item.id, version: item.version })),
    };
  } catch (error) {
    marketplaceLive = { reachable: false, plugins: 0, items: [], error: errorMessage(error) };
  }
  const base = {
    d1_database: Boolean(env.OAUTH_DB),
    mcp_shared_secret: Boolean(env.MCP_SHARED_SECRET),
    workers_ai: Boolean(env.AI),
    agent_manager: Boolean(env.AGENT_MANAGER),
    encrypted_credentials: Boolean(env.CREDENTIALS_MASTER_KEY),
    marketplace: true,
    marketplace_live: marketplaceLive,
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
  const actionRows = await db.prepare("SELECT * FROM connector_actions ORDER BY connector_id, action_name").all<ActionRow>();
  const connectorRows = await db.prepare("SELECT * FROM connectors WHERE enabled = 1 ORDER BY connector_id").all<ConnectorRow>();
  const credentialStates = await listPluginCredentialStates(env);
  const requiredSecrets = await collectRequiredSecrets(env, actionRows.results || [], connectorRows.results || []);
  const serviceBindings = collectServiceBindings(env, connectorRows.results || []);
  return {
    ok: true,
    configured: base,
    gateway: {
      public_entrypoint: "/mcp",
      child_workers_called_through_gateway_by_default: true,
      supported_child_invocations: ["service_binding", "protected_url"],
    },
    connectors: args.include_connectors ? (await listConnectors(env, { include_actions: true })).connectors : undefined,
    plugin_credentials: credentialStates.map((state) => ({
      plugin_id: state.connector_id,
      required: state.required,
      ready: state.ready,
      storage: state.storage,
      verification: state.verification,
      last_checked_at: state.last_checked_at,
      last_http_status: state.last_http_status,
      last_error: state.last_error,
    })),
    required_secrets: requiredSecrets,
    missing_secrets: requiredSecrets.filter((item) => !item.configured).map((item) => `${item.plugin_id}:${item.name}`),
    service_bindings: serviceBindings,
    missing_service_bindings: serviceBindings.filter((item) => !item.configured).map((item) => item.name),
  };
}

export async function saveConnector(env: Env, args: z.infer<z.ZodObject<typeof saveConnectorSchema>>) {
  const db = getDb(env);
  await ensureConnectorSchema(env);

  const connectorId = safeKey(args.connector_id).replaceAll(":", "-");
  if (isNativeConnectorId(connectorId) || isSystemConnectorId(connectorId)) {
    throw new Error(biInline(
      "Virtual system connector IDs are reserved by OneAIWorkers and cannot be overwritten.",
      "ID віртуальних системних конекторів зарезервовані OneAIWorkers і не можуть бути перезаписані.",
    ));
  }
  const now = nowSeconds();
  const mode = args.mode || "internal";
  if (mode === "child_worker") validateChildWorkerConfig(
    args.child_worker_url,
    args.child_worker_binding,
    args.child_worker_token_secret,
    args.child_worker_token_credential,
  );

  const statements: D1PreparedStatement[] = [db.prepare(
    `INSERT INTO connectors (connector_id, name, description, mode, child_worker_url, child_worker_binding, child_worker_token_secret, child_worker_token_credential, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(connector_id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       mode = excluded.mode,
       child_worker_url = excluded.child_worker_url,
       child_worker_binding = excluded.child_worker_binding,
       child_worker_token_secret = excluded.child_worker_token_secret,
       child_worker_token_credential = excluded.child_worker_token_credential,
       enabled = 1,
       updated_at = excluded.updated_at`,
  ).bind(
    connectorId,
    args.name,
    args.description || null,
    mode,
    args.child_worker_url || null,
    args.child_worker_binding || null,
    args.child_worker_token_secret || null,
    args.child_worker_token_credential || null,
    now,
    now,
  )];
  statements.push(db.prepare("DELETE FROM connector_actions WHERE connector_id = ?").bind(connectorId));
  statements.push(...args.actions.map((action) => prepareConnectorAction(db, connectorId, action, now)));
  statements.push(db.prepare(
    "INSERT INTO connector_audit_log (id, connector_id, action_name, event, ok, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), connectorId, null, "save_connector", 1, `Saved ${args.actions.length} actions`, now));

  await db.batch(statements);
  return {
    ok: true,
    connector_id: connectorId,
    actions: args.actions.length,
    mode,
    tool_names: args.actions.map((action) => `${toolNamePart(connectorId)}_${toolNamePart(action.name)}`),
    stable_gateway_ready: true,
    refresh_required_for_shortcut_tools_only: true,
    next_step: biInline(
      "Use list_connectors and call_connector_tool immediately. Refreshing the MCP tool list is optional and only adds top-level shortcut tools.",
      "Одразу використовуйте list_connectors і call_connector_tool. Оновлення списку MCP-команд необов’язкове й лише додає окремі короткі команди.",
    ),
  };
}

export async function listConnectors(env: Env, args: z.infer<z.ZodObject<typeof listConnectorsSchema>>) {
  const connectors: JsonObject[] = [
    systemConnectorView(env, args.include_actions),
    nativeConnectorView(env, args.include_actions),
  ];
  if (!env.OAUTH_DB) return liveConnectorSnapshot(env, connectors);

  const db = getDb(env);
  await ensureConnectorSchema(env);
  const rows = await db.prepare("SELECT * FROM connectors WHERE enabled = 1 ORDER BY connector_id").all<ConnectorRow>();
  for (const row of rows.results || []) {
    const item: JsonObject = publicConnector(row);
    const installedPackage = await getInstalledPackage(env, row.connector_id);
    const credentialState = await getPluginCredentialState(env, row.connector_id);
    item.credentials = {
      required: credentialState.required,
      configured: credentialState.ready,
      storage: credentialState.storage,
      verification: credentialState.verification,
      last_checked_at: credentialState.last_checked_at,
      last_http_status: credentialState.last_http_status,
      last_error: credentialState.last_error,
    };
    if (installedPackage) {
      const fields = parseJson<Array<{ id?: unknown; required?: unknown }>>(installedPackage.credential_fields_json, []);
      const credentials = env.CREDENTIALS_MASTER_KEY
        ? await loadCredentialProfile(env, row.connector_id, "user")
        : {};
      item.marketplace_package = {
        package_id: installedPackage.package_id,
        installed_version: installedPackage.installed_version,
        credentials_configured: fields.every((field) =>
          field.required !== true || (typeof field.id === "string" && Boolean(credentials[field.id]?.trim()))
        ),
      };
    }
    if (args.include_actions) item.actions = await listActionsForConnector(env, db, row.connector_id);
    connectors.push(item);
  }
  return liveConnectorSnapshot(env, connectors);
}

export async function getConnectorSettingsLink(env: Env, baseUrl: string, connectorId: string) {
  const definition = await getPluginCredentialDefinition(env, connectorId);
  const token = await createConnectorAccessToken(env, definition.connector_id);
  const settingsUrl = `${requireBaseUrl(baseUrl)}/plugins/access/${encodeURIComponent(token)}`;
  return {
    ok: true,
    connector_id: definition.connector_id,
    settings_url: settingsUrl,
    expires_in_seconds: 600,
    response_instruction: biInline(
      `Put this link first and tell the user to open it in a normal browser: ${settingsUrl}`,
      `Поставте це посилання першим і скажіть користувачу відкрити його у звичайному браузері: ${settingsUrl}`,
    ),
  };
}

export async function getPluginCredentialDefinition(env: Env, connectorId: string): Promise<PluginCredentialDefinition> {
  const normalized = normalizeKey(connectorId);
  const db = getDb(env);
  await ensureConnectorSchema(env);
  const connector = await db.prepare(
    "SELECT * FROM connectors WHERE connector_id = ? AND enabled = 1",
  ).bind(normalized).first<ConnectorRow>();
  if (!connector) throw new Error(biInline("Plugin not found.", "Плагін не знайдено."));

  const actions = await db.prepare(
    "SELECT * FROM connector_actions WHERE connector_id = ? ORDER BY action_name",
  ).bind(normalized).all<ActionRow>();
  const installed = await getInstalledPackage(env, normalized);
  const marketplaceFields = installed ? parseStoredCredentialFields(installed.credential_fields_json) : [];
  const inferredFields = inferCredentialFields(actions.results || []);
  const fields = mergeCredentialFields(marketplaceFields, inferredFields);
  return {
    connector_id: normalized,
    name: connector.name,
    fields,
    source: marketplaceFields.length ? "marketplace" : inferredFields.length ? "manifest" : "none",
  };
}

export async function getPluginCredentialState(env: Env, connectorId: string): Promise<PluginCredentialState> {
  const definition = await getPluginCredentialDefinition(env, connectorId);
  const credentials = definition.fields.length && env.CREDENTIALS_MASTER_KEY
    ? await loadCredentialProfile(env, definition.connector_id, "user")
    : {};
  const effective = { ...legacySecretValues(env, definition.fields), ...credentials };
  const required = definition.fields.some((field) => field.required);
  const ready = credentialsReady(effective, definition.fields);
  const managedReady = credentialsReady(credentials, definition.fields);
  const legacyReady = credentialsReady(legacySecretValues(env, definition.fields), definition.fields);
  const connector = await getDb(env).prepare(
    "SELECT updated_at FROM connectors WHERE connector_id = ?",
  ).bind(definition.connector_id).first<{ updated_at: number }>();
  const health = required ? await getPluginConnectionHealth(env, definition.connector_id) : null;
  return {
    ...definition,
    required,
    ready,
    storage: !required ? "none" : managedReady ? "encrypted_d1" : legacyReady ? "cloudflare_secret" : "incomplete",
    verification: !required ? "not_required" : health?.status || "not_checked",
    last_checked_at: health?.checked_at || null,
    last_http_status: health?.http_status ?? null,
    last_error: health?.status === "error" ? health.message : null,
    updated_at: connector?.updated_at || nowSeconds(),
  };
}

export async function listPluginCredentialStates(env: Env): Promise<PluginCredentialState[]> {
  const db = getDb(env);
  await ensureConnectorSchema(env);
  const rows = await db.prepare(
    "SELECT connector_id FROM connectors WHERE enabled = 1 ORDER BY connector_id",
  ).all<{ connector_id: string }>();
  const states: PluginCredentialState[] = [];
  for (const row of rows.results || []) states.push(await getPluginCredentialState(env, row.connector_id));
  return states;
}

export async function migrateLegacyPluginCredentials(env: Env): Promise<{ migrated: string[] }> {
  if (!env.CREDENTIALS_MASTER_KEY || !env.OAUTH_DB) return { migrated: [] };
  const states = await listPluginCredentialStates(env);
  const migrated: string[] = [];
  for (const state of states) {
    if (!state.fields.length) continue;
    const existing = await loadCredentialProfile(env, state.connector_id, "user");
    const legacy = legacySecretValues(env, state.fields);
    const merged = { ...legacy, ...existing };
    if (Object.keys(merged).length === Object.keys(existing).length) continue;
    await storeCredentialProfile(env, state.connector_id, "user", merged);
    migrated.push(state.connector_id);
  }
  return { migrated };
}

export async function verifyPluginConnection(env: Env, connectorId: string) {
  const normalized = normalizeKey(connectorId);
  const state = await getPluginCredentialState(env, normalized);
  if (state.required && !state.ready) {
    return {
      ok: false,
      plugin_id: normalized,
      verification: "missing_credentials",
      message: biInline("Required settings are missing.", "Немає обов’язкових налаштувань."),
    };
  }

  const db = getDb(env);
  const actions = await db.prepare(
    "SELECT * FROM connector_actions WHERE connector_id = ? ORDER BY action_name",
  ).bind(normalized).all<ActionRow>();
  const action = chooseConnectionCheckAction(actions.results || []);
  if (!action) {
    return {
      ok: true,
      plugin_id: normalized,
      verification: "not_available",
      message: biInline(
        "Settings were saved, but this plugin does not provide a safe connection check.",
        "Налаштування збережено, але цей плагін не має безпечної перевірки зв’язку.",
      ),
    };
  }

  const result = await callConnectorTool(env, {
    connector_id: normalized,
    action_name: action.action_name,
    input: {},
    dry_run: false,
    confirmed: true,
  });
  const outcome = await recordPluginConnectionResult(env, normalized, result, true);
  return {
    ok: outcome.ok,
    plugin_id: normalized,
    verification: outcome.ok ? "active" : "error",
    action_name: action.action_name,
    http_status: outcome.httpStatus,
    message: outcome.ok
      ? biInline("Connection verified.", "Зв’язок перевірено.")
      : outcome.message,
  };
}

function systemConnectorView(env: Env, includeActions: boolean): JsonObject {
  const connector: JsonObject = {
    connector_id: SYSTEM_CONNECTOR_ID,
    name: "OneAIWorkers System",
    description: "Stable live gateway for connector discovery, installation, settings, testing, saving, and updates. Use this through call_connector_tool when a client has cached an older top-level MCP tool list.",
    mode: "system",
    virtual: true,
    persisted_in_d1: false,
    gateway_route: "call_connector_tool",
    enabled: true,
    runtime_version: APP_VERSION,
    connector_registry_source: env.OAUTH_DB ? "D1_live" : "unavailable",
  };
  if (includeActions) {
    connector.actions = SYSTEM_ACTIONS.map((action) => ({
      name: action.name,
      description: action.description,
      input_schema: z.toJSONSchema(action.schema),
      read_only: action.read_only,
      side_effect: !action.read_only,
      consumes_ai: false,
      requires_confirmation: action.requires_confirmation,
      available: systemActionAvailable(env, action.name),
    }));
  }
  return connector;
}

async function callSystemTool(
  env: Env,
  baseUrl: string,
  invocation: {
    action_name: string;
    input: Record<string, unknown>;
    dry_run: boolean;
    confirmed: boolean;
  },
): Promise<unknown> {
  const action = findSystemAction(invocation.action_name);
  if (!action) {
    throw new Error(biInline(
      `Unknown system action: ${invocation.action_name}. Use list_connectors with include_actions=true and connector_id=system to discover current management actions.`,
      `Невідома системна дія: ${invocation.action_name}. Використайте list_connectors з include_actions=true і connector_id=system, щоб отримати актуальні дії керування.`,
    ));
  }

  const input: Record<string, unknown> = { ...invocation.input };
  if ("confirmed" in action.schema.shape) input.confirmed = invocation.confirmed || input.confirmed;
  const parsed = action.schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(biInline(
      `Invalid input for ${action.name}: ${z.prettifyError(parsed.error)}`,
      `Некоректні параметри для ${action.name}: ${z.prettifyError(parsed.error)}`,
    ));
  }

  if (invocation.dry_run) {
    return {
      ok: true,
      system: true,
      dry_run: true,
      action_name: action.name,
      validated_input: parsed.data,
      requires_confirmation: action.requires_confirmation,
      note: "No system action was executed.",
    };
  }

  if (action.requires_confirmation && !invocation.confirmed) {
    throw new Error(biInline(
      `Explicit confirmation is required for system action ${action.name}. Retry call_connector_tool with confirmed=true after the user approves.`,
      `Для системної дії ${action.name} потрібне явне підтвердження. Повторіть call_connector_tool з confirmed=true після згоди користувача.`,
    ));
  }

  let result: unknown;
  switch (action.name) {
    case "runtime_info":
      result = {
        ok: true,
        name: env.HUB_NAME || "OneAIWorkers",
        version: APP_VERSION,
        generated_at: new Date().toISOString(),
        connector_registry_source: env.OAUTH_DB ? "D1_live" : "unavailable",
        stable_gateway: {
          discovery_tool: "list_connectors",
          invocation_tool: "call_connector_tool",
          system_connector_id: SYSTEM_CONNECTOR_ID,
          native_connector_id: "native",
        },
      };
      break;
    case "list_connectors":
      result = await listConnectors(env, parseSystemInput(listConnectorsSchema, parsed.data));
      break;
    case "connector_setup_status":
      result = await connectorSetupStatus(env, parseSystemInput(connectorSetupStatusSchema, parsed.data));
      break;
    case "connector_installation_help":
      result = connectorInstallationHelp(parseSystemInput(connectorInstallationHelpSchema, parsed.data));
      break;
    case "find_capability":
      result = await findCapability(env, requireBaseUrl(baseUrl), parseSystemInput(findCapabilitySchema, parsed.data));
      break;
    case "list_connector_updates":
      result = await listConnectorUpdates(env, requireBaseUrl(baseUrl));
      break;
    case "get_connector_settings_link":
      result = await getConnectorSettingsLink(
        env,
        requireBaseUrl(baseUrl),
        parseSystemInput(connectorSettingsLinkSchema, parsed.data).connector_id,
      );
      break;
    case "save_connector":
      result = await saveConnector(env, parseSystemInput(saveConnectorSchema, parsed.data));
      break;
    case "test_connector": {
      const testInput = parseSystemInput(testConnectorSchema, parsed.data);
      if (
        isSystemConnectorId(normalizeKey(testInput.connector_id)) &&
        testInput.action_name &&
        normalizeKey(testInput.action_name) === "test_connector"
      ) {
        throw new Error(biInline(
          "The system test action cannot test itself.",
          "Системна дія перевірки не може перевіряти саму себе.",
        ));
      }
      result = await testConnector(env, testInput, baseUrl);
      break;
    }
    case "delete_connector":
      result = await deleteConnector(env, parseSystemInput(connectorIdSchema, parsed.data));
      break;
    case "delete_plugins":
      result = await deletePlugins(env, parseSystemInput(deletePluginsSchema, parsed.data));
      break;
    default:
      throw new Error(`Unsupported system action: ${action.name}`);
  }

  return {
    ok: true,
    system: true,
    action_name: action.name,
    result,
  };
}

function findSystemAction(actionName: string): SystemActionDefinition | undefined {
  const normalized = actionName.startsWith("system_") ? actionName.slice("system_".length) : actionName;
  return SYSTEM_ACTIONS.find((action) => action.name === normalized);
}

function parseSystemInput<T extends Record<string, z.ZodType>>(
  shape: T,
  input: unknown,
): z.infer<z.ZodObject<T>> {
  return z.object(shape).parse(input);
}

function isSystemConnectorId(connectorId: string): boolean {
  return connectorId === SYSTEM_CONNECTOR_ID || connectorId === "management";
}

function systemActionAvailable(env: Env, actionName: string): boolean {
  if (["list_connector_updates", "get_connector_settings_link", "save_connector", "test_connector", "delete_connector", "delete_plugins"].includes(actionName)) {
    return Boolean(env.OAUTH_DB);
  }
  return true;
}

function liveConnectorSnapshot(env: Env, connectors: JsonObject[]) {
  return {
    ok: true,
    runtime: liveGatewayMetadata(env),
    connectors,
  };
}

function withLiveGatewayMetadata(result: unknown, env: Env): unknown {
  const gatewayRuntime = liveGatewayMetadata(env);
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), gateway_runtime: gatewayRuntime };
  }
  return { ok: true, result, gateway_runtime: gatewayRuntime };
}

function liveGatewayMetadata(env: Env) {
  return {
    version: APP_VERSION,
    generated_at: new Date().toISOString(),
    connector_registry_source: env.OAUTH_DB ? "D1_live" : "unavailable",
    http_cache: "no-store",
  };
}

function requireBaseUrl(baseUrl: string): string {
  if (!baseUrl) {
    throw new Error(biInline(
      "The live Worker address is unavailable for this action.",
      "Для цієї дії недоступна жива адреса Worker.",
    ));
  }
  return new URL(baseUrl).origin;
}

export async function deleteConnector(env: Env, args: z.infer<z.ZodObject<typeof connectorIdSchema>>) {
  const connectorId = normalizeKey(args.connector_id);
  const result = await deletePlugins(env, { plugin_ids: [connectorId] });
  return { ok: true, connector_id: connectorId, deleted: result.deleted_plugin_ids.includes(connectorId) };
}

export async function deletePlugins(env: Env, args: z.infer<z.ZodObject<typeof deletePluginsSchema>>) {
  const pluginIds = [...new Set(args.plugin_ids.map(normalizeKey))];
  for (const pluginId of pluginIds) {
    if (isNativeConnectorId(pluginId) || isSystemConnectorId(pluginId)) {
      throw new Error(biInline(
        `System plugin cannot be deleted: ${pluginId}`,
        `Системний плагін не можна видалити: ${pluginId}`,
      ));
    }
  }
  const db = getDb(env);
  await ensureConnectorSchema(env);
  await ensureMarketplaceSchema(env);
  await ensureCredentialSchema(env);
  const existing: string[] = [];
  for (const pluginId of pluginIds) {
    const row = await db.prepare("SELECT connector_id FROM connectors WHERE connector_id = ?")
      .bind(pluginId).first<{ connector_id: string }>();
    if (row) existing.push(pluginId);
  }
  const statements: D1PreparedStatement[] = [];
  for (const pluginId of existing) {
    statements.push(db.prepare("DELETE FROM connector_actions WHERE connector_id = ?").bind(pluginId));
    statements.push(db.prepare("DELETE FROM connectors WHERE connector_id = ?").bind(pluginId));
    statements.push(db.prepare("DELETE FROM connector_packages WHERE connector_id = ?").bind(pluginId));
    statements.push(db.prepare("DELETE FROM connector_credentials WHERE connector_id = ?").bind(pluginId));
    statements.push(db.prepare("DELETE FROM connector_access_tokens WHERE connector_id = ?").bind(pluginId));
    statements.push(db.prepare("DELETE FROM plugin_connection_health WHERE connector_id = ?").bind(pluginId));
    statements.push(db.prepare(
      "INSERT INTO connector_audit_log (id, connector_id, action_name, event, ok, message, created_at) VALUES (?, ?, NULL, 'delete_plugin', 1, 'Deleted plugin and stored settings', ?)",
    ).bind(crypto.randomUUID(), pluginId, nowSeconds()));
  }
  if (statements.length) await db.batch(statements);
  return {
    ok: true,
    deleted_plugin_ids: existing,
    not_found_plugin_ids: pluginIds.filter((pluginId) => !existing.includes(pluginId)),
  };
}

export async function testConnector(
  env: Env,
  args: z.infer<z.ZodObject<typeof testConnectorSchema>>,
  baseUrl = "",
) {
  const connectorId = normalizeKey(args.connector_id);
  const actionName = args.action_name ? normalizeKey(args.action_name) : null;
  if (isSystemConnectorId(connectorId)) {
    if (!actionName) return { ok: true, connector: systemConnectorView(env, true) };
    if (findSystemAction(actionName)) {
      return callSystemTool(env, baseUrl, {
        action_name: actionName,
        input: args.input || {},
        dry_run: args.dry_run ?? true,
        confirmed: args.confirmed ?? false,
      });
    }
  }
  if (isNativeConnectorId(connectorId)) {
    if (!actionName) return { ok: true, connector: nativeConnectorView(env, true) };
    if (findSystemAction(actionName)) {
      return callSystemTool(env, baseUrl, {
        action_name: actionName,
        input: args.input || {},
        dry_run: args.dry_run ?? true,
        confirmed: args.confirmed ?? false,
      });
    }
    return callNativeTool(env, {
      action_name: actionName,
      input: args.input || {},
      dry_run: args.dry_run ?? true,
      confirmed: args.confirmed ?? false,
    });
  }

  const db = getDb(env);
  await ensureConnectorSchema(env);
  const actions = await listActionsForConnector(env, db, connectorId);
  if (!actions.length) throw new Error(biInline("Connector not found or has no actions.", "Конектор не знайдено або він не має дій."));
  if (!actionName) return { ok: true, connector_id: connectorId, actions };
  return callConnectorTool(env, {
    connector_id: connectorId,
    action_name: actionName,
    input: args.input || {},
    dry_run: args.dry_run ?? true,
    confirmed: args.confirmed ?? false,
  }, baseUrl);
}

export async function callConnectorTool(
  env: Env,
  args: z.infer<z.ZodObject<typeof callConnectorToolSchema>>,
  baseUrl = "",
) {
  const connectorId = normalizeKey(args.connector_id);
  const actionName = normalizeKey(args.action_name);
  if ((isSystemConnectorId(connectorId) || isNativeConnectorId(connectorId)) && findSystemAction(actionName)) {
    return withLiveGatewayMetadata(await callSystemTool(env, baseUrl, {
      action_name: actionName,
      input: args.input || {},
      dry_run: args.dry_run || false,
      confirmed: args.confirmed || false,
    }), env);
  }
  if (isNativeConnectorId(connectorId)) {
    return withLiveGatewayMetadata(await callNativeTool(env, {
      action_name: actionName,
      input: args.input || {},
      dry_run: args.dry_run || false,
      confirmed: args.confirmed || false,
    }), env);
  }

  const db = getDb(env);
  await ensureConnectorSchema(env);
  const connector = await db.prepare("SELECT * FROM connectors WHERE connector_id = ? AND enabled = 1").bind(connectorId).first<ConnectorRow>();
  if (!connector) throw new Error(biInline("Connector not found.", "Конектор не знайдено."));

  const action = await findConnectorAction(db, connectorId, actionName);
  if (!action) throw new Error(biInline("Connector action not found.", "Дію конектора не знайдено."));

  const dryRun = args.dry_run || false;
  if (!dryRun && !isReadOnlyConnectorAction(action) && !args.confirmed) {
    throw new Error(biInline(
      "This connector action can create an external side effect. Retry with confirmed=true after the user clearly approves the action.",
      "Ця дія connector може створити зовнішній side effect. Повторіть з confirmed=true після явного підтвердження користувача.",
    ));
  }

  if (connector.mode === "child_worker") {
    const childResult = await callChildWorkerConnector(env, connector, action.action_name, args.input || {}, dryRun);
    if (!dryRun) await recordPluginConnectionResult(env, connectorId, childResult);
    return withLiveGatewayMetadata(childResult, env);
  }

  const result = await callInternalAction(env, action, args.input || {}, dryRun);
  if (!dryRun) await recordPluginConnectionResult(env, connectorId, result);
  await audit(db, connectorId, actionName, args.dry_run ? "dry_run_action" : "call_action", true, `${action.method} ${action.url}`);
  return withLiveGatewayMetadata(result, env);
}

async function findConnectorAction(db: D1Database, connectorId: string, actionName: string): Promise<ActionRow | null> {
  const direct = await db.prepare("SELECT * FROM connector_actions WHERE connector_id = ? AND action_name = ?").bind(connectorId, actionName).first<ActionRow>();
  if (direct) return direct;

  const generatedToolPrefix = `${toolNamePart(connectorId)}_`;
  if (actionName.startsWith(generatedToolPrefix)) {
    const rawActionName = actionName.slice(generatedToolPrefix.length);
    if (rawActionName) {
      return await db.prepare("SELECT * FROM connector_actions WHERE connector_id = ? AND action_name = ?").bind(connectorId, rawActionName).first<ActionRow>();
    }
  }

  return null;
}

function prepareConnectorAction(db: D1Database, connectorId: string, action: z.infer<typeof actionSchema>, now: number): D1PreparedStatement {
  const actionName = normalizeKey(action.name);
  validateTemplatedUrl(action.url);
  validateAuth(action.auth as AuthConfig);
  validateSafeHeaders(action.headers || {});

  return db.prepare(
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
  );
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
  for (const [key, value] of Object.entries(query)) {
    const renderedValue = renderScalar(value, input);
    if (renderedValue !== "") url.searchParams.set(key, renderedValue);
  }

  const auth = parseJson<AuthConfig>(action.auth_json, { type: "none" });
  const credentials = getAuthSecretNames(auth).length && env.CREDENTIALS_MASTER_KEY
    ? await loadCredentialProfile(env, action.connector_id, "user")
    : {};
  await applyConnectorAuth(
    env,
    url,
    headers,
    auth,
    credentials,
  );

  const body = buildRequestBody(action, input, method, headers);
  const prepared = {
    method,
    url: redactUrlForOutput(url),
    headers: redactHeaders(headers),
    body_preview: body ? truncate(redactSensitiveText(body), 2_000) : null,
  };

  if (dryRun) return { ok: true, dry_run: true, prepared_request: prepared };

  const response = await fetch(url.toString(), { method, headers, body, redirect: "manual" });
  const text = await response.text();
  return { ok: response.ok, request: prepared, response: buildConnectorResponse(response, text, protectedRequestValues(headers, url)) };
}

function buildRequestBody(action: ActionRow, input: JsonObject, method: string, headers: Headers): string | undefined {
  if (["GET", "DELETE"].includes(method) || !action.body_template_json) return undefined;
  const template = JSON.parse(action.body_template_json) as unknown;
  const rendered = renderTemplate(template, input);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return typeof rendered === "string" ? rendered : JSON.stringify(rendered);
}

async function callChildWorkerConnector(env: Env, connector: ConnectorRow, actionName: string, input: JsonObject, dryRun: boolean) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (connector.child_worker_token_secret) headers.set("x-oneaiworkers-child-token", getSecret(env, connector.child_worker_token_secret));
  if (connector.child_worker_token_credential) {
    const systemCredentials = await loadCredentialProfile(env, connector.connector_id, "system");
    const childToken = systemCredentials[connector.child_worker_token_credential];
    if (!childToken) throw new Error(biInline("The child Worker access token is missing.", "Немає ключа доступу до дочірнього Worker."));
    headers.set("x-oneaiworkers-child-token", childToken);
  }

  const credentials = env.CREDENTIALS_MASTER_KEY
    ? await loadCredentialProfile(env, connector.connector_id, "user")
    : {};
  const payload = { name: actionName, arguments: input, credentials, dry_run: dryRun };
  const body = JSON.stringify(payload);

  if (connector.child_worker_binding) {
    const binding = getServiceBinding(env, connector.child_worker_binding);
    const target = `service-binding://${connector.child_worker_binding}/tools/call`;
    if (dryRun) return { ok: true, dry_run: true, invocation: "service_binding", child_worker_binding: connector.child_worker_binding, target, payload: redactSensitiveValue(payload) };
    const response = await binding.fetch(new Request("https://oneaiworkers-child.local/tools/call", { method: "POST", headers, body }));
    const text = await response.text();
    return { ok: response.ok, invocation: "service_binding", child_worker_binding: connector.child_worker_binding, response: buildConnectorResponse(response, text, protectedRequestValues(headers)) };
  }

  if (!connector.child_worker_url) throw new Error(biInline("Child Worker URL or Service Binding is not configured.", "URL або Service Binding child Worker не налаштований."));
  const endpoint = new URL("/tools/call", assertSafeOutboundUrl(connector.child_worker_url));
  if (dryRun) return { ok: true, dry_run: true, invocation: "protected_url", child_worker_url: redactUrlForOutput(endpoint), payload: redactSensitiveValue(payload) };

  const response = await fetch(endpoint.toString(), { method: "POST", headers, body, redirect: "manual" });
  const text = await response.text();
  return { ok: response.ok, invocation: "protected_url", child_worker_url: redactUrlForOutput(endpoint), response: buildConnectorResponse(response, text, protectedRequestValues(headers, endpoint)) };
}

function protectedRequestValues(headers: Headers, url?: URL): string[] {
  const values: string[] = [];
  for (const [key, value] of headers.entries()) {
    if (!["accept", "content-type", "user-agent"].includes(key.toLowerCase())) values.push(value);
  }
  if (url) for (const value of url.searchParams.values()) values.push(value);
  return values.filter((value) => value.length >= 6);
}

async function listActionsForConnector(env: Env, db: D1Database, connectorId: string) {
  const rows = await db.prepare("SELECT * FROM connector_actions WHERE connector_id = ? ORDER BY action_name").bind(connectorId).all<ActionRow>();
  const needsCredentials = (rows.results || []).some((row) =>
    getAuthSecretNames(parseJson<AuthConfig>(row.auth_json, { type: "none" })).length > 0
  );
  const credentials = needsCredentials && env.CREDENTIALS_MASTER_KEY
    ? await loadCredentialProfile(env, connectorId, "user")
    : {};
  return (rows.results || []).map((row) => ({
    name: row.action_name,
    mcp_tool_name: `${toolNamePart(row.connector_id)}_${toolNamePart(row.action_name)}`,
    description: row.description,
    method: row.method,
    url: redactTemplatedUrl(row.url),
    auth: publicAuth(parseJson<AuthConfig>(row.auth_json, { type: "none" }), env, credentials),
    read_only: isReadOnlyConnectorAction(row),
    side_effect: !isReadOnlyConnectorAction(row),
    input_schema: row.input_schema_json ? parseJson<unknown>(row.input_schema_json, null) : null,
  }));
}

async function collectRequiredSecrets(env: Env, actions: ActionRow[], connectors: ConnectorRow[]) {
  const namesByPlugin = new Map<string, Set<string>>();
  for (const action of actions) {
    const names = namesByPlugin.get(action.connector_id) || new Set<string>();
    for (const name of getAuthSecretNames(parseJson<AuthConfig>(action.auth_json, { type: "none" }))) names.add(name);
    namesByPlugin.set(action.connector_id, names);
  }
  for (const connector of connectors) {
    if (!connector.child_worker_token_secret) continue;
    const names = namesByPlugin.get(connector.connector_id) || new Set<string>();
    names.add(connector.child_worker_token_secret);
    namesByPlugin.set(connector.connector_id, names);
  }
  const output: Array<{ plugin_id: string; name: string; configured: boolean; storage: string; value: string }> = [];
  for (const connector of connectors) {
    const managed = env.CREDENTIALS_MASTER_KEY
      ? await loadCredentialProfile(env, connector.connector_id, "user")
      : {};
    for (const name of [...(namesByPlugin.get(connector.connector_id) || [])].sort()) {
      const managedReady = Boolean(managed[name]?.trim());
      const legacyReady = isSecretConfigured(env, name);
      output.push({
        plugin_id: connector.connector_id,
        name,
        configured: managedReady || legacyReady,
        storage: managedReady ? "encrypted_d1" : legacyReady ? "cloudflare_secret" : "missing",
        value: "[hidden]",
      });
    }
  }
  return output;
}

function parseStoredCredentialFields(value: string): CredentialField[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((field): field is CredentialField => {
      if (!field || typeof field !== "object" || Array.isArray(field)) return false;
      const item = field as Partial<CredentialField>;
      return typeof item.id === "string" && typeof item.label === "string" && ["secret", "text", "url"].includes(String(item.type));
    });
  } catch {
    return [];
  }
}

function inferCredentialFields(actions: ActionRow[]): CredentialField[] {
  const names = new Set<string>();
  for (const action of actions) {
    const auth = parseJson<AuthConfig>(action.auth_json, { type: "none" });
    for (const name of getAuthSecretNames(auth)) names.add(name);
  }
  return [...names].sort().map((name) => ({
    id: name,
    label: humanizeActionName(name),
    label_uk: humanizeActionName(name),
    type: "secret" as const,
    required: true,
    help: "Stored encrypted in your OneAIWorkers D1 database.",
    help_uk: "Зберігається у зашифрованому вигляді у вашій базі D1 OneAIWorkers.",
  }));
}

function mergeCredentialFields(primary: CredentialField[], inferred: CredentialField[]): CredentialField[] {
  const fields = new Map(primary.map((field) => [field.id, field]));
  for (const field of inferred) if (!fields.has(field.id)) fields.set(field.id, field);
  return [...fields.values()];
}

function legacySecretValues(env: Env, fields: CredentialField[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const value = (env as Record<string, unknown>)[field.id];
    if (typeof value === "string" && value) values[field.id] = value;
  }
  return values;
}

function collectServiceBindings(env: Env, connectors: ConnectorRow[]) {
  const names = new Set<string>();
  for (const connector of connectors) if (connector.child_worker_binding) names.add(connector.child_worker_binding);
  return [...names].sort().map((name) => ({ name, configured: isServiceBindingConfigured(env, name) }));
}

function isServiceBindingConfigured(env: Env, name: string): boolean {
  try {
    getServiceBinding(env, name);
    return true;
  } catch {
    return false;
  }
}

function validateChildWorkerConfig(
  childWorkerUrl?: string,
  childWorkerBinding?: string,
  childWorkerTokenSecret?: string,
  childWorkerTokenCredential?: string,
): void {
  if (!childWorkerUrl && !childWorkerBinding) {
    throw new Error(biInline("child_worker_url or child_worker_binding is required for child_worker mode.", "Для режиму child_worker потрібен child_worker_url або child_worker_binding."));
  }
  if (childWorkerUrl) assertSafeOutboundUrl(childWorkerUrl);
  if (childWorkerBinding) validateBindingName(childWorkerBinding);
  if (childWorkerUrl && !childWorkerBinding && !childWorkerTokenSecret && !childWorkerTokenCredential) {
    throw new Error(biInline("A child Worker access token is required for a public child URL.", "Для публічної адреси дочірнього Worker потрібен ключ доступу."));
  }
  if (childWorkerTokenSecret) validateSecretName(childWorkerTokenSecret);
  if (childWorkerTokenCredential && !/^[a-z][a-z0-9_]{1,79}$/.test(childWorkerTokenCredential)) {
    throw new Error(biInline("Managed credential key has an invalid format.", "Ключ керованого службового значення має неправильний формат."));
  }
}

function validateBindingName(name: string): void {
  if (!/^[A-Z][A-Z0-9_]{1,80}$/.test(name)) {
    throw new Error(biInline("Service Binding name must use uppercase letters, numbers, and underscores.", "Назва Service Binding має містити великі літери, цифри й підкреслення."));
  }
}

function getServiceBinding(env: Env, name: string): { fetch: (request: Request) => Promise<Response> } {
  validateBindingName(name);
  const binding = (env as Record<string, unknown>)[name];
  if (!binding || typeof binding !== "object" || typeof (binding as { fetch?: unknown }).fetch !== "function") {
    throw new Error(`${biInline("Service Binding is not configured", "Service Binding не налаштований")}: ${name}`);
  }
  return binding as { fetch: (request: Request) => Promise<Response> };
}

function publicConnector(row: ConnectorRow) {
  return {
    connector_id: row.connector_id,
    name: row.name,
    description: row.description,
    mode: row.mode as ConnectorMode,
    gateway_route: "call_connector_tool",
    child_worker_invocation: row.mode === "child_worker" ? (row.child_worker_binding ? "service_binding" : "protected_url") : null,
    child_worker_url: row.child_worker_url ? redactUrlForOutput(assertSafeOutboundUrl(row.child_worker_url)) : null,
    child_worker_binding: row.child_worker_binding || null,
    direct_child_url_available: Boolean(row.child_worker_url),
    child_worker_token_secret: row.child_worker_token_secret || null,
    managed_child_token: Boolean(row.child_worker_token_credential),
    enabled: Boolean(row.enabled),
    updated_at: row.updated_at,
  };
}

function normalizeKey(value: string): string {
  return safeKey(value).replaceAll(":", "-");
}

function toolNamePart(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "tool";
}

function uniqueToolName(baseName: string, usedNames: Set<string>): string {
  let name = baseName;
  let index = 2;
  while (usedNames.has(name)) name = `${baseName}_${index++}`;
  usedNames.add(name);
  return name;
}

export function humanizeActionName(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildConnectorToolDescription(row: ConnectorActionToolRow, readOnly: boolean, destructive: boolean): string {
  const parts = [
    `${row.connector_name} connector action exposed as a first-class OneAIWorkers MCP tool.`,
    row.description || `Runs ${humanizeActionName(row.action_name)} for ${row.connector_name}.`,
    readOnly ? "Read-only: this tool should not create external side effects." : "External side effect: this tool may change data, send messages, trigger workflows, or call an external API.",
  ];
  if (destructive) parts.push("Destructive action: use only after explicit user intent is clear.");
  parts.push("The MCP client should call this tool directly; routing to internal connectors or child Workers is handled by OneAIWorkers.");
  return parts.join(" ");
}

export function isReadOnlyConnectorAction(row: ActionRow): boolean {
  const name = row.action_name.toLowerCase();
  if (["GET", "HEAD", "OPTIONS"].includes(row.method.toUpperCase())) return true;
  return /^(get|list|read|fetch|check|status|info|search|lookup|whois|summary|overview|inspect|validate|test)/.test(name);
}

export function isDestructiveConnectorAction(row: ActionRow): boolean {
  const name = row.action_name.toLowerCase();
  if (["DELETE"].includes(row.method.toUpperCase())) return true;
  return /^(delete|remove|destroy|cancel|disable|revoke|drop|purge|wipe)/.test(name);
}

function chooseConnectionCheckAction(actions: ActionRow[]): ActionRow | null {
  const safe = actions.filter((action) => isReadOnlyConnectorAction(action) && actionAcceptsEmptyInput(action));
  const preferred = [
    "check_connection",
    "connection_check",
    "health",
    "health_check",
    "whoami",
    "get_me",
    "list_workflows",
    "list_boards",
  ];
  for (const name of preferred) {
    const match = safe.find((action) => action.action_name === name);
    if (match) return match;
  }
  return safe[0] || null;
}

function actionAcceptsEmptyInput(action: ActionRow): boolean {
  const schema = parseJson<{ required?: unknown }>(action.input_schema_json || "{}", {});
  return !Array.isArray(schema.required) || schema.required.length === 0;
}

function connectionOutcome(value: unknown): { ok: boolean; httpStatus: number | null; message: string } {
  const statuses: number[] = [];
  const messages: string[] = [];
  let explicitFailure = false;
  const visit = (item: unknown, depth: number) => {
    if (depth > 6 || item === null || item === undefined) return;
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 20)) visit(child, depth + 1);
      return;
    }
    if (typeof item !== "object") return;
    for (const [key, child] of Object.entries(item as Record<string, unknown>).slice(0, 50)) {
      if ((key === "status" || key === "http_status") && typeof child === "number") statuses.push(child);
      if (key === "ok" && child === false) explicitFailure = true;
      if (["message", "error", "text_preview"].includes(key) && typeof child === "string" && child.trim()) {
        messages.push(redactSensitiveText(child).slice(0, 500));
      }
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  const httpStatus = statuses.find((status) => status >= 400) || statuses[0] || null;
  const ok = !explicitFailure && (!httpStatus || httpStatus < 400);
  const defaultMessage = httpStatus === 401 || httpStatus === 403
    ? biInline(
        "The service rejected the saved key. Open plugin settings and save a valid key.",
        "Сервіс відхилив збережений ключ. Відкрийте налаштування плагіна та збережіть правильний ключ.",
      )
    : biInline("Connection check failed.", "Не вдалося перевірити зв’язок.");
  return { ok, httpStatus, message: messages[0] || defaultMessage };
}

async function recordPluginConnectionResult(
  env: Env,
  connectorId: string,
  value: unknown,
  verification = false,
): Promise<{ ok: boolean; httpStatus: number | null; message: string }> {
  const outcome = connectionOutcome(value);
  const previous = await getPluginConnectionHealth(env, connectorId);
  if (outcome.ok) {
    await setPluginConnectionHealth(env, connectorId, { status: "active", httpStatus: outcome.httpStatus });
    if (previous?.status !== "active") await markRegistryDirty(env);
    return outcome;
  }
  if (verification || outcome.httpStatus === 401 || outcome.httpStatus === 403) {
    await setPluginConnectionHealth(env, connectorId, {
      status: "error",
      httpStatus: outcome.httpStatus,
      message: outcome.message,
    });
    if (previous?.status !== "error") await markRegistryDirty(env);
  }
  return outcome;
}

async function markRegistryDirty(env: Env): Promise<void> {
  if (!env.OAUTH_DB) return;
  try {
    await env.OAUTH_DB.prepare(
      `INSERT INTO w_meta (key, value, updated_at) VALUES ('registry_dirty', '1', ?)
       ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at`,
    ).bind(new Date().toISOString()).run();
  } catch {
    // The W registry may not be initialized yet. Saving credentials still marks it dirty through its D1 trigger.
  }
}

function getDb(env: Env): D1Database {
  if (!env.OAUTH_DB) throw new Error(biInline("D1 database is not configured.", "D1 база не налаштована."));
  return env.OAUTH_DB;
}

async function ensureColumn(db: D1Database, table: string, column: string, type: string): Promise<void> {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const exists = (rows.results || []).some((row) => row.name === column);
  if (!exists) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
}

async function audit(db: D1Database, connectorId: string | null, actionName: string | null, event: string, ok: boolean, message: string) {
  await db.prepare(
    "INSERT INTO connector_audit_log (id, connector_id, action_name, event, ok, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), connectorId, actionName, event, ok ? 1 : 0, message.slice(0, MAX_RESPONSE_TEXT), nowSeconds()).run();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
