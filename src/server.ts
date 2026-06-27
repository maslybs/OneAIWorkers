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

export function createMcpServer(env: Env, request: Request): McpServer {
  const server = new McpServer({
    name: env.HUB_NAME || "OneAIWorkers",
    version: "0.3.0",
  });

  server.registerTool(
    "hub_info",
    {
      description: bi(
        "Shows what this OneAIWorkers MCP server can do and which optional integrations are configured.",
        "Показує, що вміє цей OneAIWorkers MCP server і які опційні інтеграції налаштовані.",
      ),
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      mcpText({
        ok: true,
        data: {
          name: env.HUB_NAME || "OneAIWorkers",
          base_url: buildBaseUrl(request, env),
          mcp_url: `${buildBaseUrl(request, env)}/mcp`,
          model: bilingualObject(
            "The LLM owns memory, scheduling, and decisions. This Worker is the safe action gateway.",
            "LLM відповідає за памʼять, розклад і рішення. Цей Worker є безпечним шлюзом для дій.",
          ),
          modes: {
            basic: bilingualObject(
              "Connector manifests are stored in D1 and executed by the main Worker.",
              "Описи конекторів зберігаються в D1 і виконуються основним Worker.",
            ),
            advanced: bilingualObject(
              "Worker Builder can deploy separate child Workers when CF_ACCOUNT_ID and CF_API_TOKEN are configured.",
              "Worker Builder може створювати окремі child Workers, якщо налаштовано CF_ACCOUNT_ID і CF_API_TOKEN.",
            ),
          },
          tools: [
            "fetch_url",
            "fetch_many_urls",
            "fetch_rss",
            "check_url_status",
            "send_notification",
            "call_webhook",
            "save_connector",
            "list_connectors",
            "connector_setup_status",
            "test_connector",
            "call_connector_tool",
            "delete_connector",
            "create_child_worker_from_template",
            "deploy_custom_child_worker",
          ],
          configured: {
            d1_database: Boolean(env.OAUTH_DB),
            mcp_shared_secret: Boolean(env.MCP_SHARED_SECRET),
            telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
            discord: Boolean(env.DISCORD_WEBHOOK_URL),
            slack: Boolean(env.SLACK_WEBHOOK_URL),
            default_webhook: Boolean(env.DEFAULT_WEBHOOK_URL),
            worker_builder: Boolean(env.CF_ACCOUNT_ID && env.CF_API_TOKEN),
          },
        },
      }),
  );

  tool(server, "fetch_url", bi("Fetches a public HTTPS URL and returns text suitable for LLM interpretation. Blocks local/private hosts.", "Отримує публічний HTTPS URL і повертає текст, зручний для інтерпретації LLM. Блокує local/private hosts."), fetchUrlSchema, fetchUrl);
  tool(server, "fetch_many_urls", bi("Fetches up to 10 public HTTPS URLs.", "Отримує до 10 публічних HTTPS URL."), fetchManyUrlsSchema, fetchManyUrls);
  tool(server, "fetch_rss", bi("Fetches an RSS/Atom feed and returns recent items.", "Отримує RSS/Atom feed і повертає останні елементи."), fetchRssSchema, fetchRss);
  tool(server, "check_url_status", bi("Checks whether a public website/API is reachable and how long it took.", "Перевіряє, чи доступний публічний сайт/API і скільки часу зайняв запит."), checkUrlStatusSchema, checkUrlStatus);
  tool(server, "send_notification", bi("Sends a notification to Telegram, Discord, Slack, or a generic webhook. This is an external side effect.", "Надсилає повідомлення в Telegram, Discord, Slack або generic webhook. Це зовнішня дія з побічним ефектом."), sendNotificationSchema, (args) => sendNotification(env, args));
  tool(server, "call_webhook", bi("Calls an HTTPS webhook with a JSON payload.", "Викликає HTTPS webhook з JSON payload."), callWebhookSchema, callWebhook);

  tool(server, "save_connector", bi("Creates or updates a connector. Basic mode stores API actions in D1. Advanced mode can point to a child Worker.", "Створює або оновлює конектор. Базовий режим зберігає API-дії в D1. Розширений режим може вказувати на child Worker."), saveConnectorSchema, (args) => saveConnector(env, args));
  tool(server, "list_connectors", bi("Lists saved connectors and optionally their actions.", "Показує збережені конектори й, за потреби, їхні дії."), listConnectorsSchema, (args) => listConnectors(env, args));
  tool(server, "connector_setup_status", bi("Shows connector engine readiness, configured integrations, saved connectors, and missing Cloudflare Secrets.", "Показує готовність connector engine, налаштовані інтеграції, збережені конектори й відсутні Cloudflare Secrets."), connectorSetupStatusSchema, (args) => connectorSetupStatus(env, args));
  tool(server, "test_connector", bi("Tests a connector action. By default it prepares the request without calling the external API.", "Тестує дію конектора. За замовчуванням готує запит без виклику зовнішнього API."), testConnectorSchema, (args) => testConnector(env, args));
  tool(server, "call_connector_tool", bi("Calls a saved connector action. Secrets are read by name from Cloudflare Secrets and are never returned to the LLM.", "Викликає збережену дію конектора. Secrets читаються за назвою з Cloudflare Secrets і ніколи не повертаються LLM."), callConnectorToolSchema, (args) => callConnectorTool(env, args));
  tool(server, "delete_connector", bi("Deletes a saved connector and its actions.", "Видаляє збережений конектор і його дії."), connectorIdSchema, (args) => deleteConnector(env, args));

  server.registerTool(
    "create_child_worker_from_template",
    {
      description: bi(
        "Advanced tool: deploys a child Cloudflare Worker from a safe template. Currently supports webhook-forwarder only. Does not run arbitrary JavaScript.",
        "Розширений інструмент: створює child Cloudflare Worker з безпечного шаблону. Наразі підтримує тільки webhook-forwarder. Не запускає довільний JavaScript.",
      ),
      inputSchema: createChildWorkerSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => safeRun(() => createChildWorkerFromTemplate(env, args)),
  );

  server.registerTool(
    "deploy_custom_child_worker",
    {
      description: bi(
        "Advanced Worker Builder: deploys LLM-written JavaScript as a separate child Worker. Use only after reviewing the code and confirming allow_custom_code=true.",
        "Розширений Worker Builder: деплоїть JavaScript, написаний LLM, як окремий child Worker. Використовуйте тільки після перевірки коду й підтвердження allow_custom_code=true.",
      ),
      inputSchema: deployCustomChildWorkerSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => safeRun(() => deployCustomChildWorker(env, args)),
  );

  return server;
}

function tool<T extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: T,
  handler: (args: z.infer<z.ZodObject<T>>) => Promise<unknown> | unknown,
) {
  const callback = (async (args: unknown) => safeRun(() => handler(args as z.infer<z.ZodObject<T>>))) as never;
  server.registerTool(name, { description, inputSchema }, callback);
}

async function safeRun(fn: () => Promise<unknown> | unknown) {
  try {
    const data = await fn();
    return mcpText({ ok: true, data });
  } catch (error) {
    return mcpText({ ok: false, message: `${biInline("Error", "Помилка")}: ${errorMessage(error)}` });
  }
}
