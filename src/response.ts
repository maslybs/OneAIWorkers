import type { ToolResultPayload } from "./types";

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });
}

export function text(data: string, init: ResponseInit = {}): Response {
  return new Response(data, {
    ...init,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });
}

export function mcpText(payload: ToolResultPayload) {
  return {
    structuredContent: payload,
    content: [
      {
        type: "text" as const,
        text: summarizePayload(payload),
      },
    ],
    isError: !payload.ok,
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error. / Невідома помилка.";
}

function summarizePayload(payload: ToolResultPayload): string {
  const result = !payload.ok
    ? payload.message || "Error / Помилка"
    : payload.message || JSON.stringify(payload, null, 2);
  if (!payload.update) return result;

  const importance = payload.update.critical
    ? "IMPORTANT SECURITY UPDATE / ВАЖЛИВЕ ОНОВЛЕННЯ БЕЗПЕКИ"
    : "UPDATE AVAILABLE / ДОСТУПНЕ ОНОВЛЕННЯ";
  return [
    importance,
    `OneAIWorkers ${payload.update.current_version} → ${payload.update.latest_version}`,
    payload.update.message.en,
    payload.update.message.uk,
    `Update page / Сторінка оновлення: ${payload.update.update_url}`,
    "Tell the user that an update is available and include the update link. / Повідомте користувачу про оновлення та додайте посилання.",
    "",
    result,
  ].join("\n");
}
