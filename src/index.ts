import { createMcpHandler } from "agents/mcp";
import { buildBaseUrl, isMcpAdminAuthorized, isMcpAuthorized, unauthorized } from "./auth";
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
  confirmationApprovalPageHtml,
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
import { registerInstalledConnector } from "./connector-installation";
import { getInstalledPackage, getMarketplaceItem } from "./marketplace";
import { getPluginCredentialDefinition, verifyPluginConnection } from "./tools/integrations";
import {
  allowAutomaticPluginActions,
  approveConfirmation,
  createWAdminServer,
  loadConfirmationIntent,
  openConfirmationApproval,
  wCall,
} from "./w-gateway";

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

      const confirmationMatch = url.pathname.match(/^\/confirm\/([A-Za-z0-9_-]{20,300})$/u);
      if (confirmationMatch && (request.method === "GET" || request.method === "POST")) {
        const language = pageLanguage(url, request);
        const token = confirmationMatch[1];
        if (request.method === "GET") {
          const pending = await openConfirmationApproval(env, token);
          if (!pending) {
            return new Response(confirmationApprovalPageHtml(language, "expired"), {
              status: 410,
              headers: connectorPageHeaders(),
            });
          }
          const headers = new Headers(connectorPageHeaders());
          headers.append("set-cookie", `oneaiworkers_confirmation=${pending.browserNonce}; Path=/confirm/; Max-Age=1800; HttpOnly; Secure; SameSite=Strict`);
          return new Response(confirmationApprovalPageHtml(
            language,
            "pending",
            pending.toolRef,
            undefined,
            pending.executesInBrowser,
            pending.pluginId,
          ), { headers });
        }
        if (!isSameOriginFormRequest(request, baseUrl)) {
          return new Response(confirmationApprovalPageHtml(language, "expired"), {
            status: 403,
            headers: connectorPageHeaders(),
          });
        }
        const form = await request.formData();
        const approvalScope = form.get("approval_scope") === "plugin" ? "plugin" : "once";
        const browserNonce = cookieValue(request, "oneaiworkers_confirmation");
        const approved = browserNonce ? await approveConfirmation(env, token, browserNonce) : { ok: false as const };
        const headers = new Headers(connectorPageHeaders());
        headers.append("set-cookie", "oneaiworkers_confirmation=; Path=/confirm/; Max-Age=0; HttpOnly; Secure; SameSite=Strict");
        if (!approved.ok) {
          return new Response(confirmationApprovalPageHtml(language, "expired"), { status: 410, headers });
        }
        const intent = await loadConfirmationIntent(env, token);
        if (!intent) {
          return new Response(confirmationApprovalPageHtml(language, "approved"), { status: 200, headers });
        }
        if (approvalScope === "plugin") {
          await allowAutomaticPluginActions(env, {
            ...intent.context,
            baseUrl,
          }, intent.plugin.id, intent.plugin.versionId);
        }
        const execution = await wCall(env, {
          ...intent.context,
          baseUrl,
        }, {
          ...intent.input,
          confirmation_token: token,
        });
        const executionRecord = execution && typeof execution === "object" && !Array.isArray(execution)
          ? execution as Record<string, unknown>
          : {};
        const executionError = executionRecord.error && typeof executionRecord.error === "object" && !Array.isArray(executionRecord.error)
          ? executionRecord.error as Record<string, unknown>
          : {};
        const completed = executionRecord.ok === true;
        return new Response(confirmationApprovalPageHtml(
          language,
          completed ? "completed" : "failed",
          approved.toolRef,
          completed && approvalScope === "plugin"
            ? biInline(
              `Automatic actions are enabled for plugin ${intent.plugin.id}.`,
              `Автоматичні дії ввімкнено для плагіна ${intent.plugin.id}.`,
            )
            : typeof executionError.message === "string" ? executionError.message : undefined,
        ), { status: completed ? 200 : 502, headers });
      }

      const connectorInstallMatch = url.pathname.match(/^\/plugins\/install\/([a-z0-9_-]+)$/);
      if (connectorInstallMatch && request.method === "GET") {
        const entry = await getMarketplaceItem(env, connectorInstallMatch[1]);
        if (!entry) return json({ ok: false, error: biInline("Cloud plugin not found.", "Хмарний плагін не знайдено.") }, { status: 404 });
        const language = pageLanguage(url, request);
        return new Response(connectorInstallPageHtml(env, baseUrl, entry.item, entry.target, language), {
          headers: connectorPageHeaders(),
        });
      }

      const connectorUpdateMatch = url.pathname.match(/^\/plugins\/([a-z0-9_-]+)\/update$/);
      if (connectorUpdateMatch && request.method === "GET") {
        const installed = await getInstalledPackage(env, connectorUpdateMatch[1]);
        if (!installed) return json({ ok: false, error: biInline("Installed plugin not found.", "Встановлений плагін не знайдено.") }, { status: 404 });
        const entry = await getMarketplaceItem(env, installed.package_id);
        if (!entry) return json({ ok: false, error: biInline("Cloud plugin not found.", "Хмарний плагін не знайдено.") }, { status: 404 });
        const language = pageLanguage(url, request);
        return new Response(connectorUpdatePageHtml(env, baseUrl, entry.item, entry.target, installed, language), {
          headers: connectorPageHeaders(),
        });
      }

      if (url.pathname === "/plugins/complete" && request.method === "POST") {
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

      const connectorAccessMatch = url.pathname.match(/^\/plugins\/access\/([A-Za-z0-9_-]{32,200})$/);
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
        const target = `${baseUrl}/plugins/${encodeURIComponent(access.connectorId)}/setup?lang=${language}`;
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

      const connectorSetupMatch = url.pathname.match(/^\/plugins\/([a-z0-9_-]+)\/setup$/);
      if (connectorSetupMatch && (request.method === "GET" || request.method === "POST")) {
        const connectorId = connectorSetupMatch[1];
        const session = readConnectorSessionCookie(request);
        if (!(await validateConnectorSession(env, connectorId, session))) {
          return json({ ok: false, error: biInline("This settings link has expired. Ask your MCP client for a new settings link.", "Термін дії посилання минув. Попросіть MCP-клієнт створити нове посилання на налаштування.") }, { status: 401 });
        }
        const definition = await getPluginCredentialDefinition(env, connectorId);
        const fields = definition.fields;
        const connectorName = definition.name;
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
            const verification = await verifyPluginConnection(env, connectorId);
            if (!verification.ok) {
              return new Response(connectorSetupPageHtml(connectorName, fields, values, language, verification.message), {
                status: 400,
                headers: connectorPageHeaders(),
              });
            }
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
            "A private MCP gateway with installable plugins, semantic operation search, protected credentials, and controlled execution on Cloudflare.",
            "Приватний MCP-шлюз із плагінами, пошуком потрібних дій, захищеними ключами та контрольованим виконанням у Cloudflare.",
          ),
          mcp_endpoint: `${baseUrl}/mcp`,
          mcp_admin_endpoint: `${baseUrl}/mcp/admin`,
          update_page: `${baseUrl}/update`,
          gateway: {
            mode: "meta",
            public_tools: ["w_search", "w_describe", "w_call", "w_present", "w_result_read", "w_agent_run"],
            registry_source: "D1",
            semantic_search: Boolean(env.AI),
            client_refresh_after_plugin_install: false,
            direct_mode_enabled: String(env.W_ENABLE_LEGACY_DIRECT || "").toLowerCase() === "true",
          },
          neuron_meter: {
            local_tracking_configured: Boolean(env.OAUTH_DB),
            discover_with: "w_search",
            daily_free_allocation: DAILY_NEURON_ALLOCATION,
            paid_price_usd_per_1000_neurons: USD_PER_1000_NEURONS,
            reset_timezone: "UTC",
            account_total_available_without_api_token: false,
          },
          recommended_first_tool: "w_search",
          plugin_installation: {
            discovery_query: "Find a plugin for the task and return its browser installation link.",
            settings_path: "/plugins/{plugin_id}/setup",
            availability_rule: bilingualObject(
              "A plugin is available only when the live registry or marketplace returns it.",
              "Плагін доступний лише тоді, коли його повернув живий реєстр або каталог.",
            ),
            credentials_rule: bilingualObject(
              "Service keys are entered only on the protected plugin page of the user's own Worker, never in chat.",
              "Ключі сервісу вводяться лише на захищеній сторінці плагіна у власному Worker, ніколи не в чаті.",
            ),
          },
          registry: {
            package_format: "oneai.plugin.v1",
            versioned_tool_references: true,
            stores_schemas_in_d1: true,
            stores_embeddings_in_d1: true,
            full_schemas_are_loaded_only_by_w_describe: true,
            large_results_use_w_result_read: true,
          },
          oauth: isOAuthEnabled(env)
            ? {
                enabled: true,
                authorization_server: baseUrl,
                protected_resource_metadata: `${baseUrl}/.well-known/oauth-protected-resource`,
              }
            : { enabled: false },
          model: bilingualObject(
            "The MCP client searches the plugin registry, loads only the chosen schemas, and runs known versioned operations with permissions, confirmation, and repeat protection.",
            "MCP-клієнт шукає потрібну дію в реєстрі плагінів, завантажує лише обрані схеми та виконує відомі версійні дії з перевіркою прав, підтвердженням і захистом від повтору.",
          ),
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

      if (["/mcp", "/mcp/direct", "/mcp/hybrid", "/mcp/admin"].includes(url.pathname)) {
        if (url.pathname === "/mcp/admin") {
          if (!(await isMcpAdminAuthorized(request, env))) {
            return json({ ok: false, error: biInline("Administrator access is required.", "Потрібен доступ адміністратора.") }, { status: 403 });
          }
        } else if (!(await isMcpAuthorized(request, env))) return unauthorized(request, env);
        const legacyMode = url.pathname === "/mcp/direct" || url.pathname === "/mcp/hybrid";
        if (legacyMode && String(env.W_ENABLE_LEGACY_DIRECT || "").toLowerCase() !== "true") {
          return json({ ok: false, error: biInline("Legacy direct mode is disabled.", "Старий прямий режим вимкнено.") }, { status: 404 });
        }
        const server = url.pathname === "/mcp/admin"
          ? await createWAdminServer(env, request)
          : await createMcpServer(env, request, url.pathname === "/mcp/direct" ? "direct" : url.pathname === "/mcp/hybrid" ? "hybrid" : "meta");
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

function cookieValue(request: Request, name: string): string | null {
  const match = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

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
