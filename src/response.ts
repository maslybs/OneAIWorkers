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
  if (!payload.ok) return payload.message || "Error / Помилка";
  if (payload.message) return payload.message;
  return JSON.stringify(payload, null, 2);
}
