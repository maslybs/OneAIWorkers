import { decryptJson, encryptJson, randomToken, sha256Base64Url } from "./crypto";
import { loadCredentialProfile, storeCredentialProfile } from "./vault";
import type { Env } from "./types";

const GOOGLE_WORKSPACE_PLUGIN_ID = "google-workspace";
const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
];
const STATE_TTL_SECONDS = 10 * 60;

interface PluginOAuthStateRow {
  state_hash: string;
  connector_id: string;
  encrypted_json: string;
  iv: string;
  expires_at: number;
  used_at: number | null;
}

interface GoogleOAuthState {
  codeVerifier: string;
  redirectUri: string;
  language: "en" | "uk";
}

export function isManagedPluginOAuthConnector(connectorId: string): boolean {
  return connectorId === GOOGLE_WORKSPACE_PLUGIN_ID;
}

export function managedPluginOAuthCallbackUrl(baseUrl: string, connectorId: string): string {
  return `${new URL(baseUrl).origin}/plugins/${encodeURIComponent(connectorId)}/oauth/callback`;
}

export function managedPluginOAuthSetupHelp(baseUrl: string, connectorId: string, language: "en" | "uk"): string | undefined {
  if (!isManagedPluginOAuthConnector(connectorId)) return undefined;
  const callback = managedPluginOAuthCallbackUrl(baseUrl, connectorId);
  return language === "uk"
    ? `У Google Cloud створіть OAuth-клієнт типу Web application і додайте цю точну адресу повернення: ${callback}. Переведіть екран дозволів у режим In production, інакше Google може завершити доступ через 7 днів.`
    : `In Google Cloud, create a Web application OAuth client and add this exact redirect URI: ${callback}. Set the consent screen to In production, or Google may expire access after 7 days.`;
}

export async function beginManagedPluginOAuth(
  env: Env,
  baseUrl: string,
  connectorId: string,
  language: "en" | "uk",
): Promise<string> {
  if (!isManagedPluginOAuthConnector(connectorId)) throw new Error("This plugin does not support managed OAuth.");
  const credentials = await loadCredentialProfile(env, connectorId, "user");
  const clientId = String(credentials.client_id || "").trim();
  const clientSecret = String(credentials.client_secret || "").trim();
  if (!clientId || !clientSecret) throw new Error("Save the Google OAuth Client ID and Client Secret first.");

  const state = randomToken(32);
  const stateHash = await sha256Base64Url(state);
  const codeVerifier = randomToken(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const redirectUri = managedPluginOAuthCallbackUrl(baseUrl, connectorId);
  const encrypted = await encryptJson(masterKey(env), { codeVerifier, redirectUri, language } satisfies GoogleOAuthState, stateAssociatedData(stateHash));
  const db = database(env);
  await ensureManagedPluginOAuthSchema(env);
  const now = nowSeconds();
  await db.batch([
    db.prepare("DELETE FROM plugin_oauth_states WHERE expires_at < ? OR used_at IS NOT NULL").bind(now),
    db.prepare(
      `INSERT INTO plugin_oauth_states
         (state_hash, connector_id, encrypted_json, iv, expires_at, used_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ).bind(stateHash, connectorId, encrypted.ciphertext, encrypted.iv, now + STATE_TTL_SECONDS, now),
  ]);

  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_URL);
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", GOOGLE_WORKSPACE_SCOPES.join(" "));
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("include_granted_scopes", "true");
  authorizationUrl.searchParams.set("prompt", "consent select_account");
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("state", state);
  return authorizationUrl.toString();
}

export async function completeManagedPluginOAuth(
  env: Env,
  connectorId: string,
  callbackUrl: URL,
): Promise<{ connectorId: string; language: "en" | "uk" }> {
  if (!isManagedPluginOAuthConnector(connectorId)) throw new Error("This plugin does not support managed OAuth.");
  const providerError = callbackUrl.searchParams.get("error");
  if (providerError) throw new Error(providerError === "access_denied" ? "Google access was not granted." : "Google authorization failed.");
  const code = callbackUrl.searchParams.get("code")?.trim() || "";
  const state = callbackUrl.searchParams.get("state")?.trim() || "";
  if (!code || !state) throw new Error("Google did not return a valid authorization response.");

  const stateHash = await sha256Base64Url(state);
  const db = database(env);
  await ensureManagedPluginOAuthSchema(env);
  const now = nowSeconds();
  const row = await db.prepare(
    `SELECT state_hash, connector_id, encrypted_json, iv, expires_at, used_at
     FROM plugin_oauth_states
     WHERE state_hash = ? AND connector_id = ? AND used_at IS NULL AND expires_at >= ?`,
  ).bind(stateHash, connectorId, now).first<PluginOAuthStateRow>();
  if (!row) throw new Error("This Google authorization request has expired or was already used.");
  const consumed = await db.prepare(
    "UPDATE plugin_oauth_states SET used_at = ? WHERE state_hash = ? AND used_at IS NULL",
  ).bind(now, stateHash).run();
  if (!consumed.meta.changes) throw new Error("This Google authorization request was already used.");

  const oauthState = await decryptJson<GoogleOAuthState>(
    masterKey(env),
    { version: 1, iv: row.iv, ciphertext: row.encrypted_json },
    stateAssociatedData(stateHash),
  );
  const existing = await loadCredentialProfile(env, connectorId, "user");
  const clientId = String(existing.client_id || "").trim();
  const clientSecret = String(existing.client_secret || "").trim();
  if (!clientId || !clientSecret) throw new Error("Google OAuth client settings are missing.");

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: oauthState.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: oauthState.redirectUri,
    }),
    redirect: "manual",
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({})) as Record<string, unknown>;
  if (!tokenResponse.ok) {
    const codeValue = String(tokenPayload.error || "oauth_exchange_failed");
    throw new Error(codeValue === "invalid_grant"
      ? "Google rejected this authorization code. Start the connection again."
      : `Google authorization failed: ${codeValue}.`);
  }
  const refreshToken = String(tokenPayload.refresh_token || existing.refresh_token || "").trim();
  if (!refreshToken) {
    throw new Error("Google did not return a refresh token. Revoke the previous grant, then connect again with consent.");
  }

  const refreshTokenExpiresIn = Number(tokenPayload.refresh_token_expires_in || 0);
  await storeCredentialProfile(env, connectorId, "user", {
    ...existing,
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    granted_scopes: String(tokenPayload.scope || GOOGLE_WORKSPACE_SCOPES.join(" ")),
    refresh_token_expires_at: refreshTokenExpiresIn > 0 ? String(now + refreshTokenExpiresIn) : "",
  });
  return { connectorId, language: oauthState.language === "uk" ? "uk" : "en" };
}

export async function ensureManagedPluginOAuthSchema(env: Env): Promise<void> {
  await database(env).prepare(
    `CREATE TABLE IF NOT EXISTS plugin_oauth_states (
      state_hash TEXT PRIMARY KEY,
      connector_id TEXT NOT NULL,
      encrypted_json TEXT NOT NULL,
      iv TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL
    )`,
  ).run();
}

function stateAssociatedData(stateHash: string): string {
  return `oneaiworkers:plugin-oauth:v1:${stateHash}`;
}

function masterKey(env: Env): string {
  const value = String(env.CREDENTIALS_MASTER_KEY || "");
  if (value.length < 32) throw new Error("CREDENTIALS_MASTER_KEY must contain at least 32 characters.");
  return value;
}

function database(env: Env): D1Database {
  if (!env.OAUTH_DB) throw new Error("D1 database is not configured.");
  return env.OAUTH_DB;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
