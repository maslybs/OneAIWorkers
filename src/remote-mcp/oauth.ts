import { decryptJson, encryptJson, randomToken, sha256Base64Url } from "../crypto";
import { assertSafeOutboundUrl, fetchWithSafeRedirects, redactSensitiveText } from "../security";
import type { Env } from "../types";
import { loadCredentialProfile, storeCredentialProfile } from "../vault";
import type { ConnectorRow } from "../tools/connectors/types";

interface OAuthClientRow {
  connector_id: string;
  authorization_server: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string | null;
  client_id: string;
  client_auth_method: string;
  resource: string;
  scope: string | null;
  updated_at: number;
}

interface OAuthStatePayload {
  connectorId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string;
  scope: string | null;
  authorizationServer: string;
  requireIssuer: boolean;
}

interface ProtectedResourceMetadata {
  resource?: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
}

interface AuthorizationServerMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  client_id_metadata_document_supported?: boolean;
  authorization_response_iss_parameter_supported?: boolean;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

const STATE_TTL_SECONDS = 10 * 60;
const OAUTH_REFRESH_TOKEN_KEY = "remote_mcp_refresh_token";
const OAUTH_EXPIRES_AT_KEY = "remote_mcp_access_expires_at";
const OAUTH_TOKEN_TYPE_KEY = "remote_mcp_token_type";
const OAUTH_SCOPE_KEY = "remote_mcp_scope";
const OAUTH_CLIENT_SECRET_KEY = "remote_mcp_oauth_client_secret";

export async function ensureRemoteMcpOAuthSchema(env: Env): Promise<void> {
  const db = getDb(env);
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS remote_mcp_oauth_clients (
      connector_id TEXT PRIMARY KEY,
      authorization_server TEXT NOT NULL,
      authorization_endpoint TEXT NOT NULL,
      token_endpoint TEXT NOT NULL,
      registration_endpoint TEXT,
      client_id TEXT NOT NULL,
      client_auth_method TEXT NOT NULL DEFAULT 'none',
      resource TEXT NOT NULL,
      scope TEXT,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS remote_mcp_oauth_states (
      state_hash TEXT PRIMARY KEY,
      connector_id TEXT NOT NULL,
      encrypted_json TEXT NOT NULL,
      iv TEXT NOT NULL,
      encryption_version INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_remote_mcp_oauth_states_expiry ON remote_mcp_oauth_states(expires_at)",
  ]) await db.prepare(sql).run();
}

export async function resetRemoteMcpAuthState(
  env: Env,
  connectorId: string,
  tokenCredential?: string | null,
): Promise<void> {
  if (!env.OAUTH_DB || !env.CREDENTIALS_MASTER_KEY) return;
  await ensureRemoteMcpOAuthSchema(env);
  const user = await loadCredentialProfile(env, connectorId, "user");
  for (const key of [
    tokenCredential || "",
    OAUTH_REFRESH_TOKEN_KEY,
    OAUTH_EXPIRES_AT_KEY,
    OAUTH_TOKEN_TYPE_KEY,
    OAUTH_SCOPE_KEY,
  ]) {
    if (key) delete user[key];
  }
  await storeCredentialProfile(env, connectorId, "user", user);

  const system = await loadCredentialProfile(env, connectorId, "system");
  delete system[OAUTH_CLIENT_SECRET_KEY];
  await storeCredentialProfile(env, connectorId, "system", system);

  const db = getDb(env);
  await db.prepare("DELETE FROM remote_mcp_oauth_clients WHERE connector_id = ?").bind(connectorId).run();
  await db.prepare("DELETE FROM remote_mcp_oauth_states WHERE connector_id = ?").bind(connectorId).run();
}

export function remoteMcpClientMetadata(baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  const clientId = `${origin}/oauth/remote-mcp/client-metadata.json`;
  return {
    client_id: clientId,
    client_name: "OneAIWorkers",
    client_uri: origin,
    redirect_uris: [`${origin}/oauth/remote-mcp/callback`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web",
  };
}

export async function isRemoteMcpOAuthConnector(env: Env, connectorId: string): Promise<boolean> {
  if (!env.OAUTH_DB) return false;
  const connector = await loadConnector(env, connectorId);
  return connector?.mode === "remote_mcp" && connector.remote_mcp_auth_type === "oauth";
}

export async function beginRemoteMcpOAuth(env: Env, baseUrl: string, connectorId: string): Promise<string> {
  const connector = await requireOAuthConnector(env, connectorId);
  if (!env.CREDENTIALS_MASTER_KEY) throw new Error("CREDENTIALS_MASTER_KEY is required for remote MCP OAuth.");
  await ensureRemoteMcpOAuthSchema(env);

  const discovery = await discoverOAuth(connector.remote_mcp_url as string);
  const client = await getOrRegisterClient(env, connector, discovery, baseUrl);
  const redirectUri = `${new URL(baseUrl).origin}/oauth/remote-mcp/callback`;
  const state = randomToken(32);
  const stateHash = await sha256Base64Url(state);
  const codeVerifier = randomToken(48);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const payload: OAuthStatePayload = {
    connectorId: connector.connector_id,
    redirectUri,
    codeVerifier,
    resource: client.resource,
    scope: client.scope,
    authorizationServer: client.authorization_server,
    requireIssuer: discovery.requiresIssuerParameter,
  };
  const encrypted = await encryptJson(masterKey(env), payload, stateAssociatedData(stateHash));
  const now = nowSeconds();
  const db = getDb(env);
  await db.prepare("DELETE FROM remote_mcp_oauth_states WHERE expires_at < ?").bind(now).run();
  await db.prepare(
    `INSERT INTO remote_mcp_oauth_states
       (state_hash, connector_id, encrypted_json, iv, encryption_version, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(stateHash, connector.connector_id, encrypted.ciphertext, encrypted.iv, encrypted.version, now + STATE_TTL_SECONDS, now).run();

  const authorizationUrl = assertSafeOutboundUrl(client.authorization_endpoint);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", client.client_id);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("resource", client.resource);
  if (client.scope) authorizationUrl.searchParams.set("scope", client.scope);
  return authorizationUrl.toString();
}

export async function completeRemoteMcpOAuth(env: Env, callbackUrl: URL): Promise<{
  connectorId: string;
  accessTokenStored: boolean;
}> {
  if (!env.CREDENTIALS_MASTER_KEY) throw new Error("CREDENTIALS_MASTER_KEY is required for remote MCP OAuth.");
  await ensureRemoteMcpOAuthSchema(env);
  const state = callbackUrl.searchParams.get("state") || "";
  if (!state) throw new Error("OAuth state is missing.");
  const stateHash = await sha256Base64Url(state);
  const db = getDb(env);
  const row = await db.prepare(
    `SELECT connector_id, encrypted_json, iv, encryption_version, expires_at
     FROM remote_mcp_oauth_states WHERE state_hash = ?`,
  ).bind(stateHash).first<{
    connector_id: string;
    encrypted_json: string;
    iv: string;
    encryption_version: number;
    expires_at: number;
  }>();
  if (!row || row.expires_at < nowSeconds()) throw new Error("OAuth state is invalid or expired.");
  await db.prepare("DELETE FROM remote_mcp_oauth_states WHERE state_hash = ?").bind(stateHash).run();

  const payload = await decryptJson<OAuthStatePayload>(masterKey(env), {
    version: row.encryption_version as 1,
    iv: row.iv,
    ciphertext: row.encrypted_json,
  }, stateAssociatedData(stateHash));
  if (payload.connectorId !== row.connector_id) throw new Error("OAuth state connector mismatch.");
  const issuer = callbackUrl.searchParams.get("iss");
  if (payload.requireIssuer && !issuer) {
    throw new Error("OAuth authorization response is missing the required issuer parameter.");
  }
  if (issuer && !oauthIssuerMatches(issuer, payload.authorizationServer)) {
    throw new Error("OAuth authorization response issuer does not match the expected authorization server.");
  }
  const oauthError = callbackUrl.searchParams.get("error");
  if (oauthError) {
    const description = callbackUrl.searchParams.get("error_description") || oauthError;
    throw new Error(`OAuth authorization failed: ${description}`);
  }
  const code = callbackUrl.searchParams.get("code") || "";
  if (!code) throw new Error("OAuth authorization code is missing.");

  const connector = await requireOAuthConnector(env, payload.connectorId);
  const client = await loadOAuthClient(env, connector.connector_id);
  if (!client) throw new Error("OAuth client registration is missing. Start the connection again.");
  const token = await exchangeAuthorizationCode(env, connector, client, code, payload);
  await storeOAuthTokens(env, connector, token);
  return { connectorId: connector.connector_id, accessTokenStored: true };
}

export async function getRemoteMcpOAuthAccessToken(env: Env, connector: ConnectorRow): Promise<string> {
  if (connector.mode !== "remote_mcp" || connector.remote_mcp_auth_type !== "oauth") {
    throw new Error("Connector is not configured for remote MCP OAuth.");
  }
  const key = connector.remote_mcp_token_credential?.trim();
  if (!key) throw new Error("Remote MCP OAuth token credential key is missing.");
  const profile = await loadCredentialProfile(env, connector.connector_id, "user");
  const accessToken = profile[key]?.trim();
  const expiresAt = Number(profile[OAUTH_EXPIRES_AT_KEY] || 0);
  if (accessToken && (!expiresAt || expiresAt > nowSeconds() + 60)) return accessToken;

  const refreshToken = profile[OAUTH_REFRESH_TOKEN_KEY]?.trim();
  if (!refreshToken) {
    throw new Error("Remote MCP OAuth connection is missing or expired. Open plugin settings and connect the account again.");
  }
  const client = await loadOAuthClient(env, connector.connector_id);
  if (!client) throw new Error("Remote MCP OAuth client registration is missing. Reconnect the account.");
  const refreshed = await refreshAccessToken(env, connector, client, refreshToken);
  await storeOAuthTokens(env, connector, refreshed, profile);
  const updated = await loadCredentialProfile(env, connector.connector_id, "user");
  const token = updated[key]?.trim();
  if (!token) throw new Error("Remote MCP OAuth refresh did not return an access token.");
  return token;
}

async function discoverOAuth(serverUrl: string): Promise<{
  authorizationServer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
  resource: string;
  scope: string | null;
  clientAuthMethods: string[];
  supportsClientIdMetadataDocument: boolean;
  requiresIssuerParameter: boolean;
}> {
  const endpoint = assertSafeOutboundUrl(serverUrl);
  const challenge = await probeAuthorizationChallenge(endpoint);
  const resourceMetadata = await discoverProtectedResourceMetadata(endpoint, challenge.resourceMetadataUrl);
  const authorizationServer = resourceMetadata?.authorization_servers?.[0] || endpoint.origin;
  const authMetadata = await discoverAuthorizationServerMetadata(authorizationServer);
  if (!authMetadata.authorization_endpoint || !authMetadata.token_endpoint) {
    throw new Error("Remote MCP authorization server metadata is missing authorization_endpoint or token_endpoint.");
  }
  if (Array.isArray(authMetadata.code_challenge_methods_supported) &&
      !authMetadata.code_challenge_methods_supported.includes("S256")) {
    throw new Error("Remote MCP authorization server does not advertise PKCE S256 support.");
  }
  const scope = challenge.scope || null;
  return {
    authorizationServer,
    authorizationEndpoint: assertSafeOutboundUrl(authMetadata.authorization_endpoint).toString(),
    tokenEndpoint: assertSafeOutboundUrl(authMetadata.token_endpoint).toString(),
    registrationEndpoint: authMetadata.registration_endpoint
      ? assertSafeOutboundUrl(authMetadata.registration_endpoint).toString()
      : null,
    resource: typeof resourceMetadata?.resource === "string" && resourceMetadata.resource
      ? resourceMetadata.resource
      : endpoint.toString(),
    scope,
    clientAuthMethods: Array.isArray(authMetadata.token_endpoint_auth_methods_supported)
      ? authMetadata.token_endpoint_auth_methods_supported.filter((value): value is string => typeof value === "string")
      : ["none"],
    supportsClientIdMetadataDocument: authMetadata.client_id_metadata_document_supported === true,
    requiresIssuerParameter: authMetadata.authorization_response_iss_parameter_supported === true,
  };
}

async function probeAuthorizationChallenge(endpoint: URL): Promise<{ resourceMetadataUrl: string | null; scope: string | null }> {
  const modern = await probeAuthorizationChallengeRequest(endpoint, "server/discover", {
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "OneAIWorkers", version: "remote-mcp-oauth-discovery" },
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  }, "2026-07-28");
  if (modern.resourceMetadataUrl || modern.scope || modern.challenged) {
    return { resourceMetadataUrl: modern.resourceMetadataUrl, scope: modern.scope };
  }

  const legacy = await probeAuthorizationChallengeRequest(endpoint, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "OneAIWorkers", version: "remote-mcp-oauth-discovery" },
  });
  return { resourceMetadataUrl: legacy.resourceMetadataUrl, scope: legacy.scope };
}

async function probeAuthorizationChallengeRequest(
  endpoint: URL,
  method: string,
  params: Record<string, unknown>,
  protocolVersion?: string,
): Promise<{ resourceMetadataUrl: string | null; scope: string | null; challenged: boolean }> {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json; charset=utf-8",
    "mcp-method": method,
  });
  if (protocolVersion) headers.set("mcp-protocol-version", protocolVersion);
  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    redirect: "manual",
  });
  const header = response.headers.get("www-authenticate") || "";
  return {
    resourceMetadataUrl: challengeParam(header, "resource_metadata"),
    scope: challengeParam(header, "scope"),
    challenged: response.status === 401 || response.status === 403 || Boolean(header),
  };
}

async function discoverProtectedResourceMetadata(endpoint: URL, challengedUrl: string | null): Promise<ProtectedResourceMetadata | null> {
  const candidates = new Set<string>();
  if (challengedUrl) candidates.add(assertSafeOutboundUrl(new URL(challengedUrl, endpoint).toString()).toString());
  const pathname = endpoint.pathname === "/" ? "" : endpoint.pathname.replace(/\/$/u, "");
  candidates.add(`${endpoint.origin}/.well-known/oauth-protected-resource${pathname}`);
  candidates.add(`${endpoint.origin}/.well-known/oauth-protected-resource`);
  if (pathname) candidates.add(`${endpoint.origin}${pathname}/.well-known/oauth-protected-resource`);

  for (const candidate of candidates) {
    try {
      const metadata = await getJson<ProtectedResourceMetadata>(candidate);
      if (metadata && (metadata.resource || metadata.authorization_servers?.length)) return metadata;
    } catch {
      // Try the next standards-compatible discovery location.
    }
  }
  return null;
}

async function discoverAuthorizationServerMetadata(authorizationServer: string): Promise<AuthorizationServerMetadata> {
  const issuer = assertSafeOutboundUrl(authorizationServer);
  const path = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/u, "");
  const candidates = [
    `${issuer.origin}/.well-known/oauth-authorization-server${path}`,
    `${issuer.origin}/.well-known/openid-configuration${path}`,
    `${issuer.toString().replace(/\/$/u, "")}/.well-known/oauth-authorization-server`,
    `${issuer.toString().replace(/\/$/u, "")}/.well-known/openid-configuration`,
  ];
  let lastError: unknown = null;
  for (const candidate of [...new Set(candidates)]) {
    try {
      const metadata = await getJson<AuthorizationServerMetadata>(candidate);
      if (metadata.authorization_endpoint && metadata.token_endpoint) {
        if (typeof metadata.issuer !== "string" || !oauthIssuerMatches(metadata.issuer, issuer.toString())) {
          throw new Error("OAuth authorization server metadata issuer does not match the discovered authorization server.");
        }
        return metadata;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OAuth authorization server metadata could not be discovered.");
}

async function getOrRegisterClient(
  env: Env,
  connector: ConnectorRow,
  discovery: Awaited<ReturnType<typeof discoverOAuth>>,
  baseUrl: string,
): Promise<OAuthClientRow> {
  const metadataClient = remoteMcpClientMetadata(baseUrl);
  const useCimd = discovery.supportsClientIdMetadataDocument;
  const existing = await loadOAuthClient(env, connector.connector_id);
  const endpointsMatch = existing &&
    existing.authorization_server === discovery.authorizationServer &&
    existing.authorization_endpoint === discovery.authorizationEndpoint &&
    existing.token_endpoint === discovery.tokenEndpoint;
  if (endpointsMatch && (!useCimd || existing?.client_id === metadataClient.client_id)) return existing as OAuthClientRow;

  let clientId = "";
  let clientAuthMethod = "none";
  let registrationEndpoint: string | null = null;
  if (useCimd) {
    if (discovery.clientAuthMethods.length && !discovery.clientAuthMethods.includes("none")) {
      throw new Error("Remote MCP authorization server advertises CIMD but does not support public clients at the token endpoint.");
    }
    clientId = metadataClient.client_id;
    const system = await loadCredentialProfile(env, connector.connector_id, "system");
    if (system[OAUTH_CLIENT_SECRET_KEY]) {
      delete system[OAUTH_CLIENT_SECRET_KEY];
      await storeCredentialProfile(env, connector.connector_id, "system", system);
    }
  } else {
    if (!discovery.registrationEndpoint) {
      throw new Error("Remote MCP authorization server supports neither Client ID Metadata Documents nor Dynamic Client Registration.");
    }
    registrationEndpoint = discovery.registrationEndpoint;
    const redirectUri = `${new URL(baseUrl).origin}/oauth/remote-mcp/callback`;
    const registration = await postJson<Record<string, unknown>>(discovery.registrationEndpoint, {
      client_name: "OneAIWorkers",
      client_uri: new URL(baseUrl).origin,
      application_type: "web",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(discovery.scope ? { scope: discovery.scope } : {}),
    });
    clientId = typeof registration.client_id === "string" ? registration.client_id : "";
    if (!clientId) throw new Error("Dynamic Client Registration did not return client_id.");
    clientAuthMethod = typeof registration.token_endpoint_auth_method === "string"
      ? registration.token_endpoint_auth_method
      : "none";
    if (!["none", "client_secret_basic", "client_secret_post"].includes(clientAuthMethod)) {
      throw new Error(`Unsupported OAuth client authentication method: ${clientAuthMethod}`);
    }
    const clientSecret = typeof registration.client_secret === "string" ? registration.client_secret : "";
    if (clientSecret) {
      const system = await loadCredentialProfile(env, connector.connector_id, "system");
      await storeCredentialProfile(env, connector.connector_id, "system", { ...system, [OAUTH_CLIENT_SECRET_KEY]: clientSecret });
    }
  }
  const row: OAuthClientRow = {
    connector_id: connector.connector_id,
    authorization_server: discovery.authorizationServer,
    authorization_endpoint: discovery.authorizationEndpoint,
    token_endpoint: discovery.tokenEndpoint,
    registration_endpoint: registrationEndpoint,
    client_id: clientId,
    client_auth_method: clientAuthMethod,
    resource: discovery.resource,
    scope: discovery.scope,
    updated_at: nowSeconds(),
  };
  await getDb(env).prepare(
    `INSERT INTO remote_mcp_oauth_clients
       (connector_id, authorization_server, authorization_endpoint, token_endpoint, registration_endpoint,
        client_id, client_auth_method, resource, scope, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(connector_id) DO UPDATE SET
       authorization_server = excluded.authorization_server,
       authorization_endpoint = excluded.authorization_endpoint,
       token_endpoint = excluded.token_endpoint,
       registration_endpoint = excluded.registration_endpoint,
       client_id = excluded.client_id,
       client_auth_method = excluded.client_auth_method,
       resource = excluded.resource,
       scope = excluded.scope,
       updated_at = excluded.updated_at`,
  ).bind(row.connector_id, row.authorization_server, row.authorization_endpoint, row.token_endpoint,
    row.registration_endpoint, row.client_id, row.client_auth_method, row.resource, row.scope, row.updated_at).run();
  return row;
}

async function exchangeAuthorizationCode(
  env: Env,
  connector: ConnectorRow,
  client: OAuthClientRow,
  code: string,
  state: OAuthStatePayload,
): Promise<TokenResponse> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: state.redirectUri,
    client_id: client.client_id,
    code_verifier: state.codeVerifier,
    resource: state.resource,
  });
  return tokenRequest(env, connector, client, form);
}

async function refreshAccessToken(
  env: Env,
  connector: ConnectorRow,
  client: OAuthClientRow,
  refreshToken: string,
): Promise<TokenResponse> {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: client.client_id,
    resource: client.resource,
  });
  if (client.scope) form.set("scope", client.scope);
  return tokenRequest(env, connector, client, form);
}

async function tokenRequest(
  env: Env,
  connector: ConnectorRow,
  client: OAuthClientRow,
  form: URLSearchParams,
): Promise<TokenResponse> {
  const headers = new Headers({ accept: "application/json", "content-type": "application/x-www-form-urlencoded" });
  const system = await loadCredentialProfile(env, connector.connector_id, "system");
  const clientSecret = system[OAUTH_CLIENT_SECRET_KEY] || "";
  if (client.client_auth_method === "client_secret_basic") {
    if (!clientSecret) throw new Error("OAuth client secret is missing.");
    headers.set("authorization", `Basic ${btoa(`${client.client_id}:${clientSecret}`)}`);
    form.delete("client_id");
  } else if (client.client_auth_method === "client_secret_post") {
    if (!clientSecret) throw new Error("OAuth client secret is missing.");
    form.set("client_secret", clientSecret);
  }
  const endpoint = assertSafeOutboundUrl(client.token_endpoint);
  const response = await fetch(endpoint.toString(), { method: "POST", headers, body: form.toString(), redirect: "manual" });
  const text = await response.text();
  let payload: TokenResponse = {};
  try { payload = JSON.parse(text) as TokenResponse; } catch { /* handled below */ }
  if (!response.ok || !payload.access_token) {
    const detail = payload.error_description || payload.error || text.slice(0, 500) || `HTTP ${response.status}`;
    throw new Error(`Remote MCP OAuth token request failed: ${redactSensitiveText(detail)}`);
  }
  return payload;
}

async function storeOAuthTokens(
  env: Env,
  connector: ConnectorRow,
  token: TokenResponse,
  existingProfile?: Record<string, string>,
): Promise<void> {
  const accessKey = connector.remote_mcp_token_credential?.trim();
  if (!accessKey || !token.access_token) throw new Error("OAuth access token cannot be stored for this connector.");
  const existing = existingProfile || await loadCredentialProfile(env, connector.connector_id, "user");
  const expiresAt = token.expires_in && Number.isFinite(Number(token.expires_in))
    ? String(nowSeconds() + Math.max(1, Math.trunc(Number(token.expires_in))))
    : "";
  const values = {
    ...existing,
    [accessKey]: token.access_token,
    [OAUTH_REFRESH_TOKEN_KEY]: token.refresh_token || existing[OAUTH_REFRESH_TOKEN_KEY] || "",
    [OAUTH_EXPIRES_AT_KEY]: expiresAt,
    [OAUTH_TOKEN_TYPE_KEY]: token.token_type || existing[OAUTH_TOKEN_TYPE_KEY] || "Bearer",
    [OAUTH_SCOPE_KEY]: token.scope || existing[OAUTH_SCOPE_KEY] || "",
  };
  await storeCredentialProfile(env, connector.connector_id, "user", values);
}

async function loadOAuthClient(env: Env, connectorId: string): Promise<OAuthClientRow | null> {
  await ensureRemoteMcpOAuthSchema(env);
  return getDb(env).prepare(
    `SELECT connector_id, authorization_server, authorization_endpoint, token_endpoint, registration_endpoint,
            client_id, client_auth_method, resource, scope, updated_at
     FROM remote_mcp_oauth_clients WHERE connector_id = ?`,
  ).bind(connectorId).first<OAuthClientRow>();
}

async function requireOAuthConnector(env: Env, connectorId: string): Promise<ConnectorRow> {
  const connector = await loadConnector(env, connectorId);
  if (!connector || connector.mode !== "remote_mcp" || connector.remote_mcp_auth_type !== "oauth" || !connector.remote_mcp_url) {
    throw new Error("Plugin is not configured as an OAuth remote MCP connector.");
  }
  return connector;
}

async function loadConnector(env: Env, connectorId: string): Promise<ConnectorRow | null> {
  return getDb(env).prepare("SELECT * FROM connectors WHERE connector_id = ? AND enabled = 1")
    .bind(connectorId).first<ConnectorRow>();
}

async function getJson<T>(rawUrl: string): Promise<T> {
  const response = await fetchWithSafeRedirects(assertSafeOutboundUrl(rawUrl), { headers: { accept: "application/json" } }, 3);
  if (!response.ok) throw new Error(`OAuth discovery HTTP ${response.status}.`);
  return response.json<T>();
}

async function postJson<T extends Record<string, unknown>>(rawUrl: string, value: unknown): Promise<T> {
  const endpoint = assertSafeOutboundUrl(rawUrl);
  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(value),
    redirect: "manual",
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* handled below */ }
  if (!response.ok) throw new Error(`OAuth registration HTTP ${response.status}: ${redactSensitiveText(text.slice(0, 500))}`);
  return parsed as T;
}

function challengeParam(header: string, name: string): string | null {
  if (!header) return null;
  const quoted = header.match(new RegExp(`(?:^|[,\\s])${name}="([^"]+)"`, "i"));
  if (quoted?.[1]) return quoted[1];
  const bare = header.match(new RegExp(`(?:^|[,\\s])${name}=([^,\\s]+)`, "i"));
  return bare?.[1] || null;
}

function oauthIssuerMatches(actual: string, expected: string): boolean {
  try {
    return new URL(actual).toString() === new URL(expected).toString();
  } catch {
    return false;
  }
}

function stateAssociatedData(stateHash: string): string {
  return `oneaiworkers:remote-mcp-oauth-state:v1:${stateHash}`;
}

function masterKey(env: Env): string {
  const key = String(env.CREDENTIALS_MASTER_KEY || "");
  if (key.length < 32) throw new Error("CREDENTIALS_MASTER_KEY must contain at least 32 characters.");
  return key;
}

function getDb(env: Env): D1Database {
  if (!env.OAUTH_DB) throw new Error("D1 database is not configured.");
  return env.OAUTH_DB;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
