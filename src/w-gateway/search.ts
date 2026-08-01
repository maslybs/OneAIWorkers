import { randomToken, sha256Base64Url } from "../crypto";
import { cloudTarget, fetchMarketplaceCatalog } from "../marketplace";
import { redactSensitiveText } from "../security";
import { MODEL_PROFILES } from "../tools/ai";
import type { Env } from "../types";
import { semanticPluginThreshold } from "./config";
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
  const exact = new Map(allowed.map((tool) => [tool.id, exactScoreFor(tool, query, queryTerms)]));
  const pluginCount = new Set(allowed.map((tool) => tool.plugin_id)).size;
  const useSemantic = pluginCount >= semanticPluginThreshold(env) && !simpleSearchIsConfident(allowed, exact, lexical);
  const semantic = useSemantic
    ? await semanticCandidates(env, context, query, allowedById, explicitPlugins)
    : { scores: new Map<string, number>(), model: null };
  const semanticUsed = semantic.model !== null;

  const merged = new Map<string, WSearchCandidate>();
  for (const tool of allowed) {
    const exactScore = exact.get(tool.id) || 0;
    if (exactScore <= 0 && !lexical.has(tool.id) && !semantic.scores.has(tool.id)) continue;
    const lexicalScore = lexical.get(tool.id) || 0;
    const semanticScore = semantic.scores.get(tool.id) || 0;
    const availabilityScore = tool.connection_type ? (tool.connected ? 1 : 0) : 1;
    const historicalSuccessScore = Number.isFinite(tool.historical_success) ? Number(tool.historical_success) : 0.5;
    const score = semanticUsed
      ? clamp01(
        0.45 * semanticScore +
        0.30 * lexicalScore +
        0.15 * exactScore +
        0.07 * availabilityScore +
        0.03 * historicalSuccessScore,
      )
      : clamp01(
        0.50 * exactScore +
        0.35 * lexicalScore +
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
    search_mode: semanticUsed ? "hybrid" : "text",
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
  const grouped = new Map<string, {
    plugin_id: string;
    name: string;
    description: string;
    connected: boolean;
    tools: number;
    kinds: Set<string>;
    capabilities: Map<string, { capability_id: string; title: string; summary: string; tools: number }>;
  }>();
  for (const tool of tools) {
    const item = grouped.get(tool.plugin_id) || {
      plugin_id: tool.plugin_id,
      name: tool.plugin_name,
      description: tool.plugin_description,
      connected: !tool.connection_type || Boolean(tool.connected),
      tools: 0,
      kinds: new Set<string>(),
      capabilities: new Map(),
    };
    item.tools += 1;
    item.connected ||= !tool.connection_type || Boolean(tool.connected);
    item.kinds.add(tool.capability_kind);
    const capability = item.capabilities.get(tool.capability_key) || {
      capability_id: tool.capability_key,
      title: tool.capability_title,
      summary: tool.capability_description,
      tools: 0,
    };
    capability.tools += 1;
    item.capabilities.set(tool.capability_key, capability);
    grouped.set(tool.plugin_id, item);
  }
  const results = [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name)).slice(0, limit).map((item) => ({
    plugin_id: item.plugin_id,
    title: item.name,
    summary: item.description,
    connected: item.connected,
    callable_tools: item.tools,
    kinds: [...item.kinds].sort(),
    capabilities: [...item.capabilities.values()].sort((left, right) => left.title.localeCompare(right.title)),
  }));
  const marketplace = await marketplaceOverview(env, context, grouped);
  const searchId = `ws_${randomToken(18)}`;
  const now = new Date();
  await wDatabase(env).prepare(
    `INSERT INTO w_search_sessions
       (id, tenant_id, user_id, endpoint_id, catalog_revision, tool_refs_json, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`,
  ).bind(searchId, context.tenantId, context.userId, context.endpointId, revision,
    now.toISOString(), new Date(now.getTime() + SEARCH_TTL_MS).toISOString()).run();
  return {
    search_id: searchId,
    catalog_revision: revision,
    system: results.find((item) => item.plugin_id === "oneaiworkers") || null,
    installed_plugins: results.filter((item) => item.plugin_id !== "oneaiworkers"),
    plugins: results,
    marketplace,
    available_actions: {
      install_plugins: marketplace.reachable,
      update_plugins: marketplace.reachable,
      change_plugin_settings: true,
      verify_plugin_connections: true,
      instruction: "Use the exact marketplace install_url to install. For an installed plugin, search for its settings or update operation with w_search. / Для встановлення використайте точний install_url з ринку. Для встановленого плагіна знайдіть його дію налаштування або оновлення через w_search.",
    },
    guidance: marketplace.reachable
      ? "The list below comes from the live marketplace. Offer these exact plugins and installation links; do not invent unavailable plugins. Service keys are entered only on the protected OneAIWorkers page. / Список нижче отримано з живого ринку. Пропонуйте лише ці точні плагіни та посилання встановлення; не вигадуйте недоступні плагіни. Ключі сервісів вводяться лише на захищеній сторінці OneAIWorkers."
      : "The marketplace could not be reached. Do not claim that a plugin is available until a later live check succeeds. / Не вдалося зв’язатися з ринком. Не стверджуйте, що плагін доступний, доки наступна жива перевірка не буде успішною.",
    expires_at: new Date(now.getTime() + SEARCH_TTL_MS).toISOString(),
  };
}

async function marketplaceOverview(
  env: Env,
  context: WRequestContext,
  installedPlugins: Map<string, unknown>,
) {
  try {
    const [items, installedRows] = await Promise.all([
      fetchMarketplaceCatalog(env),
      wDatabase(env).prepare("SELECT connector_id, package_id, installed_version FROM connector_packages ORDER BY package_id")
        .all<{ connector_id: string; package_id: string; installed_version: string }>(),
    ]);
    const installedPackages = new Map((installedRows.results || []).map((row) => [row.package_id, row]));
    const plugins = items.flatMap((item) => {
      const target = cloudTarget(item);
      if (!target) return [];
      const installedPackage = installedPackages.get(item.id);
      const installedId = installedPackage?.connector_id || (installedPlugins.has(item.id) ? item.id : null);
      const updateAvailable = Boolean(installedPackage && compareSimpleVersions(target.version, installedPackage.installed_version) > 0);
      return [{
        plugin_id: item.id,
        name: item.name,
        name_uk: item.locales?.uk?.name || item.name,
        summary: item.description,
        summary_uk: item.locales?.uk?.description || item.description,
        version: target.version,
        installed: Boolean(installedId),
        installed_plugin_id: installedId,
        installed_version: installedPackage?.installed_version || null,
        update_available: updateAvailable,
        update_url: updateAvailable && installedId
          ? `${context.baseUrl}/plugins/${encodeURIComponent(installedId)}/update`
          : null,
        capabilities: (item.capabilities || []).slice(0, 8),
        install_url: `${context.baseUrl}/plugins/install/${encodeURIComponent(item.id)}?lang=en`,
        install_url_uk: `${context.baseUrl}/plugins/install/${encodeURIComponent(item.id)}?lang=uk`,
      }];
    });
    return {
      reachable: true,
      source: "live_marketplace",
      available_plugins: plugins.length,
      plugins,
    };
  } catch (error) {
    return {
      reachable: false,
      source: "live_marketplace",
      available_plugins: 0,
      plugins: [],
      error: redactSensitiveText(error instanceof Error ? error.message : "Marketplace is unavailable."),
    };
  }
}

function compareSimpleVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
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
  if (!await hasAllowedVectors(env, model, allowed)) return { scores: new Map(), model: null };
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
  const pluginId = tool.plugin_id.toLowerCase();
  const pluginName = tool.plugin_name.toLowerCase();
  const method = tool.method_name.toLowerCase();
  const methodPhrase = method.replaceAll("_", " ").replaceAll(".", " ");
  if (tool.tool_ref.toLowerCase() === normalized) return 1;
  if (pluginId === normalized || pluginName === normalized || method === normalized || methodPhrase === normalized) return 1;
  if (containsPhrase(normalized, method) || containsPhrase(normalized, methodPhrase)) return 0.92;
  const titleTerms = terms(`${tool.title} ${tool.description}`);
  const matches = queryTerms.filter((term) => titleTerms.includes(term)).length;
  const textScore = queryTerms.length ? Math.min(0.75, matches / queryTerms.length) : 0;
  const pluginScore = queryTerms.includes(pluginId) || containsPhrase(normalized, pluginName) ? 0.25 : 0;
  return Math.max(textScore, pluginScore);
}

function simpleSearchIsConfident(
  tools: WToolRecord[],
  exact: Map<string, number>,
  lexical: Map<string, number>,
): boolean {
  const ranked = tools.map((tool) => ({
    exact: exact.get(tool.id) || 0,
    lexical: lexical.get(tool.id) || 0,
  })).sort((left, right) => (right.exact + right.lexical) - (left.exact + left.lexical));
  const best = ranked[0];
  const second = ranked[1];
  if (!best) return false;
  if (best.exact >= 0.9) return true;
  const lead = best.exact + best.lexical - ((second?.exact || 0) + (second?.lexical || 0));
  return best.exact >= 0.7 && best.lexical >= 0.8 && lead >= 0.2;
}

async function hasAllowedVectors(env: Env, model: string, allowed: Map<string, WToolRecord>): Promise<boolean> {
  const ids = [...allowed.keys()];
  for (let offset = 0; offset < ids.length; offset += 400) {
    const chunk = ids.slice(offset, offset + 400);
    const row = await wDatabase(env).prepare(
      `SELECT v.tool_id FROM w_tool_vectors v
       JOIN w_tools t ON t.id = v.tool_id
       WHERE v.embedding_model = ? AND t.enabled = 1
         AND v.tool_id IN (${chunk.map(() => "?").join(",")})
       LIMIT 1`,
    ).bind(model, ...chunk).first<{ tool_id: string }>();
    if (row?.tool_id) return true;
  }
  return false;
}

function containsPhrase(value: string, phrase: string): boolean {
  if (!phrase) return false;
  return ` ${value.replace(/[^\p{L}\p{N}_:@.-]+/gu, " ")} `.includes(` ${phrase} `);
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
