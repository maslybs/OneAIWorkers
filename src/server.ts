import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bi, bilingualObject, biInline } from "./i18n";
import type { Env } from "./types";
import { buildBaseUrl } from "./auth";
import { errorMessage, mcpText } from "./response";
import { checkUrlStatus, checkUrlStatusSchema, fetchManyUrls, fetchManyUrlsSchema, fetchRss, fetchRssSchema, fetchUrl, fetchUrlSchema } from "./tools/observe";
import { callWebhook, callWebhookSchema, sendNotification, sendNotificationSchema } from "./tools/notify";
import { createChildWorkerFromTemplate, createChildWorkerSchema, deployCustomChildWorker, deployCustomChildWorkerSchema } from "./tools/factory";
import { callConnectorTool, callConnectorToolSchema, connectorSetupStatus, connectorSetupStatusSchema, deleteConnector, connectorIdSchema, listConnectorMcpTools, listConnectors, listConnectorsSchema, saveConnector, saveConnectorSchema, testConnector, testConnectorSchema, type ConnectorMcpTool } from "./tools/integrations";

const OAUTH_SECURITY_SCHEMES = [{ type: "oauth2", scopes: ["mcp"] }] as const;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const READ_EXTERNAL = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const WRITE_EXTERNAL = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

const STATIC_TOOL_NAMES = [
  "hub_info",
  "connector_setup_status",
  "save_connector",
  "list_connectors",
  "test_connector",
  "call_connector_tool",
  "delete_connector",
  "fetch_url",
  "fetch_many_urls",
  "fetch_rss",
  "check_url_status",
  "send_notification",
  "call_webhook",
  "create_child_worker_from_template",
  "deploy_custom_child_worker",
];

export async function createMcpServer(env: Env, request: Request): Promise<McpServer> {
  const server = new McpServer({
    name: env.HUB_NAME || "OneAIWorkers",
    version: "0.5.0",
  });

  const { connectorTools, connectorToolError } = await loadConnectorTools(env);

  tool(
    server,
    "hub_info",
    "OneAIWorkers server info",
    bi(
      "Explains this MCP server, its operating model, available native connector tools, and which optional integrations are configured. Use this first when a user asks what the Worker can do.",
      "Пояснює цей MCP server, модель роботи, доступні native connector tools і які опційні інтеграції налаштовані. Використовуйте першим, коли користувач питає, що Worker вміє.",
    ),
    {},
    () => ({
      ok: true,
      name: env.HUB_NAME || "OneAIWorkers",
      base_url: buildBaseUrl(request, env),
      mcp_url: `${buildBaseUrl(request, env)}/mcp`,
      purpose: bilingualObject(
        "OneAIWorkers is a secure MCP gateway that exposes user-owned APIs as first-class ChatGPT tools.",
        "OneAIWorkers — це безпечний MCP gateway, який показує API користувача як first-class ChatGPT tools.",
      ),
      model: bilingualObject(
        "ChatGPT sees one MCP server and top-level tools such as tg_getme or n8n_list_workflows. OneAIWorkers routes each tool internally to a manifest connector, private Service Binding, or protected child Worker URL.",
        "ChatGPT бачить один MCP server і top-level tools типу tg_getme або n8n_list_workflows. OneAIWorkers сам маршрутизує кожен tool у manifest connector, private Service Binding або protected child Worker URL.",
      ),
      connector_engine: {
        gateway_endpoint: "/mcp",
        child_workers_called_through_gateway_by_default: true,
        child_workers_visible_to_chatgpt: false,
        dynamic_connector_tools_visible_to_chatgpt: true,
        supported_child_invocations: ["service_binding", "protected_url"],
        supported_http_methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        supports_path_templates: true,
        supports_query_templates: true,
        supports_json_body_templates: true,
        supported_auth: [
          "none",
          "bearer_secret",
          "auth_header_secret",
          "api_key_header_secret",
          "api_key_query_secret",
          "basic_secret",
          "basic_secret_pair",
          "oauth2_client_credentials",
          "oauth2_refresh_token",
          "google_oauth2_refresh_token",
        ],
      },
      recommended_first_tools: ["connector_setup_status", "list_connectors", ...connectorTools.slice(0, 8).map((item) => item.tool_name)],
      tools: [...STATIC_TOOL_NAMES, ...connectorTools.map((item) => item.tool_name)],
      connector_tool_groups: groupConnectorTools(connectorTools),
      connector_tool_error: connectorToolError,
      configured: configuredFlags(env),
      important_limits: bilingualObject(
        "Simple and medium HTTP APIs should use internal connector manifests. Complex APIs, long-running work, custom signing, files, streaming, or custom OAuth should use child Workers behind the main gateway.",
        "Прості й середні HTTP API мають використовувати internal connector manifests. Складні API, довгі jobs, custom signing, файли, streaming або custom OAuth мають використовувати child Workers за основним gateway.",
      ),
    }),
    READ_ONLY,
  );

  tool(server, "connector_setup_status", "Connector setup status", bi("Checks connector engine readiness: D1, MCP protection, saved connectors, generated top-level tools, required secrets, missing secrets, service bindings, and optional integration flags. Run this before debugging any API connector.", "Перевіряє готовність connector engine: D1, MCP захист, збережені конектори, згенеровані top-level tools, потрібні secrets, відсутні secrets, service bindings і прапорці опційних інтеграцій. Запускайте перед дебагом будь-якого API connector."), connectorSetupStatusSchema, (args) => connectorSetupStatus(env, args), READ_ONLY);
  tool(server, "list_connectors", "List saved connectors", bi("Lists saved connectors from D1. Set include_actions=true to inspect connector actions, generated MCP tool names, auth type, input schema, gateway route, and secret status without exposing secret values.", "Показує збережені конектори з D1. Встановіть include_actions=true, щоб бачити actions, generated MCP tool names, auth type, input schema, gateway route і secret status без показу значень."), listConnectorsSchema, (args) => listConnectors(env, args), READ_ONLY);
  tool(server, "save_connector", "Save API connector", bi("Creates or updates an API connector manifest. After saving, actions are exposed as top-level OneAIWorkers tools on the next MCP tools/list refresh, for example tg_getme or n8n_list_workflows. Secrets must be referenced by Cloudflare secret name, never placed directly in the manifest.", "Створює або оновлює API connector manifest. Після збереження actions показуються як top-level OneAIWorkers tools при наступному MCP tools/list refresh, наприклад tg_getme або n8n_list_workflows. Secrets треба вказувати тільки за назвою Cloudflare secret, ніколи не вставляти значення напряму в manifest."), saveConnectorSchema, (args) => saveConnector(env, args), WRITE_EXTERNAL);
  tool(server, "test_connector", "Test connector action", bi("Tests a saved connector action. Defaults to dry_run=true, which prepares the HTTP request without calling the external API. Use this before real calls or when a generated top-level tool fails.", "Тестує збережену дію connector. За замовчуванням dry_run=true: готує HTTP запит без виклику зовнішнього API. Використовуйте перед реальними викликами або коли generated top-level tool падає."), testConnectorSchema, (args) => testConnector(env, args), READ_EXTERNAL);
  tool(server, "call_connector_tool", "Call connector action", bi("Advanced/debug gateway. Calls a saved connector action by connector_id and action_name. Normal ChatGPT usage should prefer generated top-level tools like tg_getme, tg_send_message, or n8n_list_workflows.", "Advanced/debug gateway. Викликає збережену дію connector через connector_id і action_name. Для нормального ChatGPT UX краще використовувати generated top-level tools типу tg_getme, tg_send_message або n8n_list_workflows."), callConnectorToolSchema, (args) => callConnectorTool(env, args), WRITE_EXTERNAL);
  tool(server, "delete_connector", "Delete connector", bi("Deletes a saved connector and all of its actions from D1. Its generated top-level MCP tools disappear on the next tools/list refresh. Use only when the user explicitly asks to remove a connector.", "Видаляє збережений connector і всі його actions з D1. Його generated top-level MCP tools зникнуть при наступному tools/list refresh. Використовуйте тільки коли користувач явно просить видалити connector."), connectorIdSchema, (args) => deleteConnector(env, args), DESTRUCTIVE);

  tool(server, "fetch_url", "Fetch URL", bi("Fetches a public HTTPS URL and returns text suitable for LLM interpretation. Blocks local/private hosts and unsafe outbound targets.", "Отримує публічний HTTPS URL і повертає текст для інтерпретації LLM. Блокує local/private hosts і небезпечні outbound targets."), fetchUrlSchema, fetchUrl, READ_EXTERNAL);
  tool(server, "fetch_many_urls", "Fetch many URLs", bi("Fetches up to 10 public HTTPS URLs and returns compact results. Use for lightweight research or status checks, not crawling.", "Отримує до 10 публічних HTTPS URL і повертає компактні результати. Використовуйте для легкого research або status checks, не для crawling."), fetchManyUrlsSchema, fetchManyUrls, READ_EXTERNAL);
  tool(server, "fetch_rss", "Fetch RSS feed", bi("Fetches an RSS/Atom feed and returns recent feed items in a model-readable format.", "Отримує RSS/Atom feed і повертає останні елементи у форматі, зручному для моделі."), fetchRssSchema, fetchRss, READ_EXTERNAL);
  tool(server, "check_url_status", "Check URL status", bi("Checks whether a public website or API endpoint is reachable and how long the request took.", "Перевіряє, чи доступний публічний сайт або API endpoint і скільки часу зайняв запит."), checkUrlStatusSchema, checkUrlStatus, READ_EXTERNAL);

  tool(server, "send_notification", "Send notification", bi("Sends a message through configured Telegram, Discord, Slack, or generic webhook integration. This creates an external side effect.", "Надсилає повідомлення через налаштований Telegram, Discord, Slack або generic webhook. Це створює зовнішній side effect."), sendNotificationSchema, (args) => sendNotification(env, args), WRITE_EXTERNAL);
  tool(server, "call_webhook", "Call webhook", bi("Calls a public HTTPS webhook with a JSON payload. Use for user-approved automation callbacks only.", "Викликає публічний HTTPS webhook з JSON payload. Використовуйте тільки для підтверджених користувачем automation callbacks."), callWebhookSchema, callWebhook, WRITE_EXTERNAL);

  tool(server, "create_child_worker_from_template", "Create child Worker from template", bi("Advanced builder: deploys a protected child Cloudflare Worker from a reviewed safe template. The child is meant to be used through the main OneAIWorkers gateway; direct API access is optional and requires an explicit token.", "Розширений builder: деплоїть захищений child Cloudflare Worker з перевіреного безпечного шаблону. Child має використовуватись через основний OneAIWorkers gateway; прямий API доступ опційний і вимагає окремий token."), createChildWorkerSchema, (args) => createChildWorkerFromTemplate(env, args), WRITE_EXTERNAL);
  tool(server, "deploy_custom_child_worker", "Deploy custom child Worker", bi("Advanced Worker Builder: deploys reviewed custom JavaScript as a separate protected child Worker only when allow_custom_code=true. Register it as a connector so ChatGPT sees its actions as normal OneAIWorkers top-level tools.", "Розширений Worker Builder: деплоїть перевірений кастомний JavaScript як окремий захищений child Worker тільки коли allow_custom_code=true. Зареєструйте його як connector, щоб ChatGPT бачив його actions як звичайні top-level tools OneAIWorkers."), deployCustomChildWorkerSchema, (args) => deployCustomChildWorker(env, args), WRITE_EXTERNAL);

  registerConnectorTools(server, env, connectorTools);

  return server;
}

function tool<T extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  inputSchema: T,
  handler: (args: z.infer<z.ZodObject<T>>) => Promise<unknown> | unknown,
  annotations: Record<string, boolean>,
) {
  const callback = (async (args: unknown) => safeRun(() => handler(args as z.infer<z.ZodObject<T>>))) as never;
  const descriptor = {
    title,
    description,
    inputSchema,
    securitySchemes: OAUTH_SECURITY_SCHEMES,
    annotations,
  } as never;
  server.registerTool(name, descriptor, callback);
}

function registerConnectorTools(server: McpServer, env: Env, connectorTools: ConnectorMcpTool[]) {
  const usedNames = new Set(STATIC_TOOL_NAMES);
  for (const connectorTool of connectorTools) {
    const toolName = uniqueToolName(connectorTool.tool_name, usedNames);
    const annotations = {
      readOnlyHint: connectorTool.read_only,
      destructiveHint: connectorTool.destructive,
      openWorldHint: true,
    };
    const inputSchema = {
      ...inputSchemaFromJsonSchema(connectorTool.input_schema),
      dry_run: z.boolean().default(false).describe(biInline("If true, prepare the routed request without calling the connector.", "Якщо true, підготувати routed request без виклику connector.")),
      confirmed: z.boolean().default(false).describe(biInline("Optional explicit user confirmation for side-effect actions.", "Опційне явне підтвердження користувача для actions із side effects.")),
    };
    tool(
      server,
      toolName,
      connectorTool.title,
      connectorTool.description,
      inputSchema,
      (args) => callConnectorTool(env, {
        connector_id: connectorTool.connector_id,
        action_name: connectorTool.action_name,
        input: connectorInput(args),
        dry_run: Boolean(args.dry_run),
      }),
      annotations,
    );
  }
}

async function safeRun(fn: () => Promise<unknown> | unknown) {
  try {
    const data = await fn();
    return mcpText({ ok: true, data });
  } catch (error) {
    return mcpText({ ok: false, message: `${biInline("Error", "Помилка")}: ${errorMessage(error)}` });
  }
}

async function loadConnectorTools(env: Env): Promise<{ connectorTools: ConnectorMcpTool[]; connectorToolError: string | null }> {
  try {
    if (!env.OAUTH_DB) return { connectorTools: [], connectorToolError: "D1 database is not configured." };
    return { connectorTools: await listConnectorMcpTools(env), connectorToolError: null };
  } catch (error) {
    return { connectorTools: [], connectorToolError: errorMessage(error) };
  }
}

function connectorInput(args: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (key === "dry_run" || key === "confirmed") continue;
    input[key] = value;
  }
  return input;
}

function inputSchemaFromJsonSchema(schema: unknown): z.ZodRawShape {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return {};
  const record = schema as Record<string, unknown>;
  const properties = record.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return {};
  const required = new Set(Array.isArray(record.required) ? record.required.filter((item): item is string => typeof item === "string") : []);
  const shape: z.ZodRawShape = {};
  for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
    let field = zodFromJsonSchemaProperty(value);
    if (!required.has(key)) field = field.optional();
    shape[key] = field;
  }
  return shape;
}

function zodFromJsonSchemaProperty(schema: unknown): z.ZodTypeAny {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return z.unknown();
  const record = schema as Record<string, unknown>;
  const description = typeof record.description === "string" ? record.description : undefined;
  const enumValues = Array.isArray(record.enum) ? record.enum.filter((item): item is string => typeof item === "string") : [];
  if (enumValues.length > 0) return describe(z.enum(enumValues as [string, ...string[]]), description);

  const type = Array.isArray(record.type) ? record.type.find((item) => item !== "null") : record.type;
  if (type === "string") return describe(z.string(), description);
  if (type === "number" || type === "integer") return describe(z.number(), description);
  if (type === "boolean") return describe(z.boolean(), description);
  if (type === "array") return describe(z.array(z.unknown()), description);
  if (type === "object") return describe(z.record(z.string(), z.unknown()), description);
  return describe(z.unknown(), description);
}

function describe<T extends z.ZodTypeAny>(schema: T, description?: string): T {
  return description ? schema.describe(description) as T : schema;
}

function groupConnectorTools(connectorTools: ConnectorMcpTool[]) {
  const groups: Record<string, { connector_id: string; connector_name: string; tools: string[] }> = {};
  for (const item of connectorTools) {
    groups[item.connector_id] ??= { connector_id: item.connector_id, connector_name: item.connector_name, tools: [] };
    groups[item.connector_id].tools.push(item.tool_name);
  }
  return Object.values(groups);
}

function uniqueToolName(baseName: string, usedNames: Set<string>): string {
  let name = baseName;
  let index = 2;
  while (usedNames.has(name)) name = `${baseName}_${index++}`;
  usedNames.add(name);
  return name;
}

function configuredFlags(env: Env) {
  return {
    d1_database: Boolean(env.OAUTH_DB),
    mcp_shared_secret: Boolean(env.MCP_SHARED_SECRET),
    telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    discord: Boolean(env.DISCORD_WEBHOOK_URL),
    slack: Boolean(env.SLACK_WEBHOOK_URL),
    default_webhook: Boolean(env.DEFAULT_WEBHOOK_URL),
    worker_builder: Boolean(env.CF_ACCOUNT_ID && env.CF_API_TOKEN),
  };
}
