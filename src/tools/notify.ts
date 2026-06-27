import { z } from "zod";
import { biInline } from "../i18n";
import { assertSafeOutboundUrl, redactUrlForOutput } from "../security";
import type { Env } from "../types";

export const sendNotificationSchema = {
  channel: z.enum(["telegram", "discord", "slack", "webhook"]).default("webhook").describe(biInline("Notification channel.", "Канал для повідомлення.")),
  message: z.string().min(1).max(8000).describe(biInline("Message text to send.", "Текст повідомлення для відправки.")),
  title: z.string().max(200).optional().describe(biInline("Optional short title.", "Опційний короткий заголовок.")),
  webhook_url: z.string().url().optional().describe(biInline("Optional explicit webhook URL. If omitted, the Worker uses configured secrets.", "Опційний webhook URL. Якщо не передано, Worker використає налаштовані secrets.")),
  telegram_chat_id: z.string().optional().describe(biInline("Optional Telegram chat id. If omitted, TELEGRAM_CHAT_ID is used.", "Опційний Telegram chat id. Якщо не передано, використовується TELEGRAM_CHAT_ID.")),
};

export const callWebhookSchema = {
  url: z.string().url().describe(biInline("Public HTTPS webhook URL to call.", "Публічний HTTPS webhook URL для виклику.")),
  method: z.enum(["POST", "PUT", "PATCH"]).default("POST").describe(biInline("HTTP method for the webhook call.", "HTTP метод для webhook-виклику.")),
  body: z.any().optional().describe(biInline("JSON-serializable payload.", "JSON-сумісне тіло запиту.")),
  headers: z.record(z.string(), z.string()).optional().describe(biInline("Extra non-sensitive headers. Authorization, Cookie, Set-Cookie and Host are ignored.", "Додаткові нечутливі headers. Authorization, Cookie, Set-Cookie і Host ігноруються.")),
};

export async function sendNotification(env: Env, args: z.infer<z.ZodObject<typeof sendNotificationSchema>>) {
  const body = args.title ? `${args.title}\n\n${args.message}` : args.message;
  switch (args.channel) {
    case "telegram":
      return sendTelegram(env, body, args.telegram_chat_id);
    case "discord":
      return postJson(args.webhook_url || env.DISCORD_WEBHOOK_URL, { content: body });
    case "slack":
      return postJson(args.webhook_url || env.SLACK_WEBHOOK_URL, { text: body });
    case "webhook":
      return postJson(args.webhook_url || env.DEFAULT_WEBHOOK_URL, { title: args.title, message: args.message, sent_at: new Date().toISOString() });
  }
}

export async function callWebhook(args: z.infer<z.ZodObject<typeof callWebhookSchema>>) {
  const url = assertSafeOutboundUrl(args.url);
  const headers = new Headers({ "content-type": "application/json" });
  for (const [key, value] of Object.entries(args.headers ?? {})) {
    const normalized = key.toLowerCase();
    if (["authorization", "cookie", "set-cookie", "host"].includes(normalized)) continue;
    headers.set(key, value.slice(0, 1000));
  }
  const response = await fetch(url, {
    method: args.method,
    headers,
    body: JSON.stringify(args.body ?? {}),
  });
  const responseText = await response.text();
  return {
    ok: response.ok,
    url: redactUrlForOutput(url),
    status: response.status,
    text: responseText.slice(0, 4000),
    truncated: responseText.length > 4000,
  };
}

async function sendTelegram(env: Env, message: string, chatId?: string) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error(biInline("TELEGRAM_BOT_TOKEN secret is not configured.", "Secret TELEGRAM_BOT_TOKEN не налаштований."));
  const targetChatId = chatId || env.TELEGRAM_CHAT_ID;
  if (!targetChatId) throw new Error(biInline("TELEGRAM_CHAT_ID secret or telegram_chat_id argument is required.", "Потрібен secret TELEGRAM_CHAT_ID або аргумент telegram_chat_id."));

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: targetChatId, text: message.slice(0, 3900) }),
  });
  const payload = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, response: payload };
}

async function postJson(url: string | undefined, body: unknown) {
  if (!url) throw new Error(biInline("No webhook URL configured or provided.", "Webhook URL не налаштований і не переданий."));
  const target = assertSafeOutboundUrl(url);
  const response = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  return { ok: response.ok, url: redactUrlForOutput(target), status: response.status, text: responseText.slice(0, 2000) };
}
