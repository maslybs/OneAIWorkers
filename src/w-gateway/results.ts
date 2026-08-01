import { randomToken, sha256Base64Url } from "../crypto";
import type { Env } from "../types";
import { ensureWGatewaySchema, wDatabase } from "./schema";
import type { WRequestContext, WStoredResultRow } from "./types";

const LARGE_RESULT_CHARS = 24_000;
const RESULT_TTL_MS = 10 * 60 * 1000;
const MAX_D1_RESULT_CHARS = 1_500_000;

export async function normalizeExecutionResult(env: Env, context: WRequestContext, value: unknown): Promise<unknown> {
  const serialized = JSON.stringify(value);
  if (serialized.length <= LARGE_RESULT_CHARS) return value;
  await ensureWGatewaySchema(env);
  const db = wDatabase(env);
  const id = `wres_${randomToken(18)}`;
  const storageKey = `w-results/${context.tenantId}/${id}.json`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + RESULT_TTL_MS);
  let storageType: "r2" | "d1" = "d1";
  if (env.W_RESULTS_BUCKET) {
    await env.W_RESULTS_BUCKET.put(storageKey, serialized, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { expires_at: expiresAt.toISOString() },
    });
    storageType = "r2";
  } else {
    if (serialized.length > MAX_D1_RESULT_CHARS) {
      throw new Error("The result is too large for D1 fallback storage. Configure W_RESULTS_BUCKET.");
    }
    await db.prepare("INSERT INTO w_result_payloads (storage_key, payload_json) VALUES (?, ?)")
      .bind(storageKey, serialized).run();
  }
  await db.prepare(
    `INSERT INTO w_result_refs
       (id, tenant_id, user_id, endpoint_id, session_id, content_type, storage_type,
        storage_key, original_chars, content_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 'application/json', ?, ?, ?, ?, ?, ?)`,
  ).bind(id, context.tenantId, context.userId, context.endpointId, context.sessionId,
    storageType, storageKey, serialized.length, await sha256Base64Url(serialized),
    createdAt.toISOString(), expiresAt.toISOString()).run();
  return {
    result_id: id,
    truncated: true,
    original_chars: serialized.length,
    preview: compactPreview(value),
    expires_at: expiresAt.toISOString(),
    next_step: "Use w_result_read with result_id to read only the needed part.",
  };
}

export async function readStoredResult(
  env: Env,
  context: WRequestContext,
  input: { result_id: string; pointer?: string; offset?: number; limit?: number },
) {
  await ensureWGatewaySchema(env);
  const db = wDatabase(env);
  const row = await db.prepare(
    `SELECT * FROM w_result_refs
     WHERE id = ? AND tenant_id = ? AND user_id = ? AND endpoint_id = ?
       AND (session_id IS NULL OR session_id = ?) AND expires_at >= ?`,
  ).bind(input.result_id, context.tenantId, context.userId, context.endpointId,
    context.sessionId, new Date().toISOString()).first<WStoredResultRow>();
  if (!row) return { ok: false, error: { code: "result_unavailable", message: "The result is expired or belongs to another session." } };
  const serialized = await loadPayload(env, row);
  const value = JSON.parse(serialized) as unknown;
  const selected = input.pointer ? resolveJsonPointer(value, input.pointer) : value;
  const offset = Math.max(0, Math.trunc(input.offset || 0));
  const limit = Math.max(1, Math.min(50, Math.trunc(input.limit || 25)));
  if (Array.isArray(selected)) {
    return {
      ok: true,
      result_id: row.id,
      pointer: input.pointer || "",
      offset,
      limit,
      total: selected.length,
      ...boundedReadData(selected.slice(offset, offset + limit).map(compactScalar)),
    };
  }
  if (typeof selected === "string") {
    const charLimit = Math.min(12_000, limit * 240);
    return { ok: true, result_id: row.id, pointer: input.pointer || "", offset, limit: charLimit, total: selected.length, data: selected.slice(offset, offset + charLimit) };
  }
  return { ok: true, result_id: row.id, pointer: input.pointer || "", ...boundedReadData(compactScalar(selected)) };
}

async function loadPayload(env: Env, row: WStoredResultRow): Promise<string> {
  if (row.storage_type === "r2") {
    if (!env.W_RESULTS_BUCKET) throw new Error("W_RESULTS_BUCKET is not configured.");
    const object = await env.W_RESULTS_BUCKET.get(row.storage_key);
    if (!object) throw new Error("Stored result payload is unavailable.");
    return object.text();
  }
  const payload = await wDatabase(env).prepare("SELECT payload_json FROM w_result_payloads WHERE storage_key = ?")
    .bind(row.storage_key).first<{ payload_json: string }>();
  if (!payload) throw new Error("Stored result payload is unavailable.");
  return payload.payload_json;
}

function compactPreview(value: unknown): unknown {
  if (Array.isArray(value)) return compactArray(value);
  if (!isRecord(value)) return typeof value === "string" ? value.slice(0, 12_000) : value;
  const priority = ["id", "name", "title", "status", "state", "ok", "success", "error", "warning", "message", "summary", "description", "path", "url", "count", "total", "items", "results", "data", "nodes", "edges"];
  const entries = Object.entries(value);
  const ordered = [...entries].sort(([left], [right]) => {
    const a = priority.indexOf(left); const b = priority.indexOf(right);
    return (a < 0 ? 999 : a) - (b < 0 ? 999 : b);
  }).slice(0, 24);
  return Object.fromEntries(ordered.map(([key, item]) => [key, Array.isArray(item) ? compactArray(item) : compactScalar(item)]));
}

function compactArray(value: unknown[]): unknown[] {
  const important = value.filter((item) => isRecord(item) && ["error", "warning", "failure", "failed"].includes(String(item.status || item.state || "").toLowerCase()));
  const selected = [...value.slice(0, 6), ...important, ...value.slice(-2)];
  const unique = [...new Set(selected)].slice(0, 16);
  return unique.map(compactScalar);
}

function compactScalar(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 2_000);
  if (Array.isArray(value)) return compactArray(value);
  if (isRecord(value)) return compactPreview(value);
  return value;
}

function boundedReadData(value: unknown): { data: unknown; truncated?: boolean; preview_format?: string } {
  const serialized = JSON.stringify(value);
  if (serialized.length <= 12_000) return { data: value };
  return {
    data: serialized.slice(0, 12_000),
    truncated: true,
    preview_format: "truncated_json_text",
  };
}

function resolveJsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  if (!pointer.startsWith("/")) throw new Error("JSON Pointer must start with '/'.");
  let current = value;
  for (const rawPart of pointer.slice(1).split("/")) {
    const part = rawPart.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      if (!/^\d+$/u.test(part)) throw new Error("JSON Pointer array segment is invalid.");
      current = current[Number(part)];
    } else if (isRecord(current) && part in current) current = current[part];
    else throw new Error("JSON Pointer does not exist in this result.");
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
