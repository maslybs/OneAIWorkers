import { z } from "zod";
import { biInline } from "../../i18n";
import { assertSafeOutboundUrl } from "../../security";
import type { Env } from "../../types";
import { redactTemplatedUrl } from "./templates";
import type { AuthConfig, JsonObject, OAuthClientAuthMethod } from "./types";

const oauthClientAuthMethodSchema = z.enum(["basic", "body"]).default("body");

export const authSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer_secret"), secret_name: z.string().min(2).max(80) }),
  z.object({ type: z.literal("auth_header_secret"), secret_name: z.string().min(2).max(80), scheme: z.string().min(1).max(30).optional() }),
  z.object({ type: z.literal("api_key_header_secret"), secret_name: z.string().min(2).max(80), header_name: z.string().min(2).max(80) }),
  z.object({ type: z.literal("api_key_query_secret"), secret_name: z.string().min(2).max(80), query_name: z.string().min(1).max(80) }),
  z.object({ type: z.literal("basic_secret"), secret_name: z.string().min(2).max(80), username: z.string().max(120).optional() }),
  z.object({ type: z.literal("basic_secret_pair"), username_secret_name: z.string().min(2).max(80), password_secret_name: z.string().min(2).max(80) }),
  z.object({
    type: z.literal("oauth2_client_credentials"),
    token_url: z.string().url(),
    client_id_secret_name: z.string().min(2).max(80),
    client_secret_secret_name: z.string().min(2).max(80),
    scope: z.string().max(1000).optional(),
    audience: z.string().max(1000).optional(),
    client_auth_method: oauthClientAuthMethodSchema.optional(),
    access_token_field: z.string().min(1).max(80).optional(),
    token_type: z.string().min(1).max(30).optional(),
  }),
  z.object({
    type: z.literal("oauth2_refresh_token"),
    token_url: z.string().url(),
    refresh_token_secret_name: z.string().min(2).max(80),
    client_id_secret_name: z.string().min(2).max(80).optional(),
    client_secret_secret_name: z.string().min(2).max(80).optional(),
    scope: z.string().max(1000).optional(),
    client_auth_method: oauthClientAuthMethodSchema.optional(),
    access_token_field: z.string().min(1).max(80).optional(),
    token_type: z.string().min(1).max(30).optional(),
  }),
  z.object({
    type: z.literal("google_oauth2_refresh_token"),
    client_id_secret_name: z.string().min(2).max(80),
    client_secret_secret_name: z.string().min(2).max(80),
    refresh_token_secret_name: z.string().min(2).max(80),
    scope: z.string().max(1000).optional(),
  }),
]);

export async function applyConnectorAuth(env: Env, url: URL, headers: Headers, auth: AuthConfig): Promise<void> {
  if (!auth || auth.type === "none") return;
  validateAuth(auth);

  switch (auth.type) {
    case "bearer_secret":
      headers.set("authorization", `Bearer ${getSecret(env, auth.secret_name)}`);
      return;
    case "auth_header_secret":
      headers.set("authorization", `${auth.scheme || "Bearer"} ${getSecret(env, auth.secret_name)}`);
      return;
    case "api_key_header_secret":
      headers.set(auth.header_name, getSecret(env, auth.secret_name));
      return;
    case "api_key_query_secret":
      url.searchParams.set(auth.query_name, getSecret(env, auth.secret_name));
      return;
    case "basic_secret":
      headers.set("authorization", `Basic ${btoa(`${auth.username || ""}:${getSecret(env, auth.secret_name)}`)}`);
      return;
    case "basic_secret_pair":
      headers.set("authorization", `Basic ${btoa(`${getSecret(env, auth.username_secret_name)}:${getSecret(env, auth.password_secret_name)}`)}`);
      return;
    case "oauth2_client_credentials":
      headers.set("authorization", `${auth.token_type || "Bearer"} ${await fetchOAuthAccessToken(env, {
        grant_type: "client_credentials",
        token_url: auth.token_url,
        client_id_secret_name: auth.client_id_secret_name,
        client_secret_secret_name: auth.client_secret_secret_name,
        scope: auth.scope,
        audience: auth.audience,
        client_auth_method: auth.client_auth_method || "body",
        access_token_field: auth.access_token_field || "access_token",
      })}`);
      return;
    case "oauth2_refresh_token":
      headers.set("authorization", `${auth.token_type || "Bearer"} ${await fetchOAuthAccessToken(env, {
        grant_type: "refresh_token",
        token_url: auth.token_url,
        refresh_token_secret_name: auth.refresh_token_secret_name,
        client_id_secret_name: auth.client_id_secret_name,
        client_secret_secret_name: auth.client_secret_secret_name,
        scope: auth.scope,
        client_auth_method: auth.client_auth_method || "body",
        access_token_field: auth.access_token_field || "access_token",
      })}`);
      return;
    case "google_oauth2_refresh_token":
      headers.set("authorization", `Bearer ${await fetchOAuthAccessToken(env, {
        grant_type: "refresh_token",
        token_url: "https://oauth2.googleapis.com/token",
        refresh_token_secret_name: auth.refresh_token_secret_name,
        client_id_secret_name: auth.client_id_secret_name,
        client_secret_secret_name: auth.client_secret_secret_name,
        scope: auth.scope,
        client_auth_method: "body",
        access_token_field: "access_token",
      })}`);
      return;
  }
}

export function publicAuth(auth: AuthConfig, env: Env) {
  if (!auth || auth.type === "none") return { type: "none" };
  return {
    type: auth.type,
    ...publicAuthDetails(auth),
    secrets: getAuthSecretNames(auth).map((name) => ({
      name,
      configured: isSecretConfigured(env, name),
      value: "[hidden]",
    })),
  };
}

export function validateAuth(auth: AuthConfig): void {
  if (!auth || auth.type === "none") return;

  for (const name of getAuthSecretNames(auth)) validateSecretName(name);
  if (auth.type === "oauth2_client_credentials" || auth.type === "oauth2_refresh_token") {
    assertSafeOutboundUrl(auth.token_url);
    validateTokenOptions(auth.client_auth_method, auth.access_token_field, auth.token_type);
  }
  if (auth.type === "auth_header_secret") validateAuthScheme(auth.scheme || "Bearer");
  if (auth.type === "api_key_header_secret") validateHeaderName(auth.header_name);
  if (auth.type === "api_key_query_secret" && !/^[A-Za-z0-9_.-]{1,80}$/.test(auth.query_name)) throw new Error(biInline("Invalid query key name.", "Некоректна назва query key."));
}

export function validateSecretName(name: string): void {
  if (!/^[A-Z][A-Z0-9_]{1,80}$/.test(name)) {
    throw new Error(biInline("Secret name must use uppercase letters, numbers, and underscores.", "Назва secret має містити великі літери, цифри й підкреслення."));
  }
}

export function validateSafeHeaders(headers: Record<string, unknown>): void {
  for (const key of Object.keys(headers)) validateHeaderName(key);
}

export function getSecret(env: Env, name: string): string {
  validateSecretName(name);
  const value = (env as Record<string, unknown>)[name];
  if (typeof value !== "string" || !value) {
    throw new Error(`${biInline("Secret is not configured", "Secret не налаштований")}: ${name}`);
  }
  return value;
}

export function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of headers.entries()) out[key] = /authorization|token|key|secret|cookie/i.test(key) ? "[redacted]" : value;
  return out;
}

export function getAuthSecretNames(auth: AuthConfig): string[] {
  switch (auth.type) {
    case "bearer_secret":
    case "auth_header_secret":
    case "api_key_header_secret":
    case "api_key_query_secret":
    case "basic_secret":
      return [auth.secret_name];
    case "basic_secret_pair":
      return [auth.username_secret_name, auth.password_secret_name];
    case "oauth2_client_credentials":
      return [auth.client_id_secret_name, auth.client_secret_secret_name];
    case "oauth2_refresh_token":
      return [auth.refresh_token_secret_name, auth.client_id_secret_name, auth.client_secret_secret_name].filter(Boolean) as string[];
    case "google_oauth2_refresh_token":
      return [auth.client_id_secret_name, auth.client_secret_secret_name, auth.refresh_token_secret_name];
    default:
      return [];
  }
}

export function isSecretConfigured(env: Env, name: string): boolean {
  const value = (env as Record<string, unknown>)[name];
  return typeof value === "string" && value.length > 0;
}

interface OAuthTokenRequestConfig {
  grant_type: "client_credentials" | "refresh_token";
  token_url: string;
  client_id_secret_name?: string;
  client_secret_secret_name?: string;
  refresh_token_secret_name?: string;
  scope?: string;
  audience?: string;
  client_auth_method: OAuthClientAuthMethod;
  access_token_field: string;
}

async function fetchOAuthAccessToken(env: Env, config: OAuthTokenRequestConfig): Promise<string> {
  const tokenUrl = assertSafeOutboundUrl(config.token_url);
  const body = new URLSearchParams();
  body.set("grant_type", config.grant_type);
  if (config.scope) body.set("scope", config.scope);
  if (config.audience) body.set("audience", config.audience);
  if (config.refresh_token_secret_name) body.set("refresh_token", getSecret(env, config.refresh_token_secret_name));

  const clientId = config.client_id_secret_name ? getSecret(env, config.client_id_secret_name) : "";
  const clientSecret = config.client_secret_secret_name ? getSecret(env, config.client_secret_secret_name) : "";
  const headers = new Headers({ accept: "application/json", "content-type": "application/x-www-form-urlencoded; charset=utf-8" });
  if (config.client_auth_method === "basic" && clientId && clientSecret) headers.set("authorization", `Basic ${btoa(`${clientId}:${clientSecret}`)}`);
  else {
    if (clientId) body.set("client_id", clientId);
    if (clientSecret) body.set("client_secret", clientSecret);
  }

  const response = await fetch(tokenUrl.toString(), { method: "POST", headers, body, redirect: "manual" });
  const payload = (await response.json().catch(() => null)) as JsonObject | null;
  if (!response.ok || !payload) throw new Error(`${biInline("OAuth token request failed", "OAuth token запит не вдався")}: ${response.status}`);

  const token = payload[config.access_token_field];
  if (typeof token !== "string" || !token) throw new Error(biInline("OAuth token response does not include an access token.", "OAuth token відповідь не містить access token."));
  return token;
}

function publicAuthDetails(auth: AuthConfig): JsonObject {
  if (auth.type === "api_key_header_secret") return { header_name: auth.header_name };
  if (auth.type === "api_key_query_secret") return { query_name: auth.query_name };
  if (auth.type === "auth_header_secret") return { scheme: auth.scheme || "Bearer" };
  if (auth.type === "oauth2_client_credentials" || auth.type === "oauth2_refresh_token") {
    return {
      token_url: redactTemplatedUrl(auth.token_url),
      scope: auth.scope || null,
      audience: "audience" in auth ? auth.audience || null : null,
      client_auth_method: auth.client_auth_method || "body",
    };
  }
  if (auth.type === "google_oauth2_refresh_token") return { token_url: "https://oauth2.googleapis.com/token", scope: auth.scope || null };
  return {};
}

function validateTokenOptions(clientAuthMethod?: OAuthClientAuthMethod, accessTokenField?: string, tokenType?: string): void {
  if (clientAuthMethod && !["basic", "body"].includes(clientAuthMethod)) throw new Error(biInline("Invalid OAuth client auth method.", "Некоректний OAuth client auth method."));
  if (accessTokenField && !/^[A-Za-z0-9_.-]{1,80}$/.test(accessTokenField)) throw new Error(biInline("Invalid OAuth access token field.", "Некоректне OAuth access token field."));
  if (tokenType) validateAuthScheme(tokenType);
}

function validateAuthScheme(value: string): void {
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,29}$/.test(value)) throw new Error(biInline("Invalid authorization scheme.", "Некоректна authorization scheme."));
}

function validateHeaderName(name: string): void {
  const lower = name.toLowerCase();
  if (!/^[a-z0-9-]{2,80}$/i.test(name) || ["authorization", "cookie", "set-cookie", "host"].includes(lower)) {
    throw new Error(biInline("This header name is not allowed.", "Ця назва header не дозволена."));
  }
}
