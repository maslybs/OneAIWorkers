import { z } from "zod";
import { redactSensitiveText } from "../security";
import type { Env } from "../types";

export const DAILY_NEURON_ALLOCATION = 10_000;
export const USD_PER_1000_NEURONS = 0.011;
export const NEURON_PRICING_VERIFIED_AT = "2026-07-08";

const NEURONS_PER_USD = 1_000 / USD_PER_1000_NEURONS;
const HISTORY_MAX_LIMIT = 100;
const HISTORY_LOOKBACK_DAYS = 30;

export type BillingType = "workers_ai_neurons" | "unified_billing_usd";
export type UsageSource = "local_reported_tokens" | "local_estimated_tokens";

export interface AiUnitPricing {
  input: number;
  output?: number;
  cached_input?: number;
}

export interface NeuronTrackingContext {
  request_id?: string;
  run_id?: string;
  agent_id?: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  source: UsageSource;
}

export interface WorkersAiBilling {
  billing_type: "workers_ai_neurons";
  model: string;
  request_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number | null;
  estimated_neurons: number | null;
  actual_neurons: null;
  today_psy_neurons: number | null;
  daily_allocation: number;
  remaining_neurons: number | null;
  usage_percent: number | null;
  resets_at: string;
  source: UsageSource;
  confidence: "partial" | "low";
  account_total_available: false;
  hard_limit_observed_today: boolean | null;
  pricing_verified_at: string;
  warning: string;
  tracking_error?: string;
}

interface UsageRow {
  id: string;
  request_id: string;
  run_id: string | null;
  agent_id: string | null;
  model: string;
  billing_type: BillingType;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cached_tokens: number;
  estimated_cost_usd: number | null;
  estimated_neurons: number | null;
  source: string;
  created_at: string;
}

interface DailyAggregateRow {
  neurons_today: number | null;
  requests_today: number | null;
  reported_token_requests: number | null;
  estimated_token_requests: number | null;
  unmetered_requests: number | null;
}

interface HardLimitRow {
  count: number | null;
}

export const aiNeuronStatusSchema = {};

export const aiNeuronHistorySchema = {
  limit: z.number().int().min(1).max(HISTORY_MAX_LIMIT).default(20),
  run_id: z.string().uuid().optional(),
  model: z.string().min(1).max(200).optional(),
};

let schemaReady: Promise<void> | null = null;

export function billingTypeForModel(model: string): BillingType {
  return model.startsWith("@cf/") ? "workers_ai_neurons" : "unified_billing_usd";
}

export function neuronRatesFromPricing(pricing: AiUnitPricing | null | undefined) {
  if (!pricing) return null;
  return {
    input_per_million: roundMetric(pricing.input * NEURONS_PER_USD),
    output_per_million: pricing.output === undefined ? null : roundMetric(pricing.output * NEURONS_PER_USD),
    cached_input_per_million: roundMetric((pricing.cached_input ?? pricing.input) * NEURONS_PER_USD),
  };
}

export function calculateWorkersAiBilling(
  usage: Pick<TokenUsage, "prompt_tokens" | "completion_tokens" | "cached_tokens">,
  pricing: AiUnitPricing | null | undefined,
): { estimated_cost_usd: number | null; estimated_neurons: number | null } {
  if (!pricing) return { estimated_cost_usd: null, estimated_neurons: null };
  const cachedTokens = Math.max(0, usage.cached_tokens);
  const regularInputTokens = Math.max(0, usage.prompt_tokens - cachedTokens);
  const cost = (
    (regularInputTokens / 1_000_000) * pricing.input
    + (cachedTokens / 1_000_000) * (pricing.cached_input ?? pricing.input)
    + (Math.max(0, usage.completion_tokens) / 1_000_000) * (pricing.output ?? 0)
  );
  return {
    estimated_cost_usd: roundMetric(cost),
    estimated_neurons: roundMetric(cost * NEURONS_PER_USD),
  };
}

export function resolveTokenUsage(input: unknown, result: unknown, outputKind: "text-generation" | "embeddings" = "text-generation"): TokenUsage {
  const reported = extractReportedUsage(result);
  if (reported) return { ...reported, source: "local_reported_tokens" };

  const promptTokens = estimateTokensFromValue(input);
  const completionTokens = outputKind === "embeddings" ? 0 : estimateTokensFromResult(result);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cached_tokens: 0,
    total_tokens: promptTokens + completionTokens,
    source: "local_estimated_tokens",
  };
}

export async function runMeteredWorkersAi(
  env: Env,
  options: {
    model: string;
    input: Record<string, unknown>;
    ai_options?: Record<string, unknown>;
    pricing?: AiUnitPricing | null;
    output_kind?: "text-generation" | "embeddings";
    context?: NeuronTrackingContext;
  },
): Promise<{ result: unknown; billing: WorkersAiBilling }> {
  if (!env.AI) throw new Error("Workers AI binding is not configured.");
  const requestId = options.context?.request_id || crypto.randomUUID();
  let result: unknown;
  try {
    result = await env.AI.run(options.model, options.input, options.ai_options);
  } catch (error) {
    if (isDailyNeuronLimitError(error)) {
      await recordNeuronEvent(env, {
        event_type: "daily_limit_3036",
        code: "3036",
        message: errorMessage(error),
      });
      throw new Error(`Workers AI daily neuron allocation is exhausted (Cloudflare error 3036). ${errorMessage(error)}`);
    }
    throw error;
  }

  const usage = resolveTokenUsage(options.input, result, options.output_kind);
  const calculated = calculateWorkersAiBilling(usage, options.pricing);
  const createdAt = new Date().toISOString();
  let trackingError: string | undefined;
  try {
    await recordNeuronUsage(env, {
      id: crypto.randomUUID(),
      request_id: requestId,
      run_id: options.context?.run_id || null,
      agent_id: options.context?.agent_id || null,
      model: options.model,
      billing_type: "workers_ai_neurons",
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      cached_tokens: usage.cached_tokens,
      estimated_cost_usd: calculated.estimated_cost_usd,
      estimated_neurons: calculated.estimated_neurons,
      source: usage.source,
      created_at: createdAt,
    });
  } catch (error) {
    trackingError = errorMessage(error);
  }

  const status = await safeDailyStatus(env);
  return {
    result,
    billing: {
      billing_type: "workers_ai_neurons",
      model: options.model,
      request_id: requestId,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      cached_tokens: usage.cached_tokens,
      total_tokens: usage.total_tokens,
      estimated_cost_usd: calculated.estimated_cost_usd,
      estimated_neurons: calculated.estimated_neurons,
      actual_neurons: null,
      today_psy_neurons: status?.used_neurons ?? null,
      daily_allocation: DAILY_NEURON_ALLOCATION,
      remaining_neurons: status?.remaining_neurons ?? null,
      usage_percent: status?.usage_percent ?? null,
      resets_at: nextUtcReset(createdAt),
      source: usage.source,
      confidence: usage.source === "local_reported_tokens" ? "partial" : "low",
      account_total_available: false,
      hard_limit_observed_today: status?.hard_limit_observed_today ?? null,
      pricing_verified_at: NEURON_PRICING_VERIFIED_AT,
      warning: "Local PSY tracking includes only inference requests made through this OneAIWorkers deployment. Other Workers, dashboard calls, and external applications are not included.",
      ...(trackingError ? { tracking_error: trackingError } : {}),
    },
  };
}

export async function aiNeuronStatus(env: Env) {
  const period = utcDayPeriod();
  if (!env.OAUTH_DB) {
    return {
      configured: false,
      billing_type: "workers_ai_neurons",
      used_neurons: null,
      daily_allocation: DAILY_NEURON_ALLOCATION,
      remaining_neurons: null,
      usage_percent: null,
      requests_today: null,
      hard_limit_observed_today: null,
      period,
      source: "unavailable",
      confidence: "unavailable",
      account_total_available: false,
      warning: "D1 is not configured, so OneAIWorkers cannot persist local neuron usage.",
    };
  }

  await ensureNeuronSchema(env);
  const [aggregate, hardLimit] = await Promise.all([
    env.OAUTH_DB.prepare(
      `SELECT
         COALESCE(SUM(estimated_neurons), 0) AS neurons_today,
         COUNT(*) AS requests_today,
         SUM(CASE WHEN source = 'local_reported_tokens' THEN 1 ELSE 0 END) AS reported_token_requests,
         SUM(CASE WHEN source = 'local_estimated_tokens' THEN 1 ELSE 0 END) AS estimated_token_requests,
         SUM(CASE WHEN estimated_neurons IS NULL THEN 1 ELSE 0 END) AS unmetered_requests
       FROM ai_neuron_usage
       WHERE billing_type = 'workers_ai_neurons' AND created_at >= ? AND created_at < ?`,
    ).bind(period.starts_at, period.resets_at).first<DailyAggregateRow>(),
    env.OAUTH_DB.prepare(
      "SELECT COUNT(*) AS count FROM ai_neuron_events WHERE event_type = 'daily_limit_3036' AND created_at >= ? AND created_at < ?",
    ).bind(period.starts_at, period.resets_at).first<HardLimitRow>(),
  ]);

  const used = roundMetric(Number(aggregate?.neurons_today || 0));
  return {
    configured: true,
    billing_type: "workers_ai_neurons",
    used_neurons: used,
    daily_allocation: DAILY_NEURON_ALLOCATION,
    remaining_neurons: roundMetric(Math.max(0, DAILY_NEURON_ALLOCATION - used)),
    usage_percent: roundMetric((used / DAILY_NEURON_ALLOCATION) * 100),
    requests_today: Number(aggregate?.requests_today || 0),
    reported_token_requests: Number(aggregate?.reported_token_requests || 0),
    estimated_token_requests: Number(aggregate?.estimated_token_requests || 0),
    unmetered_requests: Number(aggregate?.unmetered_requests || 0),
    hard_limit_observed_today: Number(hardLimit?.count || 0) > 0,
    period,
    source: "local_psy_ledger",
    confidence: "partial",
    account_total_available: false,
    pricing_verified_at: NEURON_PRICING_VERIFIED_AT,
    warning: "The total covers only this OneAIWorkers deployment. Cloudflare dashboard usage may be higher if the account has other Workers AI consumers.",
  };
}

export async function aiNeuronHistory(
  env: Env,
  args: z.infer<z.ZodObject<typeof aiNeuronHistorySchema>>,
) {
  if (!env.OAUTH_DB) return { configured: false, entries: [], warning: "D1 is not configured." };
  await ensureNeuronSchema(env);
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (args.run_id) {
    conditions.push("run_id = ?");
    values.push(args.run_id);
  }
  if (args.model) {
    conditions.push("model = ?");
    values.push(args.model);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await env.OAUTH_DB.prepare(
    `SELECT id, request_id, run_id, agent_id, model, billing_type, prompt_tokens, completion_tokens,
            cached_tokens, estimated_cost_usd, estimated_neurons, source, created_at
     FROM ai_neuron_usage ${where} ORDER BY created_at DESC LIMIT ?`,
  ).bind(...values, args.limit).all<UsageRow>();
  return {
    configured: true,
    entries: rows.results || [],
    account_total_available: false,
    warning: "History contains local OneAIWorkers calls only and never stores prompts or model outputs.",
  };
}

export async function historicalTokenAverage(
  env: Env,
  model: string,
  agentId?: string,
): Promise<{ prompt_tokens: number; completion_tokens: number; samples: number } | null> {
  if (!env.OAUTH_DB) return null;
  await ensureNeuronSchema(env);
  const since = new Date(Date.now() - HISTORY_LOOKBACK_DAYS * 86_400_000).toISOString();
  const query = agentId
    ? `SELECT AVG(prompt_tokens) AS prompt_tokens, AVG(completion_tokens) AS completion_tokens, COUNT(*) AS samples
       FROM ai_neuron_usage WHERE model = ? AND agent_id = ? AND created_at >= ?`
    : `SELECT AVG(prompt_tokens) AS prompt_tokens, AVG(completion_tokens) AS completion_tokens, COUNT(*) AS samples
       FROM ai_neuron_usage WHERE model = ? AND created_at >= ?`;
  const row = agentId
    ? await env.OAUTH_DB.prepare(query).bind(model, agentId, since).first<{ prompt_tokens: number | null; completion_tokens: number | null; samples: number | null }>()
    : await env.OAUTH_DB.prepare(query).bind(model, since).first<{ prompt_tokens: number | null; completion_tokens: number | null; samples: number | null }>();
  if (!row || Number(row.samples || 0) < 1) return null;
  return {
    prompt_tokens: Math.max(1, Math.round(Number(row.prompt_tokens || 0))),
    completion_tokens: Math.max(0, Math.round(Number(row.completion_tokens || 0))),
    samples: Number(row.samples || 0),
  };
}

export function nextUtcReset(now: string | Date = new Date()): string {
  const date = typeof now === "string" ? new Date(now) : now;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
}

export function isDailyNeuronLimitError(error: unknown): boolean {
  const text = errorMessage(error);
  return /(?:\b3036\b|daily free allocation|10[ ,]?000 neurons)/iu.test(text);
}

async function safeDailyStatus(env: Env): Promise<Awaited<ReturnType<typeof aiNeuronStatus>> | null> {
  try {
    return await aiNeuronStatus(env);
  } catch {
    return null;
  }
}

async function ensureNeuronSchema(env: Env): Promise<void> {
  if (!env.OAUTH_DB) throw new Error("D1 database is not configured for neuron tracking.");
  if (!schemaReady) {
    const db = env.OAUTH_DB;
    schemaReady = (async () => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS ai_neuron_usage (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL,
          run_id TEXT,
          agent_id TEXT,
          model TEXT NOT NULL,
          billing_type TEXT NOT NULL,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          cached_tokens INTEGER NOT NULL DEFAULT 0,
          estimated_cost_usd REAL,
          estimated_neurons REAL,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS idx_ai_neuron_usage_created ON ai_neuron_usage(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_ai_neuron_usage_run_created ON ai_neuron_usage(run_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_ai_neuron_usage_model_created ON ai_neuron_usage(model, created_at)",
        `CREATE TABLE IF NOT EXISTS ai_neuron_events (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          code TEXT,
          message TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS idx_ai_neuron_events_type_created ON ai_neuron_events(event_type, created_at)",
      ];
      for (const statement of statements) await db.prepare(statement).run();
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

async function recordNeuronUsage(env: Env, row: UsageRow): Promise<void> {
  if (!env.OAUTH_DB) throw new Error("D1 database is not configured for neuron tracking.");
  await ensureNeuronSchema(env);
  await env.OAUTH_DB.prepare(
    `INSERT INTO ai_neuron_usage
      (id, request_id, run_id, agent_id, model, billing_type, prompt_tokens, completion_tokens,
       cached_tokens, estimated_cost_usd, estimated_neurons, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    row.id,
    row.request_id,
    row.run_id,
    row.agent_id,
    row.model,
    row.billing_type,
    row.prompt_tokens,
    row.completion_tokens,
    row.cached_tokens,
    row.estimated_cost_usd,
    row.estimated_neurons,
    row.source,
    row.created_at,
  ).run();
}

async function recordNeuronEvent(
  env: Env,
  event: { event_type: string; code?: string; message: string },
): Promise<void> {
  if (!env.OAUTH_DB) return;
  try {
    await ensureNeuronSchema(env);
    await env.OAUTH_DB.prepare(
      "INSERT INTO ai_neuron_events (id, event_type, code, message, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(
      crypto.randomUUID(),
      event.event_type,
      event.code || null,
      redactSensitiveText(event.message).slice(0, 2_000),
      new Date().toISOString(),
    ).run();
  } catch {
    // A metering failure must not replace the original Workers AI error.
  }
}

function extractReportedUsage(result: unknown): Omit<TokenUsage, "source"> | null {
  const root = asObject(result);
  const usage = asObject(root?.usage) || asObject(asObject(root?.result)?.usage);
  if (!usage) return null;
  const prompt = finiteNumber(usage.prompt_tokens ?? usage.input_tokens);
  const completion = finiteNumber(usage.completion_tokens ?? usage.output_tokens) ?? 0;
  const cached = finiteNumber(
    usage.cached_tokens
    ?? usage.cached_input_tokens
    ?? asObject(usage.prompt_tokens_details)?.cached_tokens,
  ) ?? 0;
  const total = finiteNumber(usage.total_tokens);
  if (prompt === null && total === null) return null;
  const promptTokens = Math.max(0, Math.round(prompt ?? Math.max(0, Number(total || 0) - completion)));
  const completionTokens = Math.max(0, Math.round(completion));
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cached_tokens: Math.min(promptTokens, Math.max(0, Math.round(cached))),
    total_tokens: Math.max(promptTokens + completionTokens, Math.round(total ?? 0)),
  };
}

function estimateTokensFromValue(value: unknown): number {
  if (typeof value === "string") return estimateTextTokens(value);
  if (Array.isArray(value)) return Math.max(1, value.reduce((sum, item) => sum + estimateTokensFromValue(item), 0));
  const object = asObject(value);
  if (object) {
    if (Array.isArray(object.messages)) {
      return Math.max(1, object.messages.reduce((sum, message) => {
        const content = asObject(message)?.content;
        return sum + estimateTokensFromValue(content);
      }, 0));
    }
    if (object.text !== undefined) return estimateTokensFromValue(object.text);
    if (object.prompt !== undefined) return estimateTokensFromValue(object.prompt);
  }
  try {
    return estimateTextTokens(JSON.stringify(value));
  } catch {
    return 1;
  }
}

function estimateTokensFromResult(result: unknown): number {
  const object = asObject(result);
  const candidate = object?.response
    ?? object?.text
    ?? asObject(object?.result)?.response
    ?? asObject(object?.result)?.text;
  if (candidate !== undefined) return estimateTokensFromValue(candidate);
  try {
    return estimateTextTokens(JSON.stringify(result));
  } catch {
    return 1;
  }
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function utcDayPeriod(now = new Date()) {
  const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { starts_at: startsAt.toISOString(), resets_at: nextUtcReset(startsAt) };
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
