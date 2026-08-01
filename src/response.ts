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
  const browserAction = installBrowserAction(payload.data);
  const confirmationAction = confirmationBrowserAction(payload.data);
  const structuredContent = {
    ...payload,
    ...(payload.update
      ? {
        user_action_required: true,
        important_message: payload.update.critical
          ? "A critical OneAIWorkers update is available. / Доступне нове критичне оновлення OneAIWorkers."
          : "A new OneAIWorkers update is available. / Доступне нове оновлення OneAIWorkers.",
        update_url: payload.update.update_url,
        update_action_label: "Update / Оновитися",
        open_update_url_in_browser: true,
        do_not_fetch_update_url_from_a_tool: true,
        response_instruction: "Put the update link at the very beginning of the user-facing response. Tell the user to open it in a normal browser. Do not test or open it with fetch_url or another server-side tool. / Поставте посилання на оновлення на самому початку відповіді користувачу. Скажіть відкрити його у звичайному браузері. Не перевіряйте і не відкривайте його через fetch_url або інший серверний інструмент.",
        update: payload.update,
      }
      : {}),
    ...(browserAction
      ? {
          user_action_required: true,
          install_url: browserAction.url,
          open_install_url_in_browser: true,
          do_not_fetch_install_url_from_a_tool: true,
          response_instruction: browserAction.response_instruction,
        }
      : {}),
    ...(confirmationAction
      ? {
          user_action_required: true,
          confirmation_required: true,
          confirmation_url: confirmationAction.url,
          confirmation_token: confirmationAction.token,
          open_confirmation_url_in_browser: true,
          retry_same_action_after_approval: true,
          do_not_only_check_plugin_list: true,
          response_instruction: confirmationAction.response_instruction,
        }
      : {}),
    ...(payload.update && confirmationAction
      ? {
          response_instruction: "Put the update link first, then the confirmation link. After browser approval, repeat the exact same w_call with unchanged arguments and confirmation_token. / Поставте спочатку посилання на оновлення, а потім посилання підтвердження. Після схвалення у браузері повторіть той самий w_call з незмінними аргументами й confirmation_token.",
        }
      : {}),
  };
  return {
    structuredContent,
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
  if (!payload.update) {
    const confirmationAction = confirmationBrowserAction(payload.data);
    if (confirmationAction) return confirmationSummary(confirmationAction, result);
    const browserAction = installBrowserAction(payload.data);
    if (!browserAction) return result;
    return [
      browserAction.url,
      "OPEN IN A NORMAL BROWSER / ВІДКРИЙТЕ У ЗВИЧАЙНОМУ БРАУЗЕРІ",
      "Put this exact link at the very beginning of the user-facing reply. / Поставте це точне посилання на самому початку відповіді користувачу.",
      "Do not open it with fetch_url or another server-side tool. / Не відкривайте його через fetch_url або інший серверний інструмент.",
      "",
      result,
    ].join("\n");
  }

  const importance = payload.update.critical
    ? "IMPORTANT SECURITY UPDATE / ДОСТУПНЕ НОВЕ КРИТИЧНЕ ОНОВЛЕННЯ"
    : "NEW UPDATE AVAILABLE / ДОСТУПНЕ НОВЕ ОНОВЛЕННЯ";
  return [
    importance,
    "UPDATE IN A NORMAL BROWSER / ОНОВИТИСЯ У ЗВИЧАЙНОМУ БРАУЗЕРІ:",
    payload.update.update_url,
    "Put this link at the very beginning of your response to the user. / Поставте це посилання на самому початку відповіді користувачу.",
    "Do not call this link with fetch_url or another server-side tool. / Не викликайте це посилання через fetch_url або інший серверний інструмент.",
    "",
    `OneAIWorkers ${payload.update.current_version} → ${payload.update.latest_version}`,
    payload.update.message.en,
    payload.update.message.uk,
    "",
    ...(confirmationBrowserAction(payload.data)
      ? confirmationSummary(confirmationBrowserAction(payload.data)!, "").split("\n")
      : []),
    result,
  ].join("\n");
}

function confirmationBrowserAction(data: unknown): { url: string; token: string; response_instruction: string } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as { confirmation_required?: unknown; confirmation_url?: unknown; confirmation_token?: unknown };
  if (value.confirmation_required !== true || typeof value.confirmation_url !== "string" || !value.confirmation_url.startsWith("https://")) return null;
  if (typeof value.confirmation_token !== "string" || value.confirmation_token.length < 20) return null;
  return {
    url: value.confirmation_url,
    token: value.confirmation_token,
    response_instruction: "Put this confirmation link first. After the user approves it, repeat the exact same w_call with unchanged tool_ref, arguments, and confirmation_token. Merely listing plugins does not execute the approved action. / Поставте це посилання підтвердження першим. Після схвалення повторіть той самий w_call із незмінними tool_ref, arguments і confirmation_token. Простий перегляд списку плагінів не виконує схвалену дію.",
  };
}

function confirmationSummary(
  action: { url: string; token: string; response_instruction: string },
  result: string,
): string {
  return [
    action.url,
    "CONFIRM IN A NORMAL BROWSER / ПІДТВЕРДЬТЕ У ЗВИЧАЙНОМУ БРАУЗЕРІ",
    "After approval, repeat the exact same w_call with unchanged arguments and confirmation_token. / Після схвалення повторіть той самий w_call з незмінними аргументами й confirmation_token.",
    "Do not only check the plugin list: that does not execute the approved action. / Не обмежуйтеся перевіркою списку плагінів: вона не виконує схвалену дію.",
    action.token,
    result,
  ].filter(Boolean).join("\n");
}

function installBrowserAction(data: unknown): { url: string; response_instruction: string } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const action = (data as { browser_action?: unknown }).browser_action;
  if (!action || typeof action !== "object" || Array.isArray(action)) return null;
  const value = action as { type?: unknown; url?: unknown; response_instruction?: unknown };
  if (value.type !== "install_plugin" || typeof value.url !== "string" || !value.url.startsWith("https://")) return null;
  return {
    url: value.url,
    response_instruction: typeof value.response_instruction === "string"
      ? value.response_instruction
      : "Open this plugin installation link in a normal browser. / Відкрийте це посилання встановлення плагіна у звичайному браузері.",
  };
}
