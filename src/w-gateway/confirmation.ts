import { randomToken, sha256Base64Url } from "../crypto";
import type { Env } from "../types";
import { ensureWGatewaySchema, wDatabase } from "./schema";
import type { WRequestContext } from "./types";

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

export async function issueConfirmationToken(
  env: Env,
  context: WRequestContext,
  toolRef: string,
  argumentsHash: string,
): Promise<{ token: string; expiresAt: string }> {
  await ensureWGatewaySchema(env);
  const token = randomToken();
  const tokenHash = await sha256Base64Url(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + CONFIRMATION_TTL_MS);
  await wDatabase(env).prepare(
    `INSERT INTO w_confirmation_tokens
       (token_hash, tenant_id, user_id, endpoint_id, tool_ref, arguments_hash, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).bind(tokenHash, context.tenantId, context.userId, context.endpointId, toolRef,
    argumentsHash, expiresAt.toISOString(), createdAt.toISOString()).run();
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function consumeConfirmationToken(
  env: Env,
  context: WRequestContext,
  toolRef: string,
  argumentsHash: string,
  token: string,
): Promise<boolean> {
  if (!token) return false;
  await ensureWGatewaySchema(env);
  const db = wDatabase(env);
  const tokenHash = await sha256Base64Url(token);
  const now = new Date().toISOString();
  const row = await db.prepare(
    `SELECT t.token_hash FROM w_confirmation_tokens t
     JOIN w_confirmation_approvals a ON a.token_hash = t.token_hash
     WHERE t.token_hash = ? AND t.tenant_id = ? AND t.user_id = ? AND t.endpoint_id = ?
       AND t.tool_ref = ? AND t.arguments_hash = ? AND t.used_at IS NULL AND t.expires_at >= ?
       AND a.approved_at IS NOT NULL`,
  ).bind(tokenHash, context.tenantId, context.userId, context.endpointId, toolRef, argumentsHash, now)
    .first<{ token_hash: string }>();
  if (!row) return false;
  const result = await db.prepare(
    "UPDATE w_confirmation_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL",
  ).bind(now, tokenHash).run();
  return Boolean(result.meta.changes);
}

export async function openConfirmationApproval(
  env: Env,
  token: string,
): Promise<{ browserNonce: string; toolRef: string; expiresAt: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,300}$/u.test(token)) return null;
  await ensureWGatewaySchema(env);
  const db = wDatabase(env);
  const tokenHash = await sha256Base64Url(token);
  const now = new Date().toISOString();
  const pending = await db.prepare(
    `SELECT tool_ref, expires_at FROM w_confirmation_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at >= ?
       AND NOT EXISTS (
         SELECT 1 FROM w_confirmation_approvals
         WHERE token_hash = w_confirmation_tokens.token_hash AND approved_at IS NOT NULL
       )`,
  ).bind(tokenHash, now).first<{ tool_ref: string; expires_at: string }>();
  if (!pending) return null;
  const browserNonce = randomToken();
  const browserNonceHash = await sha256Base64Url(browserNonce);
  await db.prepare(
    `INSERT INTO w_confirmation_approvals (token_hash, browser_nonce_hash, approved_at, created_at)
     VALUES (?, ?, NULL, ?)
     ON CONFLICT(token_hash) DO UPDATE SET browser_nonce_hash = excluded.browser_nonce_hash,
       approved_at = NULL, created_at = excluded.created_at`,
  ).bind(tokenHash, browserNonceHash, now).run();
  return { browserNonce, toolRef: pending.tool_ref, expiresAt: pending.expires_at };
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
