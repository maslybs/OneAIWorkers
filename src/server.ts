import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bi, bilingualObject, biInline } from "./i18n";
import type { Env } from "./types";
import { buildBaseUrl } from "./auth";
import { errorMessage, mcpText } from "./response";
import { checkUrlStatus, checkUrlStatusSchema, fetchManyUrls, fetchManyUrlsSchema, fetchRss, fetchRssSchema, fetchUrl, fetchUrlSchema } from "./tools/observe";
import { callWebhook, callWebhookSchema, sendNotification, sendNotificationSchema } from "./tools/notify";
import { createChildWorkerFromTemplate, createChildWorkerSchema, deployCustomChildWorker, deployCustomChildWorkerSchema } from "./tools/factory";
import { callConnectorTool, callConnectorToolSchema, connectorSetupStatus, connectorSetupStatusSchema, deleteConnector, connectorIdSchema, listConnectors, listConnectorsSchema, saveConnector, saveConnectorSchema, testConnector, testConnectorSchema } from "./tools/integrations";

const OAUTH_SECURITY_SCHEMES = [{ type: "oauth2", scopes: ["mcp"] }] as const;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const READ_EXTERNAL = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const WRITE_EXTERNAL = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

export function createMcpServer(env: Env, request: Request): McpServer {
  const server = new McpServer({
    name: env.HUB_NAME || "OneAIWorkers",
    version: "0.4.0",
  });

  tool(
    server,
    "hub_info",
    "OneAIWorkers server info",
    bi(
      "Explains this MCP server, its operating model, available tool categories, and which optional integrations are configured. Use this first when a user asks what the Worker can do.",
      "Пояснює цей MCP server, модель роботи, категорії доступних tools і які опційні інтеграції налаштовані. Використовуйте першим, коли користувач питає, що Worker вміє.",
    ),
    {},
    () => ({
      ok: true,
      name: env.HUB_NAME || "OneAIWorkers",
      base_url: buildBaseUrl(request, env),
      mcp_url: `${buildBaseUrl(request, env)}/mcp`,
      purpose: bilingualObject(
        "OneAIWorkers is a secure MCP gateway for connecting ChatGPT to user-owned HTTP APIs through saved connector manifests.",
        "OneAIWorkers — це безпечний MCP gateway для підключення ChatGPT до HTTP API користувача через збережені connector manifests.",
      ),
      model: bilingualObject(
        "The LLM owns memory, planning, and decisions. The Worker validates requests, reads secrets by name, calls external APIs, and returns compact structured results.",
        "LLM відповідає за памʼять, планування й рішення. Worker валідує запити, читає secrets за назвою, викликає зовнішні API і повертає компактні структуровані результати.",
      ),
      connector_engine: {
        gateway_endpoint: "/mcp",
        child_workers_called_through_gateway_by_default: true,
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
      recommended_first_tools: ["connector_setup_status", "list_connectors", "test_connector", "call_connector_tool"],
      tools: [
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
      ],
      configured: configuredFlags(env),
      important_limits: bilingualObject(
        "This is an HTTP API gateway, not a full ETL engine. Long-running jobs, heavy file processing, and complex OAuth connection pages should use child Workers, queues, R2, or a dedicated backend.",
        "Це HTTP API gateway, а не повний ETL engine. Довгі jobs, важка обробка файлів і складні OAuth connection pages мають використовувати child Workers, queues, R2 або окремий backend.",
      ),
    }),
    READ_ONLY,
  );

  tool(server, "connector_setup_status", "Connector setup status", bi("Checks connector engine readiness: D1, MCP protection, saved connectors, required secrets, missing secrets, and optional integration flags. Run this before debugging any API connector.", "Перевіряє готовність connector engine: D1, MCP захист, збережені конектори, потрібні secrets, відсутні secrets і прапорці опційних інтеграцій. Запускайте перед дебагом будь-якого API connector."), connectorSetupStatusSchema, (args) => connectorSetupStatus(env, args), READ_ONLY);
  tool(server, "list_connectors", "List saved connectors", bi("Lists saved connectors from D1. Set include_actions=true to inspect action names, URLs, auth type, input schema, and real secret configured/missing status without exposing secret values.", "Показує збережені конектори з D1. Встановіть include_actions=true, щоб бачити назви actions, URLs, auth type, input schema і реальний статус configured/missing для secrets без показу значень."), listConnectorsSchema, (args) => listConnectors(env, args), READ_ONLY);
  tool(server, "save_connector", "Save API connector", bi("Creates or updates an API connector manifest. Use internal mode for normal HTTPS APIs. Secrets must be referenced by Cloudflare secret name, never placed directly in the manifest.", "Створює або оновлює API connector manifest. Використовуйте internal mode для звичайних HTTPS API. Secrets треба вказувати тільки за назвою Cloudflare secret, ніколи не вставляти значення напряму в manifest."), saveConnectorSchema, (args) => saveConnector(env, args), WRITE_EXTERNAL);
  tool(server, "test_connector", "Test connector action", bi("Tests a saved connector action. Defaults to dry_run=true, which prepares the HTTP request without calling the external API. Use this before real calls.", "Тестує збережену дію connector. За замовчуванням dry_run=true: готує HTTP запит без виклику зовнішнього API. Використовуйте перед реальними викликами."), testConnectorSchema, (args) => testConnector(env, args), READ_EXTERNAL);
  tool(server, "call_connector_tool", "Call connector action", bi("Calls a saved connector action against an external HTTPS API. Returns request metadata with redacted secrets plus compact structured response summary/json_preview for large API responses.", "Викликає збережену дію connector проти зовнішнього HTTPS API. Повертає metadata запиту з прихованими secrets і компактний структурований summary/json_preview для великих API відповідей."), callConnectorToolSchema, (args) => callConnectorTool(env, args), WRITE_EXTERNAL);
  tool(server, "delete_connector", "Delete connector", bi("Deletes a saved connector and all of its actions from D1. Use only when the user explicitly asks to remove a connector.", "Видаляє збережений connector і всі його actions з D1. Використовуйте тільки коли користувач явно просить видалити connector."), connectorIdSchema, (args) => deleteConnector(env, args), DESTRUCTIVE);

  tool(server, "fetch_url", "Fetch URL", bi("Fetches a public HTTPS URL and returns text suitable for LLM interpretation. Blocks local/private hosts and unsafe outbound targets.", "Отримує публічний HTTPS URL і повертає текст для інтерпретації LLM. Блокує local/private hosts і небезпечні outbound targets."), fetchUrlSchema, fetchUrl, READ_EXTERNAL);
  tool(server, "fetch_many_urls", "Fetch many URLs", bi("Fetches up to 10 public HTTPS URLs and returns compact results. Use for lightweight research or status checks, not crawling.", "Отримує до 10 публічних HTTPS URL і повертає компактні результати. Використовуйте для легкого research або status checks, не для crawling."), fetchManyUrlsSchema, fetchManyUrls, READ_EXTERNAL);
  tool(server, "fetch_rss", "Fetch RSS feed", bi("Fetches an RSS/Atom feed and returns recent feed items in a model-readable format.", "Отримує RSS/Atom feed і повертає останні елементи у форматі, зручному для моделі."), fetchRssSchema, fetchRss, READ_EXTERNAL);
  tool(server, "check_url_status", "Check URL status", bi("Checks whether a public website or API endpoint is reachable and how long the request took.", "Перевіряє, чи доступний публічний сайт або API endpoint і скільки часу зайняв запит."), checkUrlStatusSchema, checkUrlStatus, READ_EXTERNAL);

  tool(server, "send_notification", "Send notification", bi("Sends a message through configured Telegram, Discord, Slack, or generic webhook integration. This creates an external side effect.", "Надсилає повідомлення через налаштований Telegram, Discord, Slack або generic webhook. Це створює зовнішній side effect."), sendNotificationSchema, (args) => sendNotification(env, args), WRITE_EXTERNAL);
  tool(server, "call_webhook", "Call webhook", bi("Calls a public HTTPS webhook with a JSON payload. Use for user-approved automation callbacks only.", "Викликає публічний HTTPS webhook з JSON payload. Використовуйте тільки для підтверджених користувачем automation callbacks."), callWebhookSchema, callWebhook, WRITE_EXTERNAL);

  tool(server, "create_child_worker_from_template", "Create child Worker from template", bi("Advanced: deploys a child Cloudflare Worker from a reviewed safe template. Use for isolated connector runtime or webhook forwarding. Does not run arbitrary JavaScript.", "Розширено: деплоїть child Cloudflare Worker з перевіреного безпечного шаблону. Використовуйте для ізольованого connector runtime або webhook forwarding. Не запускає довільний JavaScript."), createChildWorkerSchema, (args) => createChildWorkerFromTemplate(env, args), WRITE_EXTERNAL);
  tool(server, "deploy_custom_child_worker", "Deploy custom child Worker", bi("Advanced Worker Builder: deploys reviewed custom JavaScript as a separate child Worker only when allow_custom_code=true. Use for advanced users after code review.", "Розширений Worker Builder: деплоїть перевірений кастомний JavaScript як окремий child Worker тільки коли allow_custom_code=true. Використовуйте для advanced users після code review."), deployCustomChildWorkerSchema, (args) => deployCustomChildWorker(env, args), WRITE_EXTERNAL);

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

async function safeRun(fn: () => Promise<unknown> | unknown) {
  try {
    const data = await fn();
    return mcpText({ ok: true, data });
  } catch (error) {
    return mcpText({ ok: false, message: `${biInline("Error", "Помилка")}: ${errorMessage(error)}` });
  }
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
