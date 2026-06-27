import { createMcpHandler } from "agents/mcp";
import { buildBaseUrl, isMcpAuthorized, unauthorized } from "./auth";
import { bilingualObject, biInline } from "./i18n";
import { homeHtml } from "./html";
import {
  handleOAuthAuthorize,
  handleOAuthRegister,
  handleOAuthToken,
  isOAuthEnabled,
  oauthMetadata,
  protectedResourceMetadata,
} from "./oauth";
import { createMcpServer } from "./server";
import type { Env } from "./types";
import { errorMessage, json, text } from "./response";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const baseUrl = buildBaseUrl(request, env);

      if (url.pathname === "/" && request.method === "GET") {
        return new Response(homeHtml(env, baseUrl), { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, name: env.HUB_NAME || "OneAIWorkers", now: new Date().toISOString() });
      }

      if (
        (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration") &&
        request.method === "GET"
      ) {
        return json(oauthMetadata(baseUrl));
      }

      if (
        (url.pathname === "/.well-known/oauth-protected-resource" ||
          url.pathname === "/.well-known/oauth-protected-resource/mcp" ||
          url.pathname === "/mcp/.well-known/oauth-protected-resource") &&
        request.method === "GET"
      ) {
        return json(protectedResourceMetadata(baseUrl));
      }

      if (url.pathname === "/oauth/register" && request.method === "POST") {
        return handleOAuthRegister(request, env);
      }

      if (url.pathname === "/oauth/authorize" && (request.method === "GET" || request.method === "POST")) {
        return handleOAuthAuthorize(request, env, baseUrl);
      }

      if (url.pathname === "/oauth/token" && request.method === "POST") {
        return handleOAuthToken(request, env);
      }

      if (url.pathname === "/.well-known/oneaiworkers" && request.method === "GET") {
        return json({
          name: env.HUB_NAME || "OneAIWorkers",
          description: bilingualObject(
            "Personal remote MCP server for LLM-triggered automations on Cloudflare Workers.",
            "Персональний remote MCP server для LLM-автоматизацій на Cloudflare Workers.",
          ),
          mcp_endpoint: `${baseUrl}/mcp`,
          oauth: isOAuthEnabled(env)
            ? {
                enabled: true,
                authorization_server: baseUrl,
                protected_resource_metadata: `${baseUrl}/.well-known/oauth-protected-resource`,
              }
            : { enabled: false },
          model: bilingualObject(
            "LLM owns memory, scheduling, and reasoning. Worker executes safe actions.",
            "LLM відповідає за памʼять, розклад і reasoning. Worker виконує безпечні дії.",
          ),
          tools: ["fetch_url", "fetch_many_urls", "fetch_rss", "check_url_status", "send_notification", "call_webhook", "create_child_worker_from_template"],
          authentication: isOAuthEnabled(env)
            ? bilingualObject(
                "OAuth is enabled. MCP also accepts MCP_SHARED_SECRET if configured.",
                "OAuth увімкнено. MCP також приймає MCP_SHARED_SECRET, якщо він заданий.",
              )
            : env.MCP_SHARED_SECRET
              ? bilingualObject(
                  "MCP endpoint expects a shared secret via Bearer token, x-oneaiworkers-token, or ?key=.",
                  "MCP endpoint очікує shared secret через Bearer token, x-oneaiworkers-token або ?key=.",
                )
              : bilingualObject(
                  "No auth configured. Consider using OAuth or MCP_SHARED_SECRET for private deployments.",
                  "Авторизація не налаштована. Для приватних розгортань варто використовувати OAuth або MCP_SHARED_SECRET.",
                ),
        });
      }

      if (url.pathname === "/mcp") {
        if (!(await isMcpAuthorized(request, env))) return unauthorized(request, env);
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
