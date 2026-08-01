import { randomToken, sha256Base64Url } from "../crypto";
import { redactSensitiveText } from "../security";
import { MODEL_PROFILES } from "../tools/ai";
import type { Env } from "../types";
import { cosineSimilarity, extractVectors, vectorFromBlob, vectorNorm } from "./embeddings";
import { applyRequestFilters, loadPolicy } from "./policy";
import { catalogRevision, ensureWGatewaySchema, wDatabase } from "./schema";
import type { CapabilityKind, WRequestContext, WSearchCandidate, WToolRecord, WVectorRow } from "./types";

const SEARCH_TTL_MS = 10 * 60 * 1000;
const EMBEDDING_CACHE = new Map<string, { expiresAt: number; vector: Float32Array; model: string }>();

export interface WSearchInput {
  query: string;
  limit?: number;
  filters?: {
    kinds?: CapabilityKind[];
    connected_only?: boolean;
    read_only?: boolean;
    plugin_ids?: string[];
    target?: string;
  };
}

export async function wSearch(env: Env, context: WRequestContext, input: WSearchInput) {
  const started = Date.now();
  await ensureWGatewaySchema(env);
  const db = wDatabase(env);
  const revision = await catalogRevision(env);
  const limit = Math.max(1, Math.min(20, Math.trunc(input.limit || 8)));
  const query = normalizeQuery(redactSensitiveText(input.query || ""));
  const filters = input.filters || {};
  const policy = await loadPolicy(env, context, "discover");
  if (!query) return pluginOverview(env, context, policy, revision, limit, filters);

  const allRows = await loadPublishedTools(env, context, 10_000);
  const allowed = allRows.filter((tool) => applyRequestFilters(policy, tool, filters));
  const allowedById = new Map(allowed.map((tool) => [tool.id, tool]));
  const queryTerms = terms(query);
  const explicitPlugins = new Set(filters.plugin_ids || []);
  for (const tool of allowed) if (queryTerms.includes(tool.plugin_id.toLowerCase())) explicitPlugins.add(tool.plugin_id);
  const lexical = await lexicalCandidates(env, query, allowedById);
  const semantic = await semanticCandidates(env, context, query, allowedById, explicitPlugins);

  const merged = new Map<string, WSearchCandidate>();
  for (const tool of allowed) {
    const exactScore = exactScoreFor(tool, query, queryTerms);
    if (exactScore <= 0 && !lexical.has(tool.id) && !semantic.scores.has(tool.id)) continue;
    const lexicalScore = lexical.get(tool.id) || 0;
    const semanticScore = semantic.scores.get(tool.id) || 0;
    const availabilityScore = tool.connection_type ? (tool.connected ? 1 : 0) : 1;
    const historicalSuccessScore = Number.isFinite(tool.historical_success) ? Number(tool.historical_success) : 0.5;
    const score = clamp01(
      0.50 * semanticScore +
      0.25 * lexicalScore +
      0.10 * exactScore +
      0.10 * availabilityScore +
      0.05 * historicalSuccessScore,
    );
    merged.set(tool.id, { ...tool, exactScore, lexicalScore, semanticScore, availabilityScore, historicalSuccessScore, score });
  }
  const ranked = [...merged.values()].sort((left, right) => right.score - left.score || left.tool_ref.localeCompare(right.tool_ref));
  const diverse = diversify(ranked, limit, explicitPlugins);
  const searchId = `ws_${randomToken(18)}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SEARCH_TTL_MS);
  await db.batch([
    db.prepare(
      `INSERT INTO w_search_sessions
         (id, tenant_id, user_id, endpoint_id, catalog_revision, tool_refs_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(searchId, context.tenantId, context.userId, context.endpointId, revision,
      JSON.stringify(diverse.map((item) => item.tool_ref)), createdAt.toISOString(), expiresAt.toISOString()),
    db.prepare(
      `INSERT INTO w_search_events
         (id, tenant_id, user_id, endpoint_id, query_hash, query_text_redacted,
          candidates_count, returned_count, selected_tool_ref, latency_ms,
          embedding_model, reranker_used, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, 0, ?)`,
    ).bind(`wse_${randomToken(18)}`, context.tenantId, context.userId, context.endpointId,
      await sha256Base64Url(query), merged.size, diverse.length, Date.now() - started,
      semantic.model || null, createdAt.toISOString()),
  ]);
  return {
    search_id: searchId,
    catalog_revision: revision,
    results: diverse.map(searchResultView),
    expires_at: expiresAt.toISOString(),
  };
}

async function pluginOverview(
  env: Env,
  context: WRequestContext,
  policy: Awaited<ReturnType<typeof loadPolicy>>,
  revision: number,
  limit: number,
  filters: WSearchInput["filters"],
) {
  const tools = (await loadPublishedTools(env, context, 10_000)).filter((tool) => applyRequestFilters(policy, tool, filters || {}));
  const grouped = new Map<string, { plugin_id: string; name: string; description: string; connected: boolean; tools: number; kinds: Set<string> }>();
  for (const tool of tools) {
    const item = grouped.get(tool.plugin_id) || {
      plugin_id: tool.plugin_id,
      name: tool.plugin_name,
      description: tool.plugin_description,
      connected: !tool.connection_type || Boolean(tool.connected),
      tools: 0,
      kinds: new Set<string>(),
    };
    item.tools += 1;
    item.connected ||= !tool.connection_type || Boolean(tool.connected);
    item.kinds.add(tool.capability_kind);
    grouped.set(tool.plugin_id, item);
  }
  const results = [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name)).slice(0, limit).map((item) => ({
    plugin_id: item.plugin_id,
    title: item.name,
    summary: item.description,
    connected: item.connected,
    callable_tools: item.tools,
    kinds: [...item.kinds].sort(),
  }));
  const searchId = `ws_${randomToken(18)}`;
  const now = new Date();
  await wDatabase(env).prepare(
    `INSERT INTO w_search_sessions
       (id, tenant_id, user_id, endpoint_id, catalog_revision, tool_refs_json, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`,
  ).bind(searchId, context.tenantId, context.userId, context.endpointId, revision,
    now.toISOString(), new Date(now.getTime() + SEARCH_TTL_MS).toISOString()).run();
  return { search_id: searchId, catalog_revision: revision, plugins: results, expires_at: new Date(now.getTime() + SEARCH_TTL_MS).toISOString() };
}

export async function loadPublishedTools(env: Env, context: WRequestContext, limit: number): Promise<WToolRecord[]> {
  return queryPublishedTools(env, context, "", [], limit);
}

export async function loadPublishedToolsByRefs(
  env: Env,
  context: WRequestContext,
  toolRefs: string[],
): Promise<WToolRecord[]> {
  const refs = [...new Set(toolRefs)].slice(0, 10);
  if (!refs.length) return [];
  return queryPublishedTools(
    env,
    context,
    `AND t.tool_ref IN (${refs.map(() => "?").join(",")})`,
    refs,
    refs.length,
  );
}

async function queryPublishedTools(
  env: Env,
  context: WRequestContext,
  additionalWhere: string,
  values: unknown[],
  limit: number,
): Promise<WToolRecord[]> {
  await ensureWGatewaySchema(env);
  const rows = await wDatabase(env).prepare(
    `SELECT
       t.*,
       c.capability_id AS capability_key,
       c.kind AS capability_kind,
       c.title AS capability_title,
       c.description AS capability_description,
       c.target AS capability_target,
       c.plugin_version_id,
       p.id AS plugin_id,
       p.name AS plugin_name,
       p.description AS plugin_description,
       p.enabled AS plugin_enabled,
       CASE WHEN t.connection_type IS NULL THEN 1
         WHEN EXISTS (
           SELECT 1 FROM w_connections wc
           WHERE wc.plugin_id = p.id AND wc.connection_type = t.connection_type
             AND wc.tenant_id = ? AND (wc.user_id IS NULL OR wc.user_id = ?)
             AND wc.status = 'active' AND (wc.expires_at IS NULL OR wc.expires_at >= ?)
             AND NOT EXISTS (
               SELECT 1 FROM json_each(COALESCE(t.required_scopes_json, '[]')) required
               WHERE CAST(required.value AS TEXT) NOT IN (
                 SELECT CAST(granted.value AS TEXT)
                 FROM json_each(COALESCE(wc.granted_scopes_json, '[]')) granted
               )
             )
         ) THEN 1 ELSE 0 END AS connected,
       COALESCE((
         SELECT AVG(CASE WHEN we.status = 'completed' THEN 1.0 ELSE 0.0 END)
         FROM w_execution_events we WHERE we.tool_ref = t.tool_ref
       ), 0.5) AS historical_success
     FROM w_tools t
     JOIN w_capabilities c ON c.id = t.capability_id AND c.enabled = 1
     JOIN w_plugin_versions pv ON pv.id = c.plugin_version_id AND pv.status = 'published'
     JOIN w_plugins p ON p.id = pv.plugin_id AND p.current_version_id = pv.id
     WHERE t.enabled = 1 AND t.status = 'published' AND p.enabled = 1 ${additionalWhere}
     ORDER BY t.tool_ref
     LIMIT ?`,
  ).bind(context.tenantId, context.userId, new Date().toISOString(), ...values,
    Math.max(1, Math.min(50_000, limit))).all<WToolRecord>();
  return rows.results || [];
}

async function lexicalCandidates(env: Env, query: string, allowed: Map<string, WToolRecord>): Promise<Map<string, number>> {
  const expression = ftsExpression(query);
  if (!expression) return new Map();
  try {
    const rows = await wDatabase(env).prepare(
      `SELECT t.id, bm25(w_tool_fts, 0.0, 0.0, 0.0, 8.0, 4.0, 2.0, 1.0) AS rank
       FROM w_tool_fts
       JOIN w_tools t ON t.tool_ref = w_tool_fts.tool_ref
       WHERE w_tool_fts MATCH ?
       ORDER BY rank
       LIMIT 100`,
    ).bind(expression).all<{ id: string; rank: number }>();
    const visibleRows = (rows.results || []).filter((row) => allowed.has(row.id));
    const relevance = visibleRows.map((row) => Math.max(0, -(Number(row.rank) || 0)));
    const strongest = Math.max(...relevance, 0);
    return new Map(visibleRows.map((row, index) => [
      row.id,
      strongest > 0 ? relevance[index] / strongest : 0,
    ]));
  } catch {
    const queryTerms = terms(query);
    return new Map([...allowed.values()].map((tool) => {
      const haystack = `${tool.title} ${tool.description} ${tool.search_text}`.toLowerCase();
      const hits = queryTerms.filter((term) => haystack.includes(term)).length;
      return [tool.id, queryTerms.length ? hits / queryTerms.length : 0] as const;
    }).filter(([, score]) => score > 0));
  }
}

async function semanticCandidates(
  env: Env,
  context: WRequestContext,
  query: string,
  allowed: Map<string, WToolRecord>,
  explicitPlugins: Set<string>,
): Promise<{ scores: Map<string, number>; model: string | null }> {
  if (!env.AI || !allowed.size) return { scores: new Map(), model: null };
  const model = String(env.W_EMBEDDING_MODEL || MODEL_PROFILES.embedding);
  const permissionScopeHash = await sha256Base64Url(`${context.endpointId}:${[...allowed.keys()].sort().join(",")}`);
  const cacheKey = `${model}:${permissionScopeHash}:${query}`;
  let cached = EMBEDDING_CACHE.get(cacheKey);
  if (!cached || cached.expiresAt < Date.now()) {
    const response = await env.AI.run(model, { text: query });
    const vector = Float32Array.from(extractVectors(response)[0] || []);
    if (!vector.length) return { scores: new Map(), model };
    cached = { expiresAt: Date.now() + SEARCH_TTL_MS, vector, model };
    pruneEmbeddingCache();
    EMBEDDING_CACHE.set(cacheKey, cached);
  }
  const queryNorm = vectorNorm(cached.vector);
  const clusters = await wDatabase(env).prepare(
    `SELECT id, centroid_blob, embedding_dimensions, centroid_norm
     FROM w_vector_clusters WHERE embedding_model = ? AND embedding_dimensions = ?`,
  ).bind(model, cached.vector.length).all<{
    id: number;
    centroid_blob: ArrayBuffer | Uint8Array | number[];
    embedding_dimensions: number;
    centroid_norm: number;
  }>();
  const clusterIds = (clusters.results || [])
    .map((row) => ({
      id: row.id,
      score: cosineSimilarity(cached.vector, vectorFromBlob(row.centroid_blob, row.embedding_dimensions), queryNorm, row.centroid_norm),
    }))
    .sort((left, right) => right.score - left.score || left.id - right.id)
    .slice(0, 4)
    .map((row) => row.id);
  const clusterClause = clusterIds.length ? ` AND v.cluster_id IN (${clusterIds.map(() => "?").join(",")})` : "";
  const clusteredRows = await wDatabase(env).prepare(
    `SELECT v.* FROM w_tool_vectors v
     JOIN w_tools t ON t.id = v.tool_id
     WHERE v.embedding_model = ? AND t.enabled = 1${clusterClause}
     ORDER BY v.tool_id
     LIMIT 2000`,
  ).bind(model, ...clusterIds).all<WVectorRow>();
  const explicitRows = explicitPlugins.size
    ? await wDatabase(env).prepare(
      `SELECT v.* FROM w_tool_vectors v
       JOIN w_tools t ON t.id = v.tool_id
       JOIN w_capabilities c ON c.id = t.capability_id
       JOIN w_plugin_versions pv ON pv.id = c.plugin_version_id
       WHERE v.embedding_model = ? AND t.enabled = 1
         AND pv.plugin_id IN (${[...explicitPlugins].map(() => "?").join(",")})
       ORDER BY v.tool_id LIMIT 400`,
    ).bind(model, ...explicitPlugins).all<WVectorRow>()
    : { results: [] as WVectorRow[] };
  const vectorRows = new Map<string, WVectorRow>();
  for (const row of [...(explicitRows.results || []), ...(clusteredRows.results || [])]) vectorRows.set(row.tool_id, row);
  const scores = new Map<string, number>();
  let allowedVectors = 0;
  for (const row of vectorRows.values()) {
    if (!allowed.has(row.tool_id)) continue;
    if (allowedVectors >= 400) break;
    const vector = vectorFromBlob(row.embedding_blob, row.embedding_dimensions);
    scores.set(row.tool_id, clamp01((cosineSimilarity(cached.vector, vector, queryNorm, row.embedding_norm) + 1) / 2));
    allowedVectors += 1;
  }
  return { scores, model };
}

function searchResultView(item: WSearchCandidate) {
  return {
    tool_ref: item.tool_ref,
    plugin_id: item.plugin_id,
    capability_id: item.capability_key,
    kind: item.capability_kind,
    title: item.title,
    summary: item.description,
    score: Number(item.score.toFixed(4)),
    connected: !item.connection_type || Boolean(item.connected),
    read_only: Boolean(item.read_only),
    destructive: Boolean(item.destructive),
    requires_confirmation: Boolean(item.requires_confirmation),
    schema_available: true,
  };
}

function diversify(candidates: WSearchCandidate[], limit: number, explicitPlugins: Set<string>): WSearchCandidate[] {
  const selected: WSearchCandidate[] = [];
  const pluginCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  const methodVersions = new Set<string>();
  for (const candidate of candidates) {
    const methodKey = `${candidate.plugin_id}:${candidate.capability_key}/${candidate.method_name}`;
    if (methodVersions.has(methodKey)) continue;
    if (!explicitPlugins.has(candidate.plugin_id) && (pluginCounts.get(candidate.plugin_id) || 0) >= 3) continue;
    const family = candidate.semantic_family || methodKey;
    if (!explicitPlugins.has(candidate.plugin_id) && (familyCounts.get(family) || 0) >= 2) continue;
    selected.push(candidate);
    methodVersions.add(methodKey);
    pluginCounts.set(candidate.plugin_id, (pluginCounts.get(candidate.plugin_id) || 0) + 1);
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

function exactScoreFor(tool: WToolRecord, query: string, queryTerms: string[]): number {
  const normalized = query.toLowerCase();
  if (tool.tool_ref.toLowerCase() === normalized) return 1;
  if (tool.plugin_id.toLowerCase() === normalized || tool.method_name.toLowerCase() === normalized) return 1;
  if (normalized.includes(tool.plugin_id.toLowerCase()) || normalized.includes(tool.method_name.replaceAll("_", " ").toLowerCase())) return 0.85;
  const titleTerms = terms(`${tool.title} ${tool.description}`);
  const matches = queryTerms.filter((term) => titleTerms.includes(term)).length;
  return queryTerms.length ? Math.min(0.75, matches / queryTerms.length) : 0;
}

function ftsExpression(query: string): string {
  return terms(query).slice(0, 16).map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/gu, " ").slice(0, 2_000);
}

function terms(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_:@.-]+/gu) || [])];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function pruneEmbeddingCache(): void {
  const now = Date.now();
  for (const [key, value] of EMBEDDING_CACHE) if (value.expiresAt < now) EMBEDDING_CACHE.delete(key);
  while (EMBEDDING_CACHE.size >= 200) EMBEDDING_CACHE.delete(EMBEDDING_CACHE.keys().next().value as string);
}
