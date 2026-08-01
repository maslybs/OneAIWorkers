import { base64UrlEncode, sha256Base64Url } from "../crypto";
import { MODEL_PROFILES } from "../tools/ai";
import type { Env } from "../types";
import { ensureWGatewaySchema, wDatabase } from "./schema";
import type { WVectorRow } from "./types";

const EMBEDDING_BATCH = 16;
const MAX_JOBS_PER_RUN = 64;

export async function processEmbeddingJobs(env: Env, limit = MAX_JOBS_PER_RUN): Promise<{
  completed: number;
  failed: number;
  pending: number;
  model: string;
}> {
  await ensureWGatewaySchema(env);
  const db = wDatabase(env);
  const model = String(env.W_EMBEDDING_MODEL || MODEL_PROFILES.embedding);
  const jobs = await db.prepare(
    `SELECT j.id AS job_id, j.tool_id, j.attempts, t.search_text, t.search_text_hash
     FROM w_embedding_jobs j
     JOIN w_tools t ON t.id = j.tool_id
     WHERE j.status IN ('queued', 'failed') AND j.attempts < 3 AND t.enabled = 1
     ORDER BY j.created_at
     LIMIT ?`,
  ).bind(Math.max(1, Math.min(MAX_JOBS_PER_RUN, limit))).all<{
    job_id: string;
    tool_id: string;
    attempts: number;
    search_text: string;
    search_text_hash: string;
  }>();
  if (!env.AI || !(jobs.results || []).length) {
    return { completed: 0, failed: 0, pending: (jobs.results || []).length, model };
  }

  let completed = 0;
  let failed = 0;
  for (let offset = 0; offset < (jobs.results || []).length; offset += EMBEDDING_BATCH) {
    const batch = (jobs.results || []).slice(offset, offset + EMBEDDING_BATCH);
    const now = new Date().toISOString();
    await db.batch(batch.map((job) => db.prepare(
      "UPDATE w_embedding_jobs SET status = 'running', attempts = attempts + 1, started_at = ?, last_error = NULL WHERE id = ?",
    ).bind(now, job.job_id)));
    try {
      const result = await env.AI.run(model, { text: batch.map((job) => job.search_text) });
      const vectors = extractVectors(result);
      if (vectors.length !== batch.length) throw new Error("Workers AI returned an unexpected number of vectors.");
      const statements: D1PreparedStatement[] = [];
      for (let index = 0; index < batch.length; index += 1) {
        const job = batch[index];
        const vector = Float32Array.from(vectors[index]);
        const norm = vectorNorm(vector);
        if (!vector.length || !Number.isFinite(norm) || norm <= 0) throw new Error("Workers AI returned an invalid vector.");
        const bytes = new Uint8Array(vector.buffer.slice(0));
        const embeddingHash = await hashBytes(bytes);
        const finishedAt = new Date().toISOString();
        statements.push(db.prepare(
          `INSERT INTO w_tool_vectors
             (tool_id, embedding_model, embedding_dimensions, embedding_blob, embedding_norm,
              embedding_hash, source_text_hash, cluster_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
           ON CONFLICT(tool_id) DO UPDATE SET
             embedding_model = excluded.embedding_model,
             embedding_dimensions = excluded.embedding_dimensions,
             embedding_blob = excluded.embedding_blob,
             embedding_norm = excluded.embedding_norm,
             embedding_hash = excluded.embedding_hash,
             source_text_hash = excluded.source_text_hash,
             cluster_id = NULL,
             updated_at = excluded.updated_at`,
        ).bind(job.tool_id, model, vector.length, bytes, norm, embeddingHash, job.search_text_hash, finishedAt, finishedAt));
        statements.push(db.prepare(
          "UPDATE w_embedding_jobs SET status = 'completed', completed_at = ?, last_error = NULL WHERE id = ?",
        ).bind(finishedAt, job.job_id));
        completed += 1;
      }
      await db.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Embedding failed.";
      const finishedAt = new Date().toISOString();
      await db.batch(batch.map((job) => db.prepare(
        `UPDATE w_embedding_jobs
         SET status = CASE WHEN attempts >= 3 THEN 'dead_letter' ELSE 'failed' END,
             last_error = ?, completed_at = ?
         WHERE id = ?`,
      ).bind(message, finishedAt, job.job_id)));
      failed += batch.length;
    }
  }
  return { completed, failed, pending: Math.max(0, (jobs.results || []).length - completed - failed), model };
}

export async function rebuildVectorClusters(env: Env): Promise<{ clusters: number; vectors: number }> {
  await ensureWGatewaySchema(env);
  const db = wDatabase(env);
  const rows = await db.prepare(
    "SELECT * FROM w_tool_vectors ORDER BY tool_id LIMIT 50000",
  ).all<WVectorRow>();
  const vectors = rows.results || [];
  const count = vectors.length;
  const clusters = count <= 1_000 ? 16 : count <= 10_000 ? 64 : 128;
  await db.prepare("DELETE FROM w_vector_clusters").run();
  if (!count) return { clusters: 0, vectors: 0 };

  const groups = new Map<number, Float32Array[]>();
  for (const row of vectors) {
    const vector = vectorFromBlob(row.embedding_blob, row.embedding_dimensions);
    const clusterId = semanticCluster(vector, clusters);
    const group = groups.get(clusterId) || [];
    group.push(vector);
    groups.set(clusterId, group);
    await db.prepare("UPDATE w_tool_vectors SET cluster_id = ? WHERE tool_id = ?").bind(clusterId, row.tool_id).run();
  }

  for (const [clusterId, members] of groups) {
    const centroid = meanVector(members);
    const norm = vectorNorm(centroid);
    await db.prepare(
      `INSERT INTO w_vector_clusters
         (id, embedding_model, embedding_dimensions, centroid_blob, centroid_norm, tools_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(clusterId, vectors[0].embedding_model, centroid.length, new Uint8Array(centroid.buffer.slice(0)), norm, members.length, new Date().toISOString()).run();
  }
  return { clusters: groups.size, vectors: count };
}

export function extractVectors(value: unknown): number[][] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const data = Array.isArray(record.data) ? record.data : [];
  if (data.length && data.every((item) => Array.isArray(item))) return data as number[][];
  if (data.length && data.every((item) => item && typeof item === "object" && Array.isArray((item as Record<string, unknown>).embedding))) {
    return data.map((item) => (item as { embedding: number[] }).embedding);
  }
  const result = record.result;
  return result && result !== value ? extractVectors(result) : [];
}

export function vectorFromBlob(blob: ArrayBuffer | Uint8Array | number[], dimensions: number): Float32Array {
  if (Array.isArray(blob)) {
    if (blob.length === dimensions) return Float32Array.from(blob);
    return new Float32Array(Uint8Array.from(blob).buffer).slice(0, dimensions);
  }
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).slice(0, dimensions);
}

export function cosineSimilarity(left: Float32Array, right: Float32Array, leftNorm = vectorNorm(left), rightNorm = vectorNorm(right)): number {
  if (left.length !== right.length || !leftNorm || !rightNorm) return 0;
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) dot += left[index] * right[index];
  return Math.max(-1, Math.min(1, dot / (leftNorm * rightNorm)));
}

export function vectorNorm(vector: Float32Array): number {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.sqrt(sum);
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return base64UrlEncode(new Uint8Array(digest));
}

function semanticCluster(vector: Float32Array, clusters: number): number {
  if (!vector.length || clusters <= 1) return 0;
  const bits = Math.max(1, Math.ceil(Math.log2(clusters)));
  let signature = 0;
  for (let bit = 0; bit < bits; bit += 1) {
    const left = Math.floor(((bit * 2 + 1) * vector.length) / (bits * 2 + 1)) % vector.length;
    const right = Math.floor(((bit * 2 + 2) * vector.length) / (bits * 2 + 1)) % vector.length;
    if (vector[left] >= vector[right]) signature |= (1 << bit);
  }
  return signature % clusters;
}

function meanVector(vectors: Float32Array[]): Float32Array {
  const output = new Float32Array(vectors[0]?.length || 0);
  for (const vector of vectors) for (let index = 0; index < output.length; index += 1) output[index] += vector[index];
  for (let index = 0; index < output.length; index += 1) output[index] /= vectors.length;
  return output;
}
