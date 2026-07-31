import { createMcpHandler } from "agents/mcp";
import { buildBaseUrl, isMcpAuthorized, unauthorized } from "./auth";
import { bilingualObject, biInline } from "./i18n";
import { homeHtml } from "./html";
import {
  handleOAuthAuthorize,
  handleOAuthRegister,
  handleOAuthRevoke,
  handleOAuthToken,
  isOAuthEnabled,
  oauthMetadata,
  protectedResourceMetadata,
} from "./oauth";
import { createMcpServer } from "./server";
import type { Env } from "./types";
import { errorMessage, json, text } from "./response";
import { APP_VERSION, getUpdateState, updateServiceStartUrl } from "./update";
import { updatePageHtml } from "./update-page";
import { normalizeMcpToolCallRequest } from "./mcp-request";
import { isSameOriginFormRequest } from "./security";
import { DAILY_NEURON_ALLOCATION, USD_PER_1000_NEURONS } from "./tools/neuron-meter";
import {
  connectorAccessPageHtml,
  connectorPageHeaders,
  connectorInstallPageHtml,
  connectorSetupPageHtml,
  connectorUpdatePageHtml,
  pageLanguage,
} from "./connector-pages";
import {
  connectorSessionCookie,
  consumeConnectorAccessToken,
  loadCredentialProfile,
  readConnectorSessionCookie,
  sanitizeSubmittedCredentials,
  storeCredentialProfile,
  validateConnectorSession,
} from "./vault";
import { parseCredentialFields, registerInstalledConnector } from "./connector-installation";
import { getInstalledPackage, getMarketplaceItem } from "./marketplace";

export { AgentManager } from "./agents";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const baseUrl = buildBaseUrl(request, env);

      if (url.pathname === "/" && request.method === "GET") {
        return new Response(homeHtml(env, baseUrl), { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, name: env.HUB_NAME || "OneAIWorkers", version: APP_VERSION, now: new Date().toISOString() });
      }

      if (url.pathname === "/update" && request.method === "GET") {
        const updateState = await getUpdateState(env, baseUrl);
        return new Response(updatePageHtml(updateState, baseUrl), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
            "referrer-policy": "no-referrer",
            "x-content-type-options": "nosniff",
          },
        });
      }

      if (url.pathname === "/update/start" && request.method === "GET") {
        const updateState = await getUpdateState(env, baseUrl);
        const startUrl = updateServiceStartUrl(updateState, baseUrl);
        if (!startUrl) return Response.redirect(`${baseUrl}/update`, 303);
        return Response.redirect(startUrl, 303);
      }

      const connectorInstallMatch = url.pathname.match(/^\/connectors\/install\/([a-z0-9_-]+)$/);
      if (connectorInstallMatch && request.method === "GET") {
        const entry = await getMarketplaceItem(env, connectorInstallMatch[1]);
        if (!entry) return json({ ok: false, error: biInline("Cloud connector not found.", "Хмарний конектор не знайдено.") }, { status: 404 });
        const language = pageLanguage(url, request);
        return new Response(connectorInstallPageHtml(env, baseUrl, entry.item, entry.target, language), {
          headers: connectorPageHeaders(),
        });
      }

      const connectorUpdateMatch = url.pathname.match(/^\/connectors\/([a-z0-9_-]+)\/update$/);
      if (connectorUpdateMatch && request.method === "GET") {
        const installed = await getInstalledPackage(env, connectorUpdateMatch[1]);
        if (!installed) return json({ ok: false, error: biInline("Installed connector not found.", "Встановлений конектор не знайдено.") }, { status: 404 });
        const entry = await getMarketplaceItem(env, installed.package_id);
        if (!entry) return json({ ok: false, error: biInline("Cloud connector not found.", "Хмарний конектор не знайдено.") }, { status: 404 });
        const language = pageLanguage(url, request);
        return new Response(connectorUpdatePageHtml(env, baseUrl, entry.item, entry.target, installed, language), {
          headers: connectorPageHeaders(),
        });
      }

      if (url.pathname === "/connectors/complete" && request.method === "POST") {
        const contentType = request.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("application/json")) {
          return json({ ok: false, error: "Expected application/json." }, { status: 415 });
        }
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (contentLength > 256_000) return json({ ok: false, error: "Installation ticket is too large." }, { status: 413 });
        const body = await request.json() as { ticket?: unknown };
        if (typeof body.ticket !== "string") return json({ ok: false, error: "Installation ticket is required." }, { status: 400 });
        if (body.ticket.length > 240_000) return json({ ok: false, error: "Installation ticket is too large." }, { status: 413 });
        return json(await registerInstalledConnector(env, baseUrl, body.ticket));
      }

      const connectorAccessMatch = url.pathname.match(/^\/connectors\/access\/([A-Za-z0-9_-]{32,200})$/);
      if (connectorAccessMatch && (request.method === "GET" || request.method === "POST")) {
        const token = connectorAccessMatch[1];
        const language = pageLanguage(url, request);
        if (request.method === "GET") {
          return new Response(connectorAccessPageHtml(language), {
            headers: connectorPageHeaders(),
          });
        }
        if (!isSameOriginFormRequest(request, baseUrl)) {
          return json({ ok: false, error: biInline("The request came from another website.", "Запит надійшов з іншого сайту.") }, { status: 403 });
        }
        const access = await consumeConnectorAccessToken(env, token);
        const target = `${baseUrl}/connectors/${encodeURIComponent(access.connectorId)}/setup?lang=${language}`;
        const headers = new Headers({
          location: target,
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        });
        headers.append("set-cookie", connectorSessionCookie(access.sessionToken));
        headers.append("set-cookie", `oneaiworkers_lang=${language}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`);
        return new Response(null, {
          status: 303,
          headers,
        });
      }

      const connectorSetupMatch = url.pathname.match(/^\/connectors\/([a-z0-9_-]+)\/setup$/);
      if (connectorSetupMatch && (request.method === "GET" || request.method === "POST")) {
        const connectorId = connectorSetupMatch[1];
        const session = readConnectorSessionCookie(request);
        if (!(await validateConnectorSession(env, connectorId, session))) {
          return json({ ok: false, error: biInline("This settings link has expired. Ask your MCP client for a new settings link.", "Термін дії посилання минув. Попросіть MCP-клієнт створити нове посилання на налаштування.") }, { status: 401 });
        }
        const installed = await getInstalledPackage(env, connectorId);
        if (!installed) return json({ ok: false, error: biInline("Installed connector not found.", "Встановлений конектор не знайдено.") }, { status: 404 });
        const fields = parseCredentialFields(installed.credential_fields_json);
        const entry = await getMarketplaceItem(env, installed.package_id);
        const connectorName = entry?.item.name || installed.package_id;
        const language = pageLanguage(url, request);
        const existing = await loadCredentialProfile(env, connectorId, "user");

        if (request.method === "POST") {
          if (!isSameOriginFormRequest(request, baseUrl)) {
            return json({ ok: false, error: biInline("The request came from another website.", "Запит надійшов з іншого сайту.") }, { status: 403 });
          }
          try {
            const form = await request.formData();
            const values = sanitizeSubmittedCredentials(form, fields, existing);
            await storeCredentialProfile(env, connectorId, "user", values);
            return new Response(connectorSetupPageHtml(connectorName, fields, values, language, undefined, true), {
              headers: connectorPageHeaders(),
            });
          } catch (error) {
            return new Response(connectorSetupPageHtml(connectorName, fields, existing, language, errorMessage(error)), {
              status: 400,
              headers: connectorPageHeaders(),
            });
          }
        }

        return new Response(connectorSetupPageHtml(connectorName, fields, existing, language), {
          headers: connectorPageHeaders(),
        });
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

      if (url.pathname === "/oauth/revoke" && request.method === "POST") {
        return handleOAuthRevoke(request, env);
      }

      if (url.pathname === "/.well-known/oneaiworkers" && request.method === "GET") {
        return json({
          name: env.HUB_NAME || "OneAIWorkers",
          version: APP_VERSION,
          description: bilingualObject(
            "Secure remote MCP gateway for connecting ChatGPT, Claude, and other MCP-compatible clients to user-owned HTTP APIs through saved connector manifests on Cloudflare Workers.",
            "Безпечний віддалений MCP-шлюз для підключення ChatGPT, Claude та інших MCP-сумісних клієнтів до HTTP API користувача через збережені налаштування конекторів на Cloudflare Workers.",
          ),
          mcp_endpoint: `${baseUrl}/mcp`,
          update_page: `${baseUrl}/update`,
          stable_gateway: {
            discovery_tool: "list_connectors",
            invocation_tool: "call_connector_tool",
            system_connector_id: "system",
            native_connector_id: "native",
            connector_data_source: "D1_live",
            client_refresh_required: false,
          },
          neuron_meter: {
            local_tracking_configured: Boolean(env.OAUTH_DB),
            status_tool: "ai_neuron_status",
            history_tool: "ai_neuron_history",
            daily_free_allocation: DAILY_NEURON_ALLOCATION,
            paid_price_usd_per_1000_neurons: USD_PER_1000_NEURONS,
            reset_timezone: "UTC",
            account_total_available_without_api_token: false,
          },
          recommended_first_tools: ["connector_installation_help", "find_capability", "connector_setup_status", "list_connectors", "call_connector_tool", "test_connector"],
          connector_installation: {
            generic_help_tool: "connector_installation_help",
            catalog_search_tool: "find_capability",
            worker_home_has_marketplace_page: false,
            availability_rule: bilingualObject(
              "A connector is available only when find_capability returns it.",
              "Конектор доступний лише тоді, коли його повернув find_capability.",
            ),
            credentials_rule: bilingualObject(
              "Service credentials are entered only on the protected settings page of the user's own Worker, never in chat.",
              "Ключі сервісу вводяться лише на захищеній сторінці власного Worker користувача, ніколи не в чаті.",
            ),
          },
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
              direct_child_url: "optional for advanced/manual use, not required by normal MCP clients",
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
            "The MCP client can use direct tools or create data-defined agent teams. OneAIWorkers stores agent state and queued orchestration runs in a SQLite-backed Durable Object and executes bounded Workers AI steps with budgets and cancellation controls.",
            "MCP-клієнт може використовувати прямі tools або створювати data-defined команди агентів. OneAIWorkers зберігає стан агентів і queued orchestration runs у SQLite-backed Durable Object та виконує обмежені Workers AI кроки з бюджетами й cancellation controls.",
          ),
          tools: [
            "fetch_url",
            "fetch_many_urls",
            "fetch_rss",
            "check_url_status",
            "ai_capabilities",
            "ai_models_list",
            "ai_recommend_model",
            "ai_neuron_status",
            "ai_neuron_history",
            "ai_chat",
            "agent_capabilities",
            "agent_team_propose",
            "agent_create",
            "agent_list",
            "agent_update",
            "agent_team_create",
            "agent_team_list",
            "agent_team_update",
            "agent_team_start",
            "agent_run_list",
            "agent_run_status",
            "agent_run_cancel",
            "send_notification",
            "call_webhook",
            "connector_installation_help",
            "find_capability",
            "list_connector_updates",
            "get_connector_settings_link",
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
        const server = await createMcpServer(env, request);
        const normalizedRequest = await normalizeMcpToolCallRequest(request);
        const response = await createMcpHandler(server, { enableJsonResponse: true })(normalizedRequest, env, ctx);
        return withoutCaching(response);
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

function withoutCaching(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("pragma", "no-cache");
  headers.set("expires", "0");
  headers.set("vary", appendVary(headers.get("vary"), "authorization"));
  headers.set("x-oneaiworkers-runtime", APP_VERSION);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function appendVary(current: string | null, value: string): string {
  const values = new Set((current || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
  values.add(value.toLowerCase());
  return [...values].join(", ");
}
