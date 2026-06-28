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
            "Secure remote MCP gateway for connecting ChatGPT to user-owned HTTP APIs through saved connector manifests on Cloudflare Workers.",
            "Безпечний remote MCP gateway для підключення ChatGPT до HTTP API користувача через збережені connector manifests на Cloudflare Workers.",
          ),
          mcp_endpoint: `${baseUrl}/mcp`,
          recommended_first_tools: ["connector_setup_status", "list_connectors", "test_connector", "call_connector_tool"],
          connector_engine: {
            storage: "D1",
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
            response_format: "structuredContent plus compact JSON summary/json_preview",
            child_worker_model: {
              default_route: "main_gateway_only",
              main_gateway_tool: "call_connector_tool",
              supported_invocations: ["service_binding", "protected_url"],
              direct_child_url: "optional for advanced/manual use, not required for ChatGPT",
            },
          },
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
          authentication: isOAuthEnabled(env)
            ? bilingualObject(
                "OAuth is enabled. For private deployments, OAuth authorization requires MCP_SHARED_SECRET. Manual API access should use Authorization: Bearer or x-oneaiworkers-token, not URL query secrets.",
                "OAuth увімкнено. Для приватних розгортань OAuth authorization вимагає MCP_SHARED_SECRET. Ручний API доступ має використовувати Authorization: Bearer або x-oneaiworkers-token, не secrets у URL.",
              )
            : env.MCP_SHARED_SECRET
              ? bilingualObject(
                  "MCP endpoint expects a shared secret via Authorization: Bearer or x-oneaiworkers-token.",
                  "MCP endpoint очікує shared secret через Authorization: Bearer або x-oneaiworkers-token.",
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
