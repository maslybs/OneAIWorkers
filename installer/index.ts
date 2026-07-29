import { ONEAIWORKERS_CODE, ONEAIWORKERS_VERSION } from "./generated/oneaiworkers-bundle.js";
import {
  CloudflareApiError,
  accountSubdomain,
  createAccountSubdomain,
  createD1,
  deleteD1,
  deleteScript,
  enableWorkersDev,
  listAccounts,
  scriptBindingNames,
  scriptExists,
  updateWorker,
  uploadWorker,
} from "./cloudflare";
import { clearCookie, randomToken, readCookie, seal, secureCookie, unseal } from "./crypto";
import { errorHtml, installHtml, landingHtml, successHtml, updateHtml, updateSuccessHtml } from "./html";
import type { InstallerEnv, InstallerSession, OAuthState } from "./types";

const STATE_COOKIE = "__Host-oneai-install-state";
const SESSION_COOKIE = "__Host-oneai-install-session";
const STATE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 15 * 60;
const MAX_FORM_BYTES = 16 * 1024;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export default {
  async fetch(request: Request, env: InstallerEnv): Promise<Response> {
    try {
      const url = new URL(request.url);
      const name = env.INSTALLER_NAME?.trim() || "OneAIWorkers";
      const baseUrl = installerBaseUrl(request, env);

      if (url.pathname === "/health" && request.method === "GET") {
        return json({
          ok: true,
          name,
          version: ONEAIWORKERS_VERSION,
          configured: configurationError(env, baseUrl) === null,
        });
      }

      const configError = configurationError(env, baseUrl);
      if (configError) return html(errorHtml(name, configError, false), 503);

      if (url.pathname === "/" && request.method === "GET") {
        const session = await readSession(request, env);
        if (!session) return html(landingHtml(name));
        try {
          const accounts = await listAccounts(session.accessToken);
          if (accounts.length === 0) return html(errorHtml(name, "Cloudflare не надав жодного доступного облікового запису."), 403);
          return html(session.mode === "update" && session.workerUrl
            ? updateHtml(name, accounts, session.csrf, session.workerUrl)
            : installHtml(name, accounts, session.csrf));
        } catch (error) {
          if (error instanceof CloudflareApiError && (error.status === 401 || error.status === 403)) {
            return html(landingHtml(name, "Час доступу минув. Увійдіть ще раз."), 200, [clearCookie(SESSION_COOKIE)]);
          }
          throw error;
        }
      }

      if (url.pathname === "/oauth/start" && request.method === "GET") {
        return beginOAuth(env, baseUrl, { mode: "install" });
      }

      if (url.pathname === "/update/start" && request.method === "GET") {
        const workerUrl = normalizeWorkerUrl(url.searchParams.get("worker_url") || "");
        return beginOAuth(env, baseUrl, { mode: "update", workerUrl });
      }

      if (url.pathname === "/oauth/callback" && request.method === "GET") {
        const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");
        if (oauthError) return html(errorHtml(name, "Cloudflare не надав дозвіл. Спробуйте ще раз."), 400, [clearCookie(STATE_COOKIE)]);
        const code = url.searchParams.get("code") || "";
        const returnedState = url.searchParams.get("state") || "";
        const savedState = await readState(request, env);
        if (!code || !savedState || returnedState !== savedState.nonce) {
          return html(errorHtml(name, "Сеанс входу недійсний або вже завершився."), 400, [clearCookie(STATE_COOKIE)]);
        }
        const token = await exchangeCode(code, baseUrl, env);
        const session: InstallerSession = {
          accessToken: token,
          csrf: randomToken(),
          exp: nowSeconds() + SESSION_TTL_SECONDS,
          mode: savedState.mode,
          workerUrl: savedState.workerUrl,
        };
        const sealedSession = await seal(session, required(env.INSTALLER_SESSION_SECRET));
        return redirect("/", [
          clearCookie(STATE_COOKIE),
          secureCookie(SESSION_COOKIE, sealedSession, SESSION_TTL_SECONDS),
        ]);
      }

      if (url.pathname === "/install" && request.method === "POST") {
        verifySameOrigin(request, baseUrl);
        const session = await requireSession(request, env);
        if (session.mode !== "install") throw new UserError("Цей сеанс призначений для оновлення, а не встановлення.");
        const form = await readForm(request);
        verifyCsrf(form, session);
        const accountId = formValue(form, "account_id");
        const scriptName = normalizeScriptName(formValue(form, "script_name"));
        const accounts = await listAccounts(session.accessToken);
        if (!accounts.some((account) => account.id === accountId)) throw new UserError("Вибраний обліковий запис недоступний.");
        if (await scriptExists(session.accessToken, accountId, scriptName)) {
          return html(installHtml(name, accounts, session.csrf, `Воркер «${scriptName}» уже існує. Виберіть іншу назву.`), 409);
        }

        let databaseId: string | null = null;
        let workerCreated = false;
        try {
          const subdomain = await ensureAccountSubdomain(session.accessToken, accountId);
          const database = await createD1(
            session.accessToken,
            accountId,
            databaseName(scriptName),
          );
          databaseId = database.uuid;
          const sharedSecret = randomToken(36);
          await uploadWorker({
            token: session.accessToken,
            accountId,
            scriptName,
            databaseId,
            sharedSecret,
            installerUrl: baseUrl,
            code: ONEAIWORKERS_CODE,
          });
          workerCreated = true;
          await enableWorkersDev(session.accessToken, accountId, scriptName);
          await revokeToken(session.accessToken, env).catch(() => undefined);
          const workerUrl = `https://${scriptName}.${subdomain}.workers.dev`;
          return html(successHtml(name, `${workerUrl}/mcp`, sharedSecret), 200, [clearCookie(SESSION_COOKIE)]);
        } catch (error) {
          if (workerCreated) await deleteScript(session.accessToken, accountId, scriptName).catch(() => undefined);
          if (databaseId) await deleteD1(session.accessToken, accountId, databaseId).catch(() => undefined);
          const message = publicError(error);
          return html(installHtml(name, accounts, session.csrf, message), error instanceof CloudflareApiError ? error.status : 400);
        }
      }

      if (url.pathname === "/update" && request.method === "POST") {
        verifySameOrigin(request, baseUrl);
        const session = await requireSession(request, env);
        if (session.mode !== "update" || !session.workerUrl) throw new UserError("Цей сеанс не призначений для оновлення.");
        const form = await readForm(request);
        verifyCsrf(form, session);
        const accountId = formValue(form, "account_id");
        const accounts = await listAccounts(session.accessToken);
        if (!accounts.some((account) => account.id === accountId)) throw new UserError("Вибраний обліковий запис недоступний.");
        try {
          const target = parseWorkersDevUrl(session.workerUrl);
          const subdomain = await accountSubdomain(session.accessToken, accountId);
          if (!subdomain || subdomain !== target.subdomain) {
            throw new UserError("Цей воркер не належить вибраному обліковому запису Cloudflare.");
          }
          if (!(await scriptExists(session.accessToken, accountId, target.scriptName))) {
            throw new UserError("Воркер для оновлення не знайдено.");
          }
          const bindingNames = await scriptBindingNames(session.accessToken, accountId, target.scriptName);
          if (!bindingNames.includes("OAUTH_DB") || !bindingNames.includes("MCP_SHARED_SECRET")) {
            throw new UserError("Це не схоже на безпечне встановлення OneAIWorkers. Код не змінено.");
          }
          await updateWorker({
            token: session.accessToken,
            accountId,
            scriptName: target.scriptName,
            bindingNames,
            code: ONEAIWORKERS_CODE,
            version: ONEAIWORKERS_VERSION,
          });
          await revokeToken(session.accessToken, env).catch(() => undefined);
          return html(updateSuccessHtml(name, session.workerUrl, ONEAIWORKERS_VERSION), 200, [clearCookie(SESSION_COOKIE)]);
        } catch (error) {
          return html(updateHtml(name, accounts, session.csrf, session.workerUrl, publicError(error)), error instanceof CloudflareApiError ? error.status : 400);
        }
      }

      if (url.pathname === "/logout" && request.method === "POST") {
        verifySameOrigin(request, baseUrl);
        const session = await requireSession(request, env);
        const form = await readForm(request);
        verifyCsrf(form, session);
        await revokeToken(session.accessToken, env).catch(() => undefined);
        return redirect("/", [clearCookie(SESSION_COOKIE), clearCookie(STATE_COOKIE)]);
      }

      if (url.pathname === "/robots.txt" && request.method === "GET") {
        return new Response("User-agent: *\nDisallow: /\n", { headers: responseHeaders("text/plain; charset=utf-8") });
      }

      return html(errorHtml(name, "Сторінку не знайдено."), 404);
    } catch (error) {
      const name = env.INSTALLER_NAME?.trim() || "OneAIWorkers";
      return html(errorHtml(name, publicError(error)), error instanceof UserError ? 400 : 500);
    }
  },
};

async function beginOAuth(
  env: InstallerEnv,
  baseUrl: string,
  context: Pick<OAuthState, "mode" | "workerUrl">,
): Promise<Response> {
  const state: OAuthState = {
    nonce: randomToken(),
    exp: nowSeconds() + STATE_TTL_SECONDS,
    mode: context.mode,
    workerUrl: context.workerUrl,
  };
  const sealedState = await seal(state, required(env.INSTALLER_SESSION_SECRET));
  const authorizationUrl = new URL("https://dash.cloudflare.com/oauth2/auth");
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", required(env.CF_OAUTH_CLIENT_ID));
  authorizationUrl.searchParams.set("redirect_uri", `${baseUrl}/oauth/callback`);
  authorizationUrl.searchParams.set("state", state.nonce);
  const scopes = env.CF_OAUTH_SCOPES?.trim();
  if (scopes) authorizationUrl.searchParams.set("scope", scopes);
  return redirect(authorizationUrl.toString(), [secureCookie(STATE_COOKIE, sealedState, STATE_TTL_SECONDS)]);
}

async function readSession(request: Request, env: InstallerEnv): Promise<InstallerSession | null> {
  const value = readCookie(request, SESSION_COOKIE);
  if (!value) return null;
  const session = await unseal<InstallerSession>(value, required(env.INSTALLER_SESSION_SECRET));
  if (!session || session.exp <= nowSeconds() || !session.accessToken || !session.csrf) return null;
  return session;
}

async function requireSession(request: Request, env: InstallerEnv): Promise<InstallerSession> {
  const session = await readSession(request, env);
  if (!session) throw new UserError("Час доступу минув. Увійдіть у Cloudflare ще раз.");
  return session;
}

async function readState(request: Request, env: InstallerEnv): Promise<OAuthState | null> {
  const value = readCookie(request, STATE_COOKIE);
  if (!value) return null;
  const state = await unseal<OAuthState>(value, required(env.INSTALLER_SESSION_SECRET));
  return state && state.exp > nowSeconds() && state.nonce ? state : null;
}

async function exchangeCode(code: string, baseUrl: string, env: InstallerEnv): Promise<string> {
  const clientId = required(env.CF_OAUTH_CLIENT_ID);
  const clientSecret = required(env.CF_OAUTH_CLIENT_SECRET);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${baseUrl}/oauth/callback`,
  });
  const response = await fetch("https://dash.cloudflare.com/oauth2/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
    redirect: "error",
  });
  const payload: TokenResponse = await response.json<TokenResponse>().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new UserError("Cloudflare не завершив вхід. Перевірте налаштування дозволів встановлювача.");
  return payload.access_token;
}

async function revokeToken(token: string, env: InstallerEnv): Promise<void> {
  const clientId = required(env.CF_OAUTH_CLIENT_ID);
  const clientSecret = required(env.CF_OAUTH_CLIENT_SECRET);
  await fetch("https://dash.cloudflare.com/oauth2/revoke", {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token }),
    redirect: "error",
  });
}

async function ensureAccountSubdomain(token: string, accountId: string): Promise<string> {
  const existing = await accountSubdomain(token, accountId);
  if (existing) return existing;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await createAccountSubdomain(token, accountId, `oneai-${randomHex(5)}`);
    } catch (error) {
      lastError = error;
      if (!(error instanceof CloudflareApiError) || error.status !== 409) throw error;
    }
  }
  throw lastError || new UserError("Не вдалося створити адресу workers.dev.");
}

async function readForm(request: Request): Promise<FormData> {
  const length = Number(request.headers.get("content-length") || "0");
  if (length > MAX_FORM_BYTES) throw new UserError("Форма завелика.");
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("application/x-www-form-urlencoded") && !contentType.startsWith("multipart/form-data")) {
    throw new UserError("Неправильний тип форми.");
  }
  return request.formData();
}

function verifyCsrf(form: FormData, session: InstallerSession): void {
  if (formValue(form, "csrf") !== session.csrf) throw new UserError("Сеанс форми недійсний. Оновіть сторінку.");
}

function verifySameOrigin(request: Request, baseUrl: string): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(baseUrl).origin) throw new UserError("Запит надійшов з іншого сайту.");
}

function normalizeScriptName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u.test(normalized)) {
    throw new UserError("Назва воркера має містити 3–63 малі латинські літери, цифри або дефіси.");
  }
  return normalized;
}

function normalizeWorkerUrl(value: string): string {
  const parsed = parseWorkersDevUrl(value);
  return `https://${parsed.scriptName}.${parsed.subdomain}.workers.dev`;
}

function parseWorkersDevUrl(value: string): { scriptName: string; subdomain: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UserError("Неправильна адреса воркера для оновлення.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new UserError("Для оновлення потрібна чиста HTTPS-адреса воркера без додаткового шляху.");
  }
  const parts = url.hostname.toLowerCase().split(".");
  if (parts.length !== 4 || parts[2] !== "workers" || parts[3] !== "dev") {
    throw new UserError("Автоматичне оновлення зараз підтримує лише адресу workers.dev.");
  }
  const scriptName = normalizeScriptName(parts[0]);
  const subdomain = parts[1];
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(subdomain)) throw new UserError("Неправильна адреса workers.dev.");
  return { scriptName, subdomain };
}

function databaseName(scriptName: string): string {
  return `oneai-${scriptName.slice(0, 32)}-${randomHex(4)}`;
}

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function installerBaseUrl(request: Request, env: InstallerEnv): string {
  const configured = env.PUBLIC_BASE_URL?.trim();
  const url = new URL(configured || request.url);
  if (url.pathname !== "/" || url.search || url.hash) throw new UserError("PUBLIC_BASE_URL має містити лише початок адреси без шляху.");
  return url.origin;
}

function configurationError(env: InstallerEnv, baseUrl: string): string | null {
  if (!env.CF_OAUTH_CLIENT_ID?.trim()) return "Встановлювач ще не налаштований: бракує CF_OAUTH_CLIENT_ID.";
  if (!env.CF_OAUTH_CLIENT_SECRET?.trim()) return "Встановлювач ще не налаштований: бракує CF_OAUTH_CLIENT_SECRET.";
  if (!env.INSTALLER_SESSION_SECRET || env.INSTALLER_SESSION_SECRET.length < 32) {
    return "Встановлювач ще не налаштований: INSTALLER_SESSION_SECRET має містити щонайменше 32 знаки.";
  }
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    return "Сторінка встановлення має працювати через HTTPS.";
  }
  return null;
}

function formValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function required(value?: string): string {
  if (!value) throw new UserError("Встановлювач ще не налаштований.");
  return value;
}

function publicError(error: unknown): string {
  if (error instanceof UserError || error instanceof CloudflareApiError) return error.message.slice(0, 500);
  return "Сталася внутрішня помилка. Спробуйте ще раз пізніше.";
}

function html(body: string, status = 200, cookies: string[] = []): Response {
  const headers = responseHeaders("text/html; charset=utf-8");
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(body, { status, headers });
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: responseHeaders("application/json; charset=utf-8") });
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = responseHeaders("text/plain; charset=utf-8");
  headers.set("location", location);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function responseHeaders(contentType: string): Headers {
  return new Headers({
    "content-type": contentType,
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  });
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

class UserError extends Error {}
