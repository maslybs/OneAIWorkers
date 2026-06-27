import { createMcpHandler } from "agents/mcp";
import { buildBaseUrl, isMcpAuthorized, unauthorized } from "./auth";
import { biInline, bilingualObject } from "./i18n";
import { homeHtml } from "./html";
import { createMcpServer } from "./server";
import type { Env } from "./types";
import { errorMessage, json, text } from "./response";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const baseUrl = buildBaseUrl(request, env);

      if (url.pathname === "/" && request.method === "GET") {
        return new Response(homeHtml(env, baseUrl), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, name: env.HUB_NAME || "AI Action Hub", now: new Date().toISOString() });
      }

      if (url.pathname === "/.well-known/action-hub" && request.method === "GET") {
        return json({
          name: env.HUB_NAME || "AI Action Hub",
          description: bilingualObject(
            "Personal remote MCP Action Hub for LLM-triggered automations on Cloudflare Workers.",
            "Персональний remote MCP Action Hub для LLM-автоматизацій на Cloudflare Workers.",
          ),
          mcp_endpoint: `${baseUrl}/mcp`,
          model: bilingualObject(
            "LLM owns memory, scheduling, and reasoning. Worker executes safe actions.",
            "LLM відповідає за памʼять, розклад і reasoning. Worker виконує безпечні дії.",
          ),
          tools: ["fetch_url", "fetch_many_urls", "fetch_rss", "check_url_status", "send_notification", "call_webhook", "create_child_worker_from_template"],
          authentication: env.MCP_SHARED_SECRET
            ? bilingualObject(
                "MCP endpoint expects a shared secret via Bearer token, x-action-hub-token, or ?key=.",
                "MCP endpoint очікує shared secret через Bearer token, x-action-hub-token або ?key=.",
              )
            : bilingualObject(
                "No MCP shared secret configured. Consider setting MCP_SHARED_SECRET for private deployments.",
                "MCP shared secret не налаштований. Для приватних деплоїв варто задати MCP_SHARED_SECRET.",
              ),
        });
      }

      if (url.pathname === "/mcp") {
        if (!isMcpAuthorized(request, env)) return unauthorized(env);
        const server = createMcpServer(env, request);
        return createMcpHandler(server)(request, env, ctx);
      }

      if (url.pathname === "/robots.txt") {
        return text("User-agent: *\nDisallow: /\n");
      }

      return json({ ok: false, error: biInline("Not found.", "Не знайдено.") }, { status: 404 });
    } catch (error) {
      return json({ ok: false, error: `${biInline("Internal error", "Внутрішня помилка")}: ${errorMessage(error)}` }, { status: 500 });
    }
  },
};
