import { constantTimeEqual } from "./security";
import type { Env } from "./types";

const OAUTH_SCOPE = "mcp";
const OFFLINE_SCOPE = "offline_access";
const ALLOWED_SCOPES = new Set([OAUTH_SCOPE, OFFLINE_SCOPE]);
const AUTH_CODE_TTL_SECONDS = 10 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;
const AUTH_FAILURE_LIMIT = 5;
const AUTH_FAILURE_WINDOW_SECONDS = 15 * 60;
const MAX_OAUTH_BODY_BYTES = 32 * 1024;

let schemaReady: Promise<void> | null = null;

interface OAuthClientRow {
  client_id: string;
  redirect_uris: string;
}

interface OAuthCodeRow {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
  scope: string;
  expires_at: number;
}

interface OAuthTokenRow {
  token: string;
  resource: string | null;
  scope: string | null;
  expires_at: number;
}

interface OAuthRefreshTokenRow {
  token_hash: string;
  client_id: string;
  resource: string | null;
  scope: string;
  expires_at: number;
}

interface OAuthRateLimitRow {
  failures: number;
  blocked_until: number;
  updated_at: number;
}

export function isOAuthEnabled(env: Env): boolean {
  return Boolean(env.OAUTH_DB);
}

export async function ensureOAuthSchema(env: Env): Promise<void> {
  if (!env.OAUTH_DB) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS oauth_clients (
          client_id TEXT PRIMARY KEY,
          client_name TEXT,
          redirect_uris TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS oauth_codes (
          code TEXT PRIMARY KEY,
          client_id TEXT NOT NULL,
          redirect_uri TEXT NOT NULL,
          code_challenge TEXT NOT NULL,
          code_challenge_method TEXT NOT NULL,
          resource TEXT NOT NULL,
          scope TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS oauth_tokens (
          token TEXT PRIMARY KEY,
          client_id TEXT NOT NULL,
          resource TEXT,
          scope TEXT,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
          token_hash TEXT PRIMARY KEY,
          client_id TEXT NOT NULL,
          resource TEXT,
          scope TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS oauth_rate_limits (
          key TEXT PRIMARY KEY,
          failures INTEGER NOT NULL,
          blocked_until INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires_at ON oauth_codes(expires_at)`,
        `CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires_at ON oauth_tokens(expires_at)`,
        `CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_expires_at ON oauth_refresh_tokens(expires_at)`,
      ];
      await env.OAUTH_DB!.batch(statements.map((sql) => env.OAUTH_DB!.prepare(sql)));
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export function oauthMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    revocation_endpoint: `${baseUrl}/oauth/revoke`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [OAUTH_SCOPE, OFFLINE_SCOPE],
  };
}

export function protectedResourceMetadata(baseUrl: string) {
  return {
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
  };
}

export async function handleOAuthRegister(request: Request, env: Env): Promise<Response> {
  if (!env.OAUTH_DB) return oauthJsonError("server_error", "OAuth storage is not configured.", 500);
  await ensureOAuthSchema(env);

  const body = await readBody(request);
  if (!body) return oauthJsonError("invalid_request", "OAuth request body is too large.", 413);

  const redirectUris = [...new Set(stringArray(body.redirect_uris))];
  if (redirectUris.length === 0 || redirectUris.length > 10 || redirectUris.some((uri) => !isRedirectUriSafe(uri))) {
    return oauthJsonError("invalid_redirect_uri", "Provide 1-10 safe redirect_uris.", 400);
  }
  if (!onlySupportedValues(body.grant_types, ["authorization_code", "refresh_token"])) {
    return oauthJsonError("invalid_client_metadata", "Unsupported grant_types.", 400);
  }
  if (!onlySupportedValues(body.response_types, ["code"])) {
    return oauthJsonError("invalid_client_metadata", "Unsupported response_types.", 400);
  }
  const authMethod = stringValue(body.token_endpoint_auth_method);
  if (authMethod && authMethod !== "none") {
    return oauthJsonError("invalid_client_metadata", "Only public OAuth clients are supported.", 400);
  }

  const clientName = stringValue(body.client_name || body.software_id || "MCP Client").slice(0, 200);
  const clientId = `oneaiworkers-client-${crypto.randomUUID()}`;
  await env.OAUTH_DB.prepare(
    "INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)",
  ).bind(clientId, clientName, JSON.stringify(redirectUris), nowSeconds()).run();

  return jsonResponse({
    client_id: clientId,
    client_id_issued_at: nowSeconds(),
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: `${OAUTH_SCOPE} ${OFFLINE_SCOPE}`,
  }, 201);
}

export async function handleOAuthAuthorize(request: Request, env: Env, baseUrl: string): Promise<Response> {
  if (!env.OAUTH_DB) return oauthError("OAuth storage is not configured.", 500);
  await ensureOAuthSchema(env);

  const url = new URL(request.url);
  const responseType = stringValue(url.searchParams.get("response_type"));
  const clientId = stringValue(url.searchParams.get("client_id"));
  const redirectUri = stringValue(url.searchParams.get("redirect_uri"));
  const state = stringValue(url.searchParams.get("state"));
  const codeChallenge = stringValue(url.searchParams.get("code_challenge"));
  const codeChallengeMethod = stringValue(url.searchParams.get("code_challenge_method"));
  const expectedResource = `${baseUrl}/mcp`;
  const resource = stringValue(url.searchParams.get("resource"));
  const scope = normalizeScope(url.searchParams.get("scope"), OAUTH_SCOPE);

  if (responseType !== "code") return oauthError("Only response_type=code is supported.", 400);
  if (!clientId || !redirectUri) return oauthError("Missing client_id or redirect_uri.", 400);
  if (!isRedirectUriSafe(redirectUri)) return oauthError("Invalid redirect_uri.", 400);
  if (!scope) return oauthError("Unsupported scope.", 400);
  if (resource !== expectedResource) return oauthError("Invalid resource.", 400);
  if (codeChallengeMethod.toUpperCase() !== "S256" || !isValidPkceChallenge(codeChallenge)) {
    return oauthError("PKCE with S256 is required.", 400);
  }

  const client = await getClient(env, clientId);
  if (!client) return oauthError("Unknown client_id.", 401);
  if (!isRedirectUriAllowed(client, redirectUri)) return oauthError("redirect_uri is not allowed.", 400);

  if (!env.MCP_SHARED_SECRET) {
    return oauthError("MCP_SHARED_SECRET is required. Add it as a Cloudflare Worker secret.", 503);
  }

  if (request.method === "GET") {
    return new Response(authorizeHtml(url), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const retryAfter = await oauthRetryAfter(request, env, clientId);
  if (retryAfter > 0) {
    return oauthJsonError("temporarily_blocked", "Too many authentication failures.", 429, {
      "retry-after": String(retryAfter),
    });
  }

  const body = await readBody(request);
  if (!body) return oauthJsonError("invalid_request", "OAuth request body is too large.", 413);
  const providedSecret = stringValue(body.secret);
  if (!(await constantTimeEqual(providedSecret, env.MCP_SHARED_SECRET))) {
    await recordOAuthFailure(request, env, clientId);
    return new Response(authorizeHtml(url, true), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  await clearOAuthFailures(request, env, clientId);
  const code = `oneaiworkers-code-${randomToken()}`;
  await env.OAUTH_DB.prepare(
    `INSERT INTO oauth_codes
      (code, client_id, redirect_uri, code_challenge, code_challenge_method, resource, scope, expires_at, created_at)
      VALUES (?, ?, ?, ?, 'S256', ?, ?, ?, ?)`,
  ).bind(
    code,
    clientId,
    redirectUri,
    codeChallenge,
    resource,
    scope,
    nowSeconds() + AUTH_CODE_TTL_SECONDS,
    nowSeconds(),
  ).run();

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);
  return Response.redirect(redirect.toString(), 302);
}

export async function handleOAuthToken(request: Request, env: Env): Promise<Response> {
  if (!env.OAUTH_DB) return oauthJsonError("server_error", "OAuth storage is not configured.", 500);
  await ensureOAuthSchema(env);

  const body = await readBody(request);
  if (!body) return oauthJsonError("invalid_request", "OAuth request body is too large.", 413);
  const grantType = stringValue(body.grant_type);
  const clientId = stringValue(body.client_id);

  if (!clientId) return oauthJsonError("invalid_request", "Missing client_id.", 400);
  const retryAfter = await oauthRetryAfter(request, env, clientId);
  if (retryAfter > 0) {
    return oauthJsonError("temporarily_blocked", "Too many authentication failures.", 429, {
      "retry-after": String(retryAfter),
    });
  }

  if (grantType === "authorization_code") {
    return exchangeAuthorizationCode(request, env, body, clientId);
  }
  if (grantType === "refresh_token") {
    return rotateRefreshToken(request, env, body, clientId);
  }
  return oauthJsonError("unsupported_grant_type", "Unsupported grant_type.", 400);
}

export async function handleOAuthRevoke(request: Request, env: Env): Promise<Response> {
  if (!env.OAUTH_DB) return oauthJsonError("server_error", "OAuth storage is not configured.", 500);
  await ensureOAuthSchema(env);

  const body = await readBody(request);
  if (!body) return oauthJsonError("invalid_request", "OAuth request body is too large.", 413);
  const token = stringValue(body.token);
  if (token) {
    const storedToken = await tokenStorageKey(token);
    await env.OAUTH_DB.batch([
      env.OAUTH_DB.prepare("DELETE FROM oauth_tokens WHERE token = ?").bind(storedToken),
      env.OAUTH_DB.prepare("DELETE FROM oauth_refresh_tokens WHERE token_hash = ?").bind(storedToken),
    ]);
  }
  return new Response(null, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

export async function isValidOAuthAccessToken(
  token: string,
  env: Env,
  expectedResource?: string,
): Promise<boolean> {
  if (!token || !env.OAUTH_DB) return false;
  await ensureOAuthSchema(env);
  const storedToken = await tokenStorageKey(token);
  const row = await env.OAUTH_DB.prepare(
    "SELECT token, resource, scope, expires_at FROM oauth_tokens WHERE token = ? LIMIT 1",
  ).bind(storedToken).first<OAuthTokenRow>();
  if (!row) return false;
  if (row.expires_at <= nowSeconds()) {
    await env.OAUTH_DB.prepare("DELETE FROM oauth_tokens WHERE token = ?").bind(row.token).run();
    return false;
  }
  if (expectedResource && row.resource !== expectedResource) return false;
  return scopeIncludes(row.scope || "", OAUTH_SCOPE);
}

export function oauthUnauthorizedHeaders(request: Request, env: Env): Record<string, string> {
  if (!isOAuthEnabled(env)) return {};
  const baseUrl = (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
  return {
    "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", scope="${OAUTH_SCOPE}"`,
    "access-control-expose-headers": "WWW-Authenticate",
  };
}

async function exchangeAuthorizationCode(
  request: Request,
  env: Env,
  body: Record<string, unknown>,
  clientId: string,
): Promise<Response> {
  const code = stringValue(body.code);
  const redirectUri = stringValue(body.redirect_uri);
  const codeVerifier = stringValue(body.code_verifier);
  const resource = stringValue(body.resource);
  if (!code || !redirectUri || !resource || !isValidPkceVerifier(codeVerifier)) {
    return oauthJsonError("invalid_request", "Missing or invalid code, redirect_uri, resource, or code_verifier.", 400);
  }

  const row = await env.OAUTH_DB!.prepare(
    "SELECT * FROM oauth_codes WHERE code = ?",
  ).bind(code).first<OAuthCodeRow>();
  if (
    !row ||
    row.expires_at <= nowSeconds() ||
    !(await constantTimeEqual(row.client_id, clientId)) ||
    row.redirect_uri !== redirectUri ||
    row.resource !== resource ||
    !(await isPkceValid(row, codeVerifier))
  ) {
    await recordOAuthFailure(request, env, clientId);
    return oauthJsonError("invalid_grant", "Authorization code is invalid or expired.", 401);
  }

  const now = nowSeconds();
  const accessToken = `oneaiworkers-access-${randomToken()}`;
  const accessTokenHash = await tokenStorageKey(accessToken);
  const wantsRefresh = scopeIncludes(row.scope, OFFLINE_SCOPE);
  const refreshToken = wantsRefresh ? `oneaiworkers-refresh-${randomToken()}` : null;
  const statements = [
    env.OAUTH_DB!.prepare(
      `INSERT INTO oauth_tokens (token, client_id, resource, scope, expires_at, created_at)
       SELECT ?, client_id, resource, scope, ?, ? FROM oauth_codes
       WHERE code = ? AND client_id = ? AND redirect_uri = ? AND resource = ? AND expires_at > ?`,
    ).bind(accessTokenHash, now + ACCESS_TOKEN_TTL_SECONDS, now, code, clientId, redirectUri, resource, now),
  ];
  if (refreshToken) {
    statements.push(
      env.OAUTH_DB!.prepare(
        `INSERT INTO oauth_refresh_tokens (token_hash, client_id, resource, scope, expires_at, created_at)
         SELECT ?, client_id, resource, scope, ?, ? FROM oauth_codes
         WHERE code = ? AND client_id = ? AND redirect_uri = ? AND resource = ? AND expires_at > ?`,
      ).bind(
        await tokenStorageKey(refreshToken),
        now + REFRESH_TOKEN_TTL_SECONDS,
        now,
        code,
        clientId,
        redirectUri,
        resource,
        now,
      ),
    );
  }
  statements.push(
    env.OAUTH_DB!.prepare(
      "DELETE FROM oauth_codes WHERE code = ? AND client_id = ? AND redirect_uri = ? AND resource = ? AND expires_at > ?",
    ).bind(code, clientId, redirectUri, resource, now),
  );

  const results = await env.OAUTH_DB!.batch(statements);
  if (resultChanges(results[0]) !== 1) {
    await recordOAuthFailure(request, env, clientId);
    return oauthJsonError("invalid_grant", "Authorization code was already used.", 401);
  }

  await clearOAuthFailures(request, env, clientId);
  return jsonResponse({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    ...(refreshToken
      ? {
          refresh_token: refreshToken,
          refresh_token_expires_in: REFRESH_TOKEN_TTL_SECONDS,
        }
      : {}),
    scope: row.scope,
  });
}

async function rotateRefreshToken(
  request: Request,
  env: Env,
  body: Record<string, unknown>,
  clientId: string,
): Promise<Response> {
  const refreshToken = stringValue(body.refresh_token);
  const resource = stringValue(body.resource);
  if (!refreshToken || !resource) return oauthJsonError("invalid_request", "Missing refresh_token or resource.", 400);

  const oldTokenHash = await tokenStorageKey(refreshToken);
  const row = await env.OAUTH_DB!.prepare(
    "SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?",
  ).bind(oldTokenHash).first<OAuthRefreshTokenRow>();
  const requestedScope = normalizeScope(
    Object.prototype.hasOwnProperty.call(body, "scope") ? stringValue(body.scope) : row?.scope,
    row?.scope || OAUTH_SCOPE,
  );
  if (
    !row ||
    row.expires_at <= nowSeconds() ||
    !(await constantTimeEqual(row.client_id, clientId)) ||
    row.resource !== resource ||
    !requestedScope ||
    !isScopeSubset(requestedScope, row.scope)
  ) {
    await recordOAuthFailure(request, env, clientId);
    return oauthJsonError("invalid_grant", "Refresh token is invalid, expired, already used, or has an invalid scope.", 401);
  }

  const now = nowSeconds();
  const accessToken = `oneaiworkers-access-${randomToken()}`;
  const nextRefreshToken = `oneaiworkers-refresh-${randomToken()}`;
  const results = await env.OAUTH_DB!.batch([
    env.OAUTH_DB!.prepare(
      `INSERT INTO oauth_tokens (token, client_id, resource, scope, expires_at, created_at)
       SELECT ?, client_id, resource, ?, ?, ? FROM oauth_refresh_tokens
       WHERE token_hash = ? AND client_id = ? AND expires_at > ?`,
    ).bind(
      await tokenStorageKey(accessToken),
      requestedScope,
      now + ACCESS_TOKEN_TTL_SECONDS,
      now,
      oldTokenHash,
      clientId,
      now,
    ),
    env.OAUTH_DB!.prepare(
      `INSERT INTO oauth_refresh_tokens (token_hash, client_id, resource, scope, expires_at, created_at)
       SELECT ?, client_id, resource, ?, ?, ? FROM oauth_refresh_tokens
       WHERE token_hash = ? AND client_id = ? AND expires_at > ?`,
    ).bind(
      await tokenStorageKey(nextRefreshToken),
      requestedScope,
      now + REFRESH_TOKEN_TTL_SECONDS,
      now,
      oldTokenHash,
      clientId,
      now,
    ),
    env.OAUTH_DB!.prepare(
      "DELETE FROM oauth_refresh_tokens WHERE token_hash = ? AND client_id = ? AND expires_at > ?",
    ).bind(oldTokenHash, clientId, now),
  ]);

  if (resultChanges(results[0]) !== 1) {
    await recordOAuthFailure(request, env, clientId);
    return oauthJsonError("invalid_grant", "Refresh token was already used.", 401);
  }

  await clearOAuthFailures(request, env, clientId);
  return jsonResponse({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: nextRefreshToken,
    refresh_token_expires_in: REFRESH_TOKEN_TTL_SECONDS,
    scope: requestedScope,
  });
}

async function getClient(env: Env, clientId: string): Promise<OAuthClientRow | null> {
  return env.OAUTH_DB!.prepare(
    "SELECT client_id, redirect_uris FROM oauth_clients WHERE client_id = ?",
  ).bind(clientId).first<OAuthClientRow>();
}

function isRedirectUriAllowed(client: OAuthClientRow, redirectUri: string): boolean {
  return parseJsonArray(client.redirect_uris).includes(redirectUri);
}

function isRedirectUriSafe(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function authorizeHtml(url: URL, invalidSecret = false): string {
  const hidden = Array.from(url.searchParams.entries())
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect OneAIWorkers</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px; background: #0b1220; color: #eef4ff; }
    main { max-width: 520px; margin: 0 auto; padding: 24px; background: #121b2b; border: 1px solid #263248; border-radius: 16px; }
    label { display: block; margin: 16px 0 8px; font-weight: 600; }
    input[type=password] { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 10px; border: 1px solid #3b4a66; background: #0b1220; color: #eef4ff; }
    button { margin-top: 16px; padding: 12px 16px; border: 0; border-radius: 10px; background: #7cdaff; color: #07111f; font-weight: 700; cursor: pointer; }
    .error { color: #ff9a9a; }
    .muted { color: #aebbd0; }
  </style>
</head>
<body>
  <main>
    <h1>Connect OneAIWorkers</h1>
    <p class="muted">Enter your OneAIWorkers shared secret to allow this MCP client to connect.</p>
    ${invalidSecret ? `<p class="error">Wrong secret. Try again.</p>` : ""}
    <form method="post">
      ${hidden}
      <label for="secret">Shared secret</label>
      <input id="secret" name="secret" type="password" autocomplete="current-password" autofocus />
      <button type="submit">Connect</button>
    </form>
  </main>
</body>
</html>`;
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_OAUTH_BODY_BYTES) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_OAUTH_BODY_BYTES) return null;
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const value: unknown = JSON.parse(text || "{}");
      return isRecord(value) ? value : {};
    } catch {
      return {};
    }
  }
  const params = new URLSearchParams(text);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) result[key] = value;
  return result;
}

async function oauthRetryAfter(request: Request, env: Env, clientId: string): Promise<number> {
  const key = await rateLimitKey(request, clientId);
  const row = await env.OAUTH_DB!.prepare(
    "SELECT failures, blocked_until, updated_at FROM oauth_rate_limits WHERE key = ?",
  ).bind(key).first<OAuthRateLimitRow>();
  if (!row || row.blocked_until <= nowSeconds()) return 0;
  return Math.max(1, row.blocked_until - nowSeconds());
}

async function recordOAuthFailure(request: Request, env: Env, clientId: string): Promise<void> {
  const now = nowSeconds();
  const key = await rateLimitKey(request, clientId);
  const row = await env.OAUTH_DB!.prepare(
    "SELECT failures, blocked_until, updated_at FROM oauth_rate_limits WHERE key = ?",
  ).bind(key).first<OAuthRateLimitRow>();
  const previousFailures = row && now - row.updated_at <= AUTH_FAILURE_WINDOW_SECONDS ? row.failures : 0;
  const failures = previousFailures + 1;
  const blockedUntil = failures >= AUTH_FAILURE_LIMIT ? now + AUTH_FAILURE_WINDOW_SECONDS : 0;
  await env.OAUTH_DB!.prepare(
    `INSERT INTO oauth_rate_limits (key, failures, blocked_until, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       failures = excluded.failures,
       blocked_until = excluded.blocked_until,
       updated_at = excluded.updated_at`,
  ).bind(key, failures, blockedUntil, now).run();
}

async function clearOAuthFailures(request: Request, env: Env, clientId: string): Promise<void> {
  const key = await rateLimitKey(request, clientId);
  await env.OAUTH_DB!.prepare("DELETE FROM oauth_rate_limits WHERE key = ?").bind(key).run();
}

async function rateLimitKey(request: Request, clientId: string): Promise<string> {
  const address = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  return tokenStorageKey(`${clientId}\n${address.split(",")[0].trim()}`);
}

function normalizeScope(value: unknown, fallback: string): string | null {
  const input = stringValue(value) || fallback;
  const scopes = [...new Set(input.split(/\s+/).filter(Boolean))];
  if (scopes.length === 0 || !scopes.includes(OAUTH_SCOPE) || scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) {
    return null;
  }
  return scopes.join(" ");
}

function isScopeSubset(requested: string, granted: string): boolean {
  const grantedScopes = new Set(granted.split(/\s+/).filter(Boolean));
  return requested.split(/\s+/).filter(Boolean).every((scope) => grantedScopes.has(scope));
}

function scopeIncludes(scope: string, expected: string): boolean {
  return scope.split(/\s+/).includes(expected);
}

function isValidPkceChallenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

function isValidPkceVerifier(value: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(value);
}

async function isPkceValid(row: OAuthCodeRow, verifier: string): Promise<boolean> {
  if (row.code_challenge_method !== "S256") return false;
  return constantTimeEqual(await sha256Base64Url(verifier), row.code_challenge);
}

async function tokenStorageKey(value: string): Promise<string> {
  return `sha256:${await sha256Base64Url(value)}`;
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64Url(new Uint8Array(digest));
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function onlySupportedValues(value: unknown, supported: string[]): boolean {
  if (value === undefined) return true;
  const values = stringArray(value);
  return values.length > 0 && values.every((item) => supported.includes(item));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return stringArray(parsed);
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resultChanges(result: D1Result): number {
  return Number((result.meta as { changes?: number }).changes || 0);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function jsonResponse(
  payload: unknown,
  status = 200,
  additionalHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      ...additionalHeaders,
    },
  });
}

function oauthError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function oauthJsonError(
  error: string,
  description: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse({ error, error_description: description }, status, headers);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
