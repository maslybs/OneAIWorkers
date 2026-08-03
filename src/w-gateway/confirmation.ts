import { decryptJson, encryptJson, randomToken, sha256Base64Url } from "../crypto";
import type { Env } from "../types";
import { ensureWGatewaySchema, wDatabase } from "./schema";
import type { ExposureMode, WRequestContext } from "./types";

const CONFIRMATION_TTL_MS = 30 * 60 * 1000;

export interface StoredConfirmationIntent {
  plugin: {
    id: string;
    versionId: string;
  };
  context: {
    tenantId: string;
    userId: string;
    endpointId: string;
    sessionId: string;
    exposureMode: ExposureMode;
  };
  input: {
    tool_ref: string;
    arguments: Record<string, unknown>;
    connection_id?: string;
    idempotency_key?: string;
  };
}

export type ConfirmationConsumeResult =
  | { status: "invalid" }
  | { status: "pending"; expiresAt: string }
  | { status: "consumed" }
  | { status: "processing" }
  | { status: "replay"; result: unknown };

export async function issueConfirmationToken(
  env: Env,
  context: WRequestContext,
  toolRef: string,
  argumentsHash: string,
  intent?: StoredConfirmationIntent,
): Promise<{ token: string; expiresAt: string }> {
  await ensureWGatewaySchema(env);
  const token = randomToken();
  const tokenHash = await sha256Base64Url(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + CONFIRMATION_TTL_MS);
  const masterKey = confirmationMasterKey(env);
  const encrypted = intent && masterKey
    ? await encryptJson(masterKey, intent, confirmationAssociatedData(tokenHash))
    : null;
  await wDatabase(env).prepare(
    `INSERT INTO w_confirmation_tokens
       (token_hash, tenant_id, user_id, endpoint_id, tool_ref, arguments_hash,
        intent_ciphertext, intent_iv, intent_version, result_json, completed_at,
        expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?)`,
  ).bind(tokenHash, context.tenantId, context.userId, context.endpointId, toolRef,
    argumentsHash, encrypted?.ciphertext || null, encrypted?.iv || null, encrypted?.version || null,
    expiresAt.toISOString(), createdAt.toISOString()).run();
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function consumeConfirmationToken(
  env: Env,
  context: WRequestContext,
  toolRef: string,
  argumentsHash: string,
  token: string,
): Promise<ConfirmationConsumeResult> {
  if (!token) return { status: "invalid" };
  await ensureWGatewaySchema(env);
  const db = wDatabase(env);
  const tokenHash = await sha256Base64Url(token);
  const now = new Date().toISOString();
  const row = await db.prepare(
    `SELECT t.used_at, t.result_json, t.expires_at, a.approved_at
     FROM w_confirmation_tokens t
     LEFT JOIN w_confirmation_approvals a ON a.token_hash = t.token_hash
     WHERE t.token_hash = ? AND t.tenant_id = ? AND t.user_id = ? AND t.endpoint_id = ?
       AND t.tool_ref = ? AND t.arguments_hash = ? AND t.expires_at >= ?`,
  ).bind(tokenHash, context.tenantId, context.userId, context.endpointId, toolRef, argumentsHash, now)
    .first<{ used_at: string | null; result_json: string | null; expires_at: string; approved_at: string | null }>();
  if (!row) return { status: "invalid" };
  if (row.result_json) return { status: "replay", result: safeJson(row.result_json) };
  if (row.used_at) return { status: "processing" };
  if (!row.approved_at) return { status: "pending", expiresAt: row.expires_at };
  const result = await db.prepare(
    "UPDATE w_confirmation_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL",
  ).bind(now, tokenHash).run();
  if (result.meta.changes) return { status: "consumed" };
  return { status: "processing" };
}

export async function storeConfirmationResult(env: Env, token: string, result: unknown): Promise<void> {
  if (!token) return;
  await ensureWGatewaySchema(env);
  const tokenHash = await sha256Base64Url(token);
  const completedAt = new Date().toISOString();
  await wDatabase(env).prepare(
    `UPDATE w_confirmation_tokens SET result_json = ?, completed_at = ?
     WHERE token_hash = ? AND used_at IS NOT NULL AND result_json IS NULL`,
  ).bind(JSON.stringify(result), completedAt, tokenHash).run();
}

export async function loadConfirmationIntent(env: Env, token: string): Promise<StoredConfirmationIntent | null> {
  if (!/^[A-Za-z0-9_-]{20,300}$/u.test(token)) return null;
  await ensureWGatewaySchema(env);
  const tokenHash = await sha256Base64Url(token);
  const row = await wDatabase(env).prepare(
    `SELECT intent_ciphertext, intent_iv, intent_version FROM w_confirmation_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at >= ?`,
  ).bind(tokenHash, new Date().toISOString()).first<{
    intent_ciphertext: string | null;
    intent_iv: string | null;
    intent_version: number | null;
  }>();
  const masterKey = confirmationMasterKey(env);
  if (!row?.intent_ciphertext || !row.intent_iv || row.intent_version !== 1 || !masterKey) return null;
  return decryptJson<StoredConfirmationIntent>(
    masterKey,
    { version: 1, iv: row.intent_iv, ciphertext: row.intent_ciphertext },
    confirmationAssociatedData(tokenHash),
  );
}

export async function confirmationStatus(env: Env, context: WRequestContext, token: string): Promise<Record<string, unknown>> {
  if (!/^[A-Za-z0-9_-]{20,300}$/u.test(token)) return { ok: false, status: "unavailable" };
  await ensureWGatewaySchema(env);
  const tokenHash = await sha256Base64Url(token);
  const row = await wDatabase(env).prepare(
    `SELECT t.tool_ref, t.expires_at, t.used_at, t.completed_at, t.result_json, a.approved_at
     FROM w_confirmation_tokens t
     LEFT JOIN w_confirmation_approvals a ON a.token_hash = t.token_hash
     WHERE t.token_hash = ? AND t.tenant_id = ? AND t.user_id = ? AND t.endpoint_id = ?`,
  ).bind(tokenHash, context.tenantId, context.userId, context.endpointId).first<{
    tool_ref: string;
    expires_at: string;
    used_at: string | null;
    completed_at: string | null;
    result_json: string | null;
    approved_at: string | null;
  }>();
  if (!row) return { ok: false, status: "unavailable" };
  if (row.result_json) return {
    ok: true,
    status: "completed",
    tool_ref: row.tool_ref,
    completed_at: row.completed_at,
    result: safeJson(row.result_json),
  };
  if (row.used_at) return { ok: true, status: "processing", tool_ref: row.tool_ref };
  if (row.expires_at < new Date().toISOString()) return { ok: false, status: "expired", tool_ref: row.tool_ref };
  if (row.approved_at) return { ok: true, status: "approved", tool_ref: row.tool_ref };
  return { ok: true, status: "waiting_for_approval", tool_ref: row.tool_ref, expires_at: row.expires_at };
}

export async function openConfirmationApproval(
  env: Env,
  token: string,
): Promise<{ browserNonce: string; toolRef: string; expiresAt: string; executesInBrowser: boolean; pluginId?: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,300}$/u.test(token)) return null;
  await ensureWGatewaySchema(env);
  const db = wDatabase(env);
  const tokenHash = await sha256Base64Url(token);
  const now = new Date().toISOString();
  const pending = await db.prepare(
    `SELECT tool_ref, expires_at, intent_ciphertext FROM w_confirmation_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at >= ?
       AND NOT EXISTS (
         SELECT 1 FROM w_confirmation_approvals
         WHERE token_hash = w_confirmation_tokens.token_hash AND approved_at IS NOT NULL
       )`,
  ).bind(tokenHash, now).first<{ tool_ref: string; expires_at: string; intent_ciphertext: string | null }>();
  if (!pending) return null;
  const browserNonce = randomToken();
  const browserNonceHash = await sha256Base64Url(browserNonce);
  await db.prepare(
    `INSERT INTO w_confirmation_approvals (token_hash, browser_nonce_hash, approved_at, created_at)
     VALUES (?, ?, NULL, ?)
     ON CONFLICT(token_hash) DO UPDATE SET browser_nonce_hash = excluded.browser_nonce_hash,
       approved_at = NULL, created_at = excluded.created_at`,
  ).bind(tokenHash, browserNonceHash, now).run();
  const intent = pending.intent_ciphertext ? await loadConfirmationIntent(env, token) : null;
  return {
    browserNonce,
    toolRef: pending.tool_ref,
    expiresAt: pending.expires_at,
    executesInBrowser: Boolean(pending.intent_ciphertext),
    ...(intent?.plugin.id ? { pluginId: intent.plugin.id } : {}),
  };
}

export async function approveConfirmation(
  env: Env,
  token: string,
  browserNonce: string,
): Promise<{ ok: true; toolRef: string } | { ok: false }> {
  if (!/^[A-Za-z0-9_-]{20,300}$/u.test(token) || !/^[A-Za-z0-9_-]{20,300}$/u.test(browserNonce)) return { ok: false };
  await ensureWGatewaySchema(env);
  const db = wDatabase(env);
  const tokenHash = await sha256Base64Url(token);
  const browserNonceHash = await sha256Base64Url(browserNonce);
  const now = new Date().toISOString();
  const pending = await db.prepare(
    `SELECT t.tool_ref FROM w_confirmation_tokens t
     JOIN w_confirmation_approvals a ON a.token_hash = t.token_hash
     WHERE t.token_hash = ? AND a.browser_nonce_hash = ? AND a.approved_at IS NULL
       AND t.used_at IS NULL AND t.expires_at >= ?`,
  ).bind(tokenHash, browserNonceHash, now).first<{ tool_ref: string }>();
  if (!pending) return { ok: false };
  const result = await db.prepare(
    `UPDATE w_confirmation_approvals SET approved_at = ?
     WHERE token_hash = ? AND browser_nonce_hash = ? AND approved_at IS NULL`,
  ).bind(now, tokenHash, browserNonceHash).run();
  return result.meta.changes ? { ok: true, toolRef: pending.tool_ref } : { ok: false };
}

function confirmationMasterKey(env: Env): string | null {
  const value = String(env.CREDENTIALS_MASTER_KEY || env.MCP_SHARED_SECRET || "");
  return value.length >= 32 ? value : null;
}

function confirmationAssociatedData(tokenHash: string): string {
  return `oneaiworkers:confirmation:v1:${tokenHash}`;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { ok: false, error: { code: "confirmation_result_unavailable" } };
  }
}
