import type { Env } from "./types";

const OAUTH_SCOPE = "mcp";
const AUTH_CODE_TTL_SECONDS = 10 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;

let schemaReady: Promise<void> | null = null;

interface OAuthClientRow {
  client_id: string;
  redirect_uris: string;
}

interface OAuthCodeRow {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string | null;
  code_challenge_method: string | null;
  resource: string | null;
  scope: string | null;
  expires_at: number;
}

interface OAuthTokenRow {
  token: string;
  expires_at: number;
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
          code_challenge TEXT,
          code_challenge_method TEXT,
          resource TEXT,
          scope TEXT,
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
        `CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires_at ON oauth_codes(expires_at)`,
        `CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires_at ON oauth_tokens(expires_at)`,
      ];
      for (const sql of statements) await env.OAUTH_DB!.prepare(sql).run();
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
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256", "plain"],
    scopes_supported: [OAUTH_SCOPE],
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
  if (!env.OAUTH_DB) return oauthError("OAuth storage is not configured.", 500);

  const body = await readBody(request);
  const redirectUris = stringArray(body.redirect_uris);
  const clientName = stringValue(body.client_name || body.software_id || "MCP Client");
  const clientId = `oneaiworkers-client-${crypto.randomUUID()}`;

  // Dynamic client registration should be resilient. If D1 schema creation or
  // insert fails transiently, /oauth/authorize can still create the client later
  // via getOrCreateClient using the returned client_id and redirect_uri.
  try {
    await ensureOAuthSchema(env);
    await env.OAUTH_DB.prepare(
      "INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)",
    ).bind(clientId, clientName, JSON.stringify(redirectUris), nowSeconds()).run();
  } catch {
    // Do not fail registration. The OAuth authorization step will retry schema
    // creation and create the client if needed.
  }

  return jsonResponse({
    client_id: clientId,
    client_id_issued_at: nowSeconds(),
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: OAUTH_SCOPE,
  }, 201);
}

export async function handleOAuthAuthorize(request: Request, env: Env, baseUrl: string): Promise<Response> {
  if (!env.OAUTH_DB) return oauthError("OAuth storage is not configured.", 500);
  await ensureOAuthSchema(env);

  const url = new URL(request.url);
  const clientId = stringValue(url.searchParams.get("client_id"));
  const redirectUri = stringValue(url.searchParams.get("redirect_uri"));
  const state = stringValue(url.searchParams.get("state"));
  const codeChallenge = stringValue(url.searchParams.get("code_challenge"));
  const codeChallengeMethod = stringValue(url.searchParams.get("code_challenge_method") || "plain");
  const resource = stringValue(url.searchParams.get("resource") || `${baseUrl}/mcp`);
  const scope = stringValue(url.searchParams.get("scope") || OAUTH_SCOPE);

  if (!clientId || !redirectUri) return oauthError("Missing client_id or redirect_uri.", 400);
  if (!isRedirectUriSafe(redirectUri)) return oauthError("Invalid redirect_uri.", 400);

  const client = await getOrCreateClient(env, clientId, redirectUri);
  if (!isRedirectUriAllowed(client, redirectUri)) return oauthError("redirect_uri is not allowed.", 400);

  if (!env.MCP_SHARED_SECRET) {
    return oauthError("MCP_SHARED_SECRET is required. Add it in Cloudflare Worker Settings → Variables and Secrets.", 503);
  }

  if (request.method === "GET") {
    return new Response(authorizeHtml(url), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const form = await request.formData();
  const providedSecret = String(form.get("secret") || "");
  if (providedSecret !== env.MCP_SHARED_SECRET) {
    return new Response(authorizeHtml(url, true), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const code = `oneaiworkers-code-${crypto.randomUUID()}`;
  await env.OAUTH_DB.prepare(
    `INSERT INTO oauth_codes
      (code, client_id, redirect_uri, code_challenge, code_challenge_method, resource, scope, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    code,
    clientId,
    redirectUri,
    codeChallenge || null,
    codeChallengeMethod || "plain",
    resource || `${baseUrl}/mcp`,
    scope || OAUTH_SCOPE,
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
  const grantType = stringValue(body.grant_type);
  if (grantType !== "authorization_code") {
    return oauthJsonError("unsupported_grant_type", "Only authorization_code is supported.", 400);
  }

  const code = stringValue(body.code);
  const clientId = stringValue(body.client_id);
  const redirectUri = stringValue(body.redirect_uri);
  const codeVerifier = stringValue(body.code_verifier);

  if (!code || !clientId || !redirectUri) {
    return oauthJsonError("invalid_request", "Missing code, client_id, or redirect_uri.", 400);
  }

  const row = await env.OAUTH_DB.prepare(
    "SELECT * FROM oauth_codes WHERE code = ?",
  ).bind(code).first<OAuthCodeRow>();

  if (!row || row.expires_at <= nowSeconds()) {
    return oauthJsonError("invalid_grant", "Authorization code is invalid or expired.", 401);
  }
  if (row.client_id !== clientId || row.redirect_uri !== redirectUri) {
    return oauthJsonError("invalid_grant", "Authorization code does not match this client.", 401);
  }
  if (!(await isPkceValid(row, codeVerifier))) {
    return oauthJsonError("invalid_grant", "PKCE verification failed.", 401);
  }

  await env.OAUTH_DB.prepare("DELETE FROM oauth_codes WHERE code = ?").bind(code).run();

  const token = `oneaiworkers-token-${randomToken()}`;
  await env.OAUTH_DB.prepare(
    `INSERT INTO oauth_tokens (token, client_id, resource, scope, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    token,
    clientId,
    row.resource || null,
    row.scope || OAUTH_SCOPE,
    nowSeconds() + ACCESS_TOKEN_TTL_SECONDS,
    nowSeconds(),
  ).run();

  return jsonResponse({
    access_token: token,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: row.scope || OAUTH_SCOPE,
  });
}

export async function isValidOAuthAccessToken(token: string, env: Env): Promise<boolean> {
  if (!token || !env.OAUTH_DB) return false;
  await ensureOAuthSchema(env);
  const row = await env.OAUTH_DB.prepare(
    "SELECT token, expires_at FROM oauth_tokens WHERE token = ?",
  ).bind(token).first<OAuthTokenRow>();
  if (!row) return false;
  if (row.expires_at <= nowSeconds()) {
    await env.OAUTH_DB.prepare("DELETE FROM oauth_tokens WHERE token = ?").bind(token).run();
    return false;
  }
  return true;
}

export function oauthUnauthorizedHeaders(request: Request, env: Env): Record<string, string> {
  if (!isOAuthEnabled(env)) return {};
  const baseUrl = (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
  return {
    "www-authenticate": `Bearer realm="mcp", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", scope="${OAUTH_SCOPE}"`,
    "access-control-expose-headers": "WWW-Authenticate",
  };
}

async function getOrCreateClient(env: Env, clientId: string, redirectUri: string): Promise<OAuthClientRow> {
  const found = await env.OAUTH_DB!.prepare(
    "SELECT client_id, redirect_uris FROM oauth_clients WHERE client_id = ?",
  ).bind(clientId).first<OAuthClientRow>();
  if (found) return found;

  const redirectUris = [redirectUri];
  await env.OAUTH_DB!.prepare(
    "INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)",
  ).bind(clientId, "MCP Client", JSON.stringify(redirectUris), nowSeconds()).run();

  return { client_id: clientId, redirect_uris: JSON.stringify(redirectUris) };
}

function isRedirectUriAllowed(client: OAuthClientRow, redirectUri: string): boolean {
  const allowed = parseJsonArray(client.redirect_uris);
  if (allowed.length === 0) return isRedirectUriSafe(redirectUri);
  return allowed.includes(redirectUri);
}

function isRedirectUriSafe(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return true;
    return false;
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

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const value = await request.json().catch(() => ({}));
    return isRecord(value) ? value : {};
  }
  const text = await request.text();
  const params = new URLSearchParams(text);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) result[key] = value;
  return result;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return stringArray(parsed);
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function isPkceValid(row: OAuthCodeRow, verifier: string): Promise<boolean> {
  const challenge = row.code_challenge || "";
  if (!challenge) return true;
  if (!verifier) return false;
  const method = (row.code_challenge_method || "plain").toUpperCase();
  if (method === "S256") return (await sha256Base64Url(verifier)) === challenge;
  return verifier === challenge;
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

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function oauthError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function oauthJsonError(error: string, description: string, status: number): Response {
  return jsonResponse({ error, error_description: description }, status);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
