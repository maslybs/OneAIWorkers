import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bi, bilingualObject, biInline } from "./i18n";
import type { Env } from "./types";
import { buildBaseUrl } from "./auth";
import { errorMessage, mcpText } from "./response";
import { checkUrlStatus, checkUrlStatusSchema, fetchManyUrls, fetchManyUrlsSchema, fetchRss, fetchRssSchema, fetchUrl, fetchUrlSchema } from "./tools/observe";
import { callWebhook, callWebhookSchema, sendNotification, sendNotificationSchema } from "./tools/notify";
import { createChildWorkerFromTemplate, createChildWorkerSchema } from "./tools/factory";

export function createMcpServer(env: Env, request: Request): McpServer {
  const server = new McpServer({
    name: env.HUB_NAME || "OneAIWorkers",
    version: "0.2.0",
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
            "The LLM owns memory, scheduling, and decisions. This Worker only executes safe actions.",
            "LLM відповідає за памʼять, розклад і рішення. Цей Worker лише виконує безпечні дії.",
          ),
          tools: ["fetch_url", "fetch_many_urls", "fetch_rss", "check_url_status", "send_notification", "call_webhook", "create_child_worker_from_template"],
          configured: {
            mcp_shared_secret: Boolean(env.MCP_SHARED_SECRET),
            telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
            discord: Boolean(env.DISCORD_WEBHOOK_URL),
            slack: Boolean(env.SLACK_WEBHOOK_URL),
            default_webhook: Boolean(env.DEFAULT_WEBHOOK_URL),
            child_worker_factory: Boolean(env.CF_ACCOUNT_ID && env.CF_API_TOKEN),
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

  server.registerTool(
    "create_child_worker_from_template",
    {
      description: bi(
        "Optional advanced tool: deploys a child Cloudflare Worker from a safe template. Currently supports webhook-forwarder only. Does not run arbitrary JavaScript.",
        "Опційний просунутий tool: деплоїть дочірній Cloudflare Worker з безпечного template. Наразі підтримує тільки webhook-forwarder. Не запускає довільний JavaScript.",
      ),
      inputSchema: createChildWorkerSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => safeRun(() => createChildWorkerFromTemplate(env, args)),
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
  server.registerTool(name, { description, inputSchema }, async (args) => safeRun(() => handler(args as z.infer<z.ZodObject<T>>)));
}

async function safeRun(fn: () => Promise<unknown> | unknown) {
  try {
    const data = await fn();
    return mcpText({ ok: true, data });
  } catch (error) {
    return mcpText({ ok: false, message: `${biInline("Error", "Помилка")}: ${errorMessage(error)}` });
  }
}
