import { decryptJson, encryptJson, randomToken, sha256Base64Url } from "./crypto";
import type { Env } from "./types";

const ACCESS_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 30 * 60;

export interface CredentialField {
  id: string;
  label: string;
  label_uk?: string;
  type: "secret" | "text" | "url";
  required?: boolean;
  placeholder?: string;
  help?: string;
  help_uk?: string;
}

interface CredentialRow {
  connector_id: string;
  profile_id: string;
  encrypted_json: string;
  iv: string;
  encryption_version: number;
  updated_at: number;
}

interface AccessRow {
  token_hash: string;
  connector_id: string;
  purpose: string;
  expires_at: number;
  used_at: number | null;
}

export async function ensureCredentialSchema(env: Env): Promise<void> {
  const db = getDb(env);
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS connector_credentials (
      connector_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      encrypted_json TEXT NOT NULL,
      iv TEXT NOT NULL,
      encryption_version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (connector_id, profile_id)
    )`,
    `CREATE TABLE IF NOT EXISTS connector_access_tokens (
      token_hash TEXT PRIMARY KEY,
      connector_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_connector_access_expiry ON connector_access_tokens(expires_at)",
  ]) {
    await db.prepare(sql).run();
  }
}

export async function storeCredentialProfile(
  env: Env,
  connectorId: string,
  profileId: "user" | "system",
  values: Record<string, string>,
): Promise<void> {
  const masterKey = getMasterKey(env);
  const db = getDb(env);
  await ensureCredentialSchema(env);
  const encrypted = await encryptJson(masterKey, values, associatedData(connectorId, profileId));
  const now = nowSeconds();
  await db.prepare(
    `INSERT INTO connector_credentials
       (connector_id, profile_id, encrypted_json, iv, encryption_version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(connector_id, profile_id) DO UPDATE SET
       encrypted_json = excluded.encrypted_json,
       iv = excluded.iv,
       encryption_version = excluded.encryption_version,
       updated_at = excluded.updated_at`,
  ).bind(connectorId, profileId, encrypted.ciphertext, encrypted.iv, encrypted.version, now).run();
}

export async function loadCredentialProfile(
  env: Env,
  connectorId: string,
  profileId: "user" | "system",
): Promise<Record<string, string>> {
  const masterKey = getMasterKey(env);
  const db = getDb(env);
  await ensureCredentialSchema(env);
  const row = await db.prepare(
    "SELECT * FROM connector_credentials WHERE connector_id = ? AND profile_id = ?",
  ).bind(connectorId, profileId).first<CredentialRow>();
  if (!row) return {};
  return decryptJson<Record<string, string>>(
    masterKey,
    { version: 1, iv: row.iv, ciphertext: row.encrypted_json },
    associatedData(connectorId, profileId),
  );
}

export async function hasCredentialProfile(env: Env, connectorId: string, profileId: "user" | "system"): Promise<boolean> {
  if (!env.OAUTH_DB) return false;
  await ensureCredentialSchema(env);
  const row = await env.OAUTH_DB.prepare(
    "SELECT 1 AS found FROM connector_credentials WHERE connector_id = ? AND profile_id = ?",
  ).bind(connectorId, profileId).first<{ found: number }>();
  return Boolean(row?.found);
}

export async function deleteConnectorCredentials(env: Env, connectorId: string): Promise<void> {
  if (!env.OAUTH_DB) return;
  await ensureCredentialSchema(env);
  await env.OAUTH_DB.batch([
    env.OAUTH_DB.prepare("DELETE FROM connector_credentials WHERE connector_id = ?").bind(connectorId),
    env.OAUTH_DB.prepare("DELETE FROM connector_access_tokens WHERE connector_id = ?").bind(connectorId),
  ]);
}

export async function createConnectorAccessToken(env: Env, connectorId: string): Promise<string> {
  const db = getDb(env);
  await ensureCredentialSchema(env);
  const rawToken = randomToken();
  const tokenHash = await sha256Base64Url(rawToken);
  const now = nowSeconds();
  await db.prepare(
    `INSERT INTO connector_access_tokens
       (token_hash, connector_id, purpose, expires_at, used_at, created_at)
     VALUES (?, ?, 'one_time', ?, NULL, ?)`,
  ).bind(tokenHash, connectorId, now + ACCESS_TTL_SECONDS, now).run();
  await db.prepare("DELETE FROM connector_access_tokens WHERE expires_at < ?").bind(now).run();
  return rawToken;
}

export async function consumeConnectorAccessToken(
  env: Env,
  rawToken: string,
): Promise<{ connectorId: string; sessionToken: string }> {
  const db = getDb(env);
  await ensureCredentialSchema(env);
  const tokenHash = await sha256Base64Url(rawToken);
  const now = nowSeconds();
  const row = await db.prepare(
    `SELECT * FROM connector_access_tokens
     WHERE token_hash = ? AND purpose = 'one_time' AND used_at IS NULL AND expires_at >= ?`,
  ).bind(tokenHash, now).first<AccessRow>();
  if (!row) throw new Error("This settings link is invalid or has expired.");
  const consumed = await db.prepare(
    "UPDATE connector_access_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL",
  ).bind(now, tokenHash).run();
  if (!consumed.meta.changes) throw new Error("This settings link has already been used.");

  const sessionToken = randomToken();
  const sessionHash = await sha256Base64Url(sessionToken);
  await db.prepare(
    `INSERT INTO connector_access_tokens
       (token_hash, connector_id, purpose, expires_at, used_at, created_at)
     VALUES (?, ?, 'session', ?, NULL, ?)`,
  ).bind(sessionHash, row.connector_id, now + SESSION_TTL_SECONDS, now).run();
  return { connectorId: row.connector_id, sessionToken };
}

export async function validateConnectorSession(env: Env, connectorId: string, rawToken: string | null): Promise<boolean> {
  if (!rawToken || !env.OAUTH_DB) return false;
  await ensureCredentialSchema(env);
  const tokenHash = await sha256Base64Url(rawToken);
  const row = await env.OAUTH_DB.prepare(
    `SELECT connector_id FROM connector_access_tokens
     WHERE token_hash = ? AND purpose = 'session' AND expires_at >= ?`,
  ).bind(tokenHash, nowSeconds()).first<{ connector_id: string }>();
  return row?.connector_id === connectorId;
}

export function connectorSessionCookie(sessionToken: string): string {
  return `oneaiworkers_plugin_session=${sessionToken}; Path=/plugins/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function readConnectorSessionCookie(request: Request): string | null {
  const cookie = request.headers.get("cookie") || "";
  for (const item of cookie.split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name === "oneaiworkers_plugin_session") return parts.join("=") || null;
  }
  return null;
}

export function credentialsReady(values: Record<string, string>, fields: CredentialField[]): boolean {
  return fields.every((field) => !field.required || Boolean(values[field.id]?.trim()));
}

export function sanitizeSubmittedCredentials(
  form: FormData,
  fields: CredentialField[],
  existing: Record<string, string>,
): Record<string, string> {
  const allowedIds = new Set(fields.map((field) => field.id));
  const output: Record<string, string> = {};
  for (const field of fields) {
    const submitted = String(form.get(field.id) || "").trim();
    if (field.type === "secret" && !submitted && existing[field.id]) output[field.id] = existing[field.id];
    else output[field.id] = submitted;
    if (field.type === "url" && output[field.id]) {
      const url = new URL(output[field.id]);
      if (url.protocol !== "https:") throw new Error(`${field.label} must use HTTPS.`);
      output[field.id] = url.toString().replace(/\/+$/g, "");
    }
    if (field.required && !output[field.id]) throw new Error(`${field.label} is required.`);
  }
  for (const key of form.keys()) {
    if (key.startsWith("credential_") && !allowedIds.has(key)) throw new Error("Unexpected credential field.");
  }
  return output;
}

function associatedData(connectorId: string, profileId: string): string {
  return `oneaiworkers:credentials:v1:${connectorId}:${profileId}`;
}

function getMasterKey(env: Env): string {
  const value = String(env.CREDENTIALS_MASTER_KEY || "");
  if (!value) throw new Error("CREDENTIALS_MASTER_KEY is not configured.");
  return value;
}

function getDb(env: Env): D1Database {
  if (!env.OAUTH_DB) throw new Error("D1 database is not configured.");
  return env.OAUTH_DB;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
