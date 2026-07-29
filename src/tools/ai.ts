import { z } from "zod";
import { biInline } from "../i18n";
import type { Env } from "../types";

const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 50_000;
const MAX_TOTAL_INPUT_CHARS = 100_000;
const MAX_RAW_INPUT_CHARS = 120_000;
const MAX_JSON_SCHEMA_CHARS = 30_000;
const MAX_OUTPUT_TOKENS = 4_096;
const MAX_EMBEDDING_ITEMS = 16;
const MAX_EMBEDDING_ITEM_CHARS = 20_000;
const MAX_RESULT_CHARS = 600_000;
const MODEL_CATALOG_VERIFIED_AT = "2026-07-29";

const MODEL_PROFILES = {
  fast: "@cf/zai-org/glm-4.7-flash",
  balanced: "@cf/openai/gpt-oss-20b",
  reasoning: "@cf/openai/gpt-oss-120b",
  vision: "@cf/meta/llama-4-scout-17b-16e-instruct",
  coding: "@cf/moonshotai/kimi-k2.7-code",
  agentic: "@cf/zai-org/glm-5.2",
  json: "@cf/meta/llama-3.1-8b-instruct-fast",
  embedding: "@cf/qwen/qwen3-embedding-0.6b",
} as const;

type ChatProfile = "fast" | "balanced" | "reasoning" | "vision" | "coding" | "agentic";
type ModelTask = "text-generation" | "embeddings";
type CostTier = "low" | "medium" | "high" | "premium";
type LatencyTier = "fast" | "balanced" | "slower";
type QualityTier = "standard" | "advanced" | "frontier";
type ModelCapability =
  | "multilingual"
  | "reasoning"
  | "function-calling"
  | "coding"
  | "vision"
  | "structured-output"
  | "embeddings";

interface ModelCatalogEntry {
  id: string;
  task: ModelTask;
  profiles: string[];
  description: string;
  status: "active";
  verified_at: string;
  context_window_tokens: number;
  capabilities: ModelCapability[];
  pricing_usd_per_million_units: {
    input: number;
    output?: number;
    cached_input?: number;
  } | null;
  cost_tier: CostTier;
  latency_tier: LatencyTier;
  quality_tier: QualityTier;
}

const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: MODEL_PROFILES.fast,
    task: "text-generation",
    profiles: ["fast"],
    description: "Fast multilingual chat, instruction following, coding and multi-turn tool calling.",
    status: "active",
    verified_at: MODEL_CATALOG_VERIFIED_AT,
    context_window_tokens: 131_072,
    capabilities: ["multilingual", "reasoning", "function-calling", "coding", "structured-output"],
    pricing_usd_per_million_units: { input: 0.06, output: 0.40 },
    cost_tier: "low",
    latency_tier: "fast",
    quality_tier: "advanced",
  },
  {
    id: MODEL_PROFILES.balanced,
    task: "text-generation",
    profiles: ["balanced"],
    description: "Balanced general-purpose reasoning and agentic tasks at moderate cost.",
    status: "active",
    verified_at: MODEL_CATALOG_VERIFIED_AT,
    context_window_tokens: 128_000,
    capabilities: ["reasoning", "function-calling", "coding", "structured-output"],
    pricing_usd_per_million_units: { input: 0.20, output: 0.30 },
    cost_tier: "low",
    latency_tier: "balanced",
    quality_tier: "advanced",
  },
  {
    id: MODEL_PROFILES.reasoning,
    task: "text-generation",
    profiles: ["reasoning"],
    description: "Higher-capability reasoning model for difficult analysis and planning.",
    status: "active",
    verified_at: MODEL_CATALOG_VERIFIED_AT,
    context_window_tokens: 128_000,
    capabilities: ["reasoning", "function-calling", "coding", "structured-output"],
    pricing_usd_per_million_units: { input: 0.35, output: 0.75 },
    cost_tier: "medium",
    latency_tier: "slower",
    quality_tier: "frontier",
  },
  {
    id: MODEL_PROFILES.vision,
    task: "text-generation",
    profiles: ["vision"],
    description: "Multimodal model for text and image understanding with function calling.",
    status: "active",
    verified_at: MODEL_CATALOG_VERIFIED_AT,
    context_window_tokens: 131_000,
    capabilities: ["function-calling", "vision", "structured-output"],
    pricing_usd_per_million_units: { input: 0.27, output: 0.85 },
    cost_tier: "medium",
    latency_tier: "balanced",
    quality_tier: "advanced",
  },
  {
    id: MODEL_PROFILES.coding,
    task: "text-generation",
    profiles: ["coding"],
    description: "Long-context coding and agentic model with vision, tools and structured outputs.",
    status: "active",
    verified_at: MODEL_CATALOG_VERIFIED_AT,
    context_window_tokens: 262_144,
    capabilities: ["reasoning", "function-calling", "coding", "vision", "structured-output"],
    pricing_usd_per_million_units: { input: 0.95, output: 4.00, cached_input: 0.19 },
    cost_tier: "premium",
    latency_tier: "slower",
    quality_tier: "frontier",
  },
  {
    id: MODEL_PROFILES.agentic,
    task: "text-generation",
    profiles: ["agentic"],
    description: "Flagship long-context agentic coding model for complex tool-driven work.",
    status: "active",
    verified_at: MODEL_CATALOG_VERIFIED_AT,
    context_window_tokens: 262_144,
    capabilities: ["reasoning", "function-calling", "coding"],
    pricing_usd_per_million_units: { input: 1.40, output: 4.40, cached_input: 0.26 },
    cost_tier: "premium",
    latency_tier: "slower",
    quality_tier: "frontier",
  },
  {
    id: MODEL_PROFILES.json,
    task: "text-generation",
    profiles: ["json"],
    description: "Active fast Llama variant used for schema-guided JSON extraction.",
    status: "active",
    verified_at: MODEL_CATALOG_VERIFIED_AT,
    context_window_tokens: 128_000,
    capabilities: ["multilingual", "structured-output"],
    pricing_usd_per_million_units: null,
    cost_tier: "low",
    latency_tier: "fast",
    quality_tier: "standard",
  },
  {
    id: MODEL_PROFILES.embedding,
    task: "embeddings",
    profiles: ["embedding"],
    description: "Multilingual text embeddings for semantic search and retrieval.",
    status: "active",
    verified_at: MODEL_CATALOG_VERIFIED_AT,
    context_window_tokens: 8_192,
    capabilities: ["multilingual", "embeddings"],
    pricing_usd_per_million_units: { input: 0.012 },
    cost_tier: "low",
    latency_tier: "fast",
    quality_tier: "advanced",
  },
];

// Removed deprecated non-fast Llama 3/3.1 models. This allowlist contains only
// currently active curated models whose Workers AI interfaces expose structured output.
const JSON_MODE_MODELS = new Set([
  MODEL_PROFILES.json,
  MODEL_PROFILES.fast,
  MODEL_PROFILES.vision,
  MODEL_PROFILES.coding,
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.2-11b-vision-instruct",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
]);

const profileSchema = z.enum(["fast", "balanced", "reasoning", "vision", "coding", "agentic"]);
const modelOverrideSchema = z.string().min(4).max(200).optional().describe(biInline(
  "Optional exact Cloudflare-hosted model ID. Curated models are allowed by default.",
  "Опційний точний ID Cloudflare-hosted моделі. Curated моделі дозволені за замовчуванням.",
));

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(MAX_MESSAGE_CHARS),
});

export const aiCapabilitiesSchema = {};

export const aiModelsListSchema = {
  task: z.enum(["all", "text-generation", "embeddings"]).default("all").describe(biInline(
    "Filter the curated model list by task.",
    "Фільтр curated списку моделей за типом задачі.",
  )),
  capability: z.enum([
    "all",
    "multilingual",
    "reasoning",
    "function-calling",
    "coding",
    "vision",
    "structured-output",
    "embeddings",
  ]).default("all").describe(biInline(
    "Optional capability filter.",
    "Опційний фільтр за capability.",
  )),
};

export const aiRecommendModelSchema = {
  task: z.enum([
    "general-chat",
    "multilingual",
    "reasoning",
    "coding",
    "agentic-tools",
    "vision",
    "json-extraction",
    "embeddings",
  ]).describe(biInline(
    "Primary workload the model must perform.",
    "Основна задача, яку має виконувати модель.",
  )),
  priority: z.enum(["lowest-cost", "lowest-latency", "balanced", "highest-quality"]).default("balanced"),
  context_tokens: z.number().int().min(0).max(262_144).default(0).describe(biInline(
    "Estimated required context window in tokens.",
    "Орієнтовно потрібне context window у токенах.",
  )),
  requires_tool_calling: z.boolean().default(false),
  requires_vision: z.boolean().default(false),
  requires_structured_output: z.boolean().default(false),
};

export const aiChatSchema = {
  profile: profileSchema.default("balanced").describe(biInline(
    "Curated model profile. Exact model can be supplied with model.",
    "Curated профіль моделі. Точну модель можна передати через model.",
  )),
  model: modelOverrideSchema,
  allow_unlisted_model: z.boolean().default(false).describe(biInline(
    "Allow an exact @cf/ model not present in the curated list.",
    "Дозволити точну @cf/ модель, якої немає в curated списку.",
  )),
  messages: z.array(messageSchema).min(1).max(MAX_MESSAGES),
  max_tokens: z.number().int().min(1).max(MAX_OUTPUT_TOKENS).default(512),
  temperature: z.number().min(0).max(2).default(0.2),
  top_p: z.number().min(0.001).max(1).optional(),
  seed: z.number().int().min(1).max(9_999_999_999).optional(),
};

export const aiEmbeddingsSchema = {
  model: modelOverrideSchema,
  allow_unlisted_model: z.boolean().default(false).describe(biInline(
    "Allow an exact @cf/ embedding model not present in the curated list.",
    "Дозволити точну @cf/ embedding-модель, якої немає в curated списку.",
  )),
  text: z.union([
    z.string().min(1).max(MAX_EMBEDDING_ITEM_CHARS),
    z.array(z.string().min(1).max(MAX_EMBEDDING_ITEM_CHARS)).min(1).max(MAX_EMBEDDING_ITEMS),
  ]),
};

export const aiExtractJsonSchema = {
  model: z.string().min(4).max(200).optional().describe(biInline(
    "Optional exact model from the active structured-output allowlist.",
    "Опційна точна модель з активного structured-output allowlist.",
  )),
  system: z.string().max(20_000).optional(),
  prompt: z.string().min(1).max(MAX_MESSAGE_CHARS),
  schema: z.record(z.string(), z.unknown()).describe(biInline(
    "JSON Schema that the model should follow.",
    "JSON Schema, якої має дотримуватися модель.",
  )),
  max_tokens: z.number().int().min(1).max(MAX_OUTPUT_TOKENS).default(1_024),
  temperature: z.number().min(0).max(1).default(0),
};

export const aiRunSchema = {
  model: z.string().min(4).max(200).describe(biInline(
    "Exact Cloudflare-hosted model ID beginning with @cf/.",
    "Точний ID Cloudflare-hosted моделі, що починається з @cf/.",
  )),
  allow_unlisted_model: z.boolean().default(false).describe(biInline(
    "Allow a model not present in the curated list. The @cf/ prefix is still required.",
    "Дозволити модель, якої немає в curated списку. Префікс @cf/ усе одно обов'язковий.",
  )),
  input: z.record(z.string(), z.unknown()).describe(biInline(
    "Raw Workers AI input object. Streaming is not supported by this MCP tool.",
    "Raw Workers AI input object. Streaming цим MCP tool не підтримується.",
  )),
};

export function aiCapabilities(env: Env) {
  return {
    configured: Boolean(env.AI),
    binding: "AI",
    tools: [
      "ai_capabilities",
      "ai_models_list",
      "ai_recommend_model",
      "ai_chat",
      "ai_embeddings",
      "ai_extract_json",
      "ai_run",
    ],
    profiles: MODEL_PROFILES,
    catalog_verified_at: MODEL_CATALOG_VERIFIED_AT,
    limits: {
      messages: MAX_MESSAGES,
      total_input_chars: MAX_TOTAL_INPUT_CHARS,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      embedding_items: MAX_EMBEDDING_ITEMS,
      raw_input_chars: MAX_RAW_INPUT_CHARS,
    },
    notes: [
      "Every inference result reports the exact model and curated model metadata when available.",
      "ai_recommend_model is deterministic and does not invoke or bill an AI model.",
      "Curated profiles are preferred over exact model IDs.",
      "Unlisted exact models require allow_unlisted_model=true.",
      "Pricing metadata is a dated snapshot; verify the live Cloudflare pricing page before high-volume use.",
      "Streaming and binary/media outputs are intentionally not exposed by these MCP tools.",
    ],
  };
}

export function aiModelsList(args: z.infer<z.ZodObject<typeof aiModelsListSchema>>) {
  const models = MODEL_CATALOG.filter((model) => {
    const taskMatches = args.task === "all" || model.task === args.task;
    const capabilityMatches = args.capability === "all" || model.capabilities.includes(args.capability);
    return taskMatches && capabilityMatches;
  });
  return {
    curated: true,
    live_catalog: false,
    catalog_verified_at: MODEL_CATALOG_VERIFIED_AT,
    models,
    profiles: MODEL_PROFILES,
    workers_ai_billing: {
      free_allocation_neurons_per_day: 10_000,
      paid_price_usd_per_1000_neurons_above_free_allocation: 0.011,
    },
    note: "This is a dated curated compatibility and pricing snapshot shipped with OneAIWorkers, not a live Cloudflare catalog.",
  };
}

export function aiRecommendModel(args: z.infer<z.ZodObject<typeof aiRecommendModelSchema>>) {
  const requiredCapabilities = requiredCapabilitiesForRecommendation(args);
  const orderedProfiles = recommendationProfiles(args.task, args.priority);
  const candidates = uniqueModels(orderedProfiles.map((profile) => modelById(MODEL_PROFILES[profile])));
  const eligible = candidates.filter((model) => (
    model.context_window_tokens >= args.context_tokens
    && requiredCapabilities.every((capability) => model.capabilities.includes(capability))
  ));
  const selected = eligible[0] || null;
  const warnings: string[] = [];
  if (!selected) {
    warnings.push("No curated model satisfies every requested constraint. Review the closest alternatives or use an exact model override after checking its current capabilities and pricing.");
  }
  if (selected?.pricing_usd_per_million_units === null) {
    warnings.push("The curated registry does not contain unit pricing for the selected model; check the live Workers AI pricing page.");
  }

  return {
    deterministic: true,
    invokes_ai: false,
    catalog_verified_at: MODEL_CATALOG_VERIFIED_AT,
    request: args,
    required_capabilities: requiredCapabilities,
    recommended: selected ? recommendationView(selected, args) : null,
    alternatives: (eligible.length > 1 ? eligible.slice(1, 4) : candidates.slice(0, 4)).map((model) => recommendationView(model, args)),
    warnings,
  };
}

export async function aiChat(env: Env, args: z.infer<z.ZodObject<typeof aiChatSchema>>) {
  const model = resolveModel(args.profile, args.model, args.allow_unlisted_model);
  assertMessagesSize(args.messages);
  const input: Record<string, unknown> = {
    messages: args.messages,
    stream: false,
    max_tokens: args.max_tokens,
    temperature: args.temperature,
  };
  if (args.top_p !== undefined) input.top_p = args.top_p;
  if (args.seed !== undefined) input.seed = args.seed;

  const result = await requireAi(env).run(model, input);
  return {
    model,
    requested_profile: args.profile,
    model_metadata: optionalModelMetadata(model),
    result: normalizeAiResult(result),
  };
}

export async function aiEmbeddings(env: Env, args: z.infer<z.ZodObject<typeof aiEmbeddingsSchema>>) {
  const model = resolveEmbeddingModel(args.model, args.allow_unlisted_model);
  const texts = Array.isArray(args.text) ? args.text : [args.text];
  const totalChars = texts.reduce((sum, value) => sum + value.length, 0);
  if (totalChars > MAX_TOTAL_INPUT_CHARS) {
    throw new Error(biInline(
      `Embedding input exceeds ${MAX_TOTAL_INPUT_CHARS} characters.`,
      `Embedding input перевищує ${MAX_TOTAL_INPUT_CHARS} символів.`,
    ));
  }

  const result = await requireAi(env).run(model, { text: Array.isArray(args.text) ? texts : args.text });
  return {
    model,
    model_metadata: optionalModelMetadata(model),
    input_count: texts.length,
    result: normalizeAiResult(result),
  };
}

export async function aiExtractJson(env: Env, args: z.infer<z.ZodObject<typeof aiExtractJsonSchema>>) {
  const model = args.model || MODEL_PROFILES.json;
  assertCloudflareModel(model);
  if (!JSON_MODE_MODELS.has(model)) {
    throw new Error(biInline(
      "The selected model is not in the active structured-output compatibility allowlist.",
      "Обрана модель відсутня в активному structured-output compatibility allowlist.",
    ));
  }
  assertJsonSize(args.schema, MAX_JSON_SCHEMA_CHARS, "schema");
  const messages = [
    ...(args.system ? [{ role: "system", content: args.system }] : []),
    { role: "user", content: args.prompt },
  ];
  assertMessagesSize(messages);

  const result = await requireAi(env).run(model, {
    messages,
    stream: false,
    max_tokens: args.max_tokens,
    temperature: args.temperature,
    response_format: {
      type: "json_schema",
      json_schema: args.schema,
    },
  });
  return {
    model,
    model_metadata: optionalModelMetadata(model),
    result: normalizeAiResult(result),
  };
}

export async function aiRun(env: Env, args: z.infer<z.ZodObject<typeof aiRunSchema>>) {
  const model = resolveExactModel(args.model, args.allow_unlisted_model);
  if (args.input.stream === true) {
    throw new Error(biInline(
      "Streaming is not supported by ai_run. Use a non-streaming request.",
      "Streaming не підтримується ai_run. Використайте non-streaming запит.",
    ));
  }
  assertJsonSize(args.input, MAX_RAW_INPUT_CHARS, "input");
  const result = await requireAi(env).run(model, { ...args.input, stream: false });
  return {
    model,
    model_metadata: optionalModelMetadata(model),
    unlisted_model: !modelByIdOptional(model),
    result: normalizeAiResult(result),
  };
}

function requireAi(env: Env) {
  if (!env.AI) {
    throw new Error(biInline(
      "Workers AI binding is not configured. Add [ai] binding = \"AI\" and redeploy.",
      "Workers AI binding не налаштований. Додайте [ai] binding = \"AI\" і повторно задеплойте.",
    ));
  }
  return env.AI;
}

function resolveModel(profile: ChatProfile, model: string | undefined, allowUnlisted: boolean) {
  return model ? resolveExactModel(model, allowUnlisted) : MODEL_PROFILES[profile];
}

function resolveEmbeddingModel(model: string | undefined, allowUnlisted: boolean) {
  return model ? resolveExactModel(model, allowUnlisted) : MODEL_PROFILES.embedding;
}

function resolveExactModel(model: string, allowUnlisted: boolean) {
  assertCloudflareModel(model);
  const curated = Boolean(modelByIdOptional(model)) || JSON_MODE_MODELS.has(model);
  if (!curated && !allowUnlisted) {
    throw new Error(biInline(
      "The exact model is not in the curated list. Retry with allow_unlisted_model=true after reviewing the model and its pricing.",
      "Точної моделі немає в curated списку. Повторіть з allow_unlisted_model=true після перевірки моделі та її вартості.",
    ));
  }
  return model;
}

function requiredCapabilitiesForRecommendation(args: z.infer<z.ZodObject<typeof aiRecommendModelSchema>>): ModelCapability[] {
  const required = new Set<ModelCapability>();
  if (args.task === "multilingual") required.add("multilingual");
  if (args.task === "reasoning") required.add("reasoning");
  if (args.task === "coding") required.add("coding");
  if (args.task === "agentic-tools") required.add("function-calling");
  if (args.task === "vision") required.add("vision");
  if (args.task === "json-extraction") required.add("structured-output");
  if (args.task === "embeddings") required.add("embeddings");
  if (args.requires_tool_calling) required.add("function-calling");
  if (args.requires_vision) required.add("vision");
  if (args.requires_structured_output) required.add("structured-output");
  return [...required];
}

function recommendationProfiles(
  task: z.infer<z.ZodObject<typeof aiRecommendModelSchema>>["task"],
  priority: z.infer<z.ZodObject<typeof aiRecommendModelSchema>>["priority"],
): Array<keyof typeof MODEL_PROFILES> {
  if (task === "embeddings") return ["embedding"];
  if (task === "json-extraction") return priority === "highest-quality"
    ? ["coding", "json", "vision", "fast"]
    : ["json", "fast", "vision", "coding"];
  if (task === "vision") return priority === "highest-quality"
    ? ["coding", "vision"]
    : ["vision", "coding"];
  if (task === "coding") {
    if (priority === "highest-quality") return ["coding", "agentic", "reasoning", "fast"];
    if (priority === "lowest-latency" || priority === "lowest-cost") return ["fast", "balanced", "coding", "agentic"];
    return ["balanced", "coding", "fast", "agentic"];
  }
  if (task === "agentic-tools") {
    if (priority === "highest-quality") return ["agentic", "coding", "reasoning", "fast"];
    if (priority === "lowest-latency" || priority === "lowest-cost") return ["fast", "balanced", "agentic", "coding"];
    return ["balanced", "fast", "agentic", "coding"];
  }
  if (task === "reasoning") {
    if (priority === "highest-quality") return ["reasoning", "agentic", "coding", "balanced"];
    if (priority === "lowest-latency" || priority === "lowest-cost") return ["balanced", "fast", "reasoning", "agentic"];
    return ["reasoning", "balanced", "fast", "agentic"];
  }
  if (task === "multilingual") return ["fast", "balanced", "reasoning", "coding"];
  if (priority === "highest-quality") return ["reasoning", "agentic", "coding", "balanced", "fast"];
  if (priority === "lowest-latency" || priority === "lowest-cost") return ["fast", "balanced", "reasoning", "coding"];
  return ["balanced", "fast", "reasoning", "coding"];
}

function recommendationView(
  model: ModelCatalogEntry,
  args: z.infer<z.ZodObject<typeof aiRecommendModelSchema>>,
) {
  return {
    model: model.id,
    profiles: model.profiles,
    rationale: [
      `Task: ${args.task}.`,
      `Priority: ${args.priority}.`,
      `Context capacity: ${model.context_window_tokens} tokens.`,
      `Cost tier: ${model.cost_tier}; latency tier: ${model.latency_tier}; quality tier: ${model.quality_tier}.`,
    ],
    metadata: model,
  };
}

function uniqueModels(models: ModelCatalogEntry[]): ModelCatalogEntry[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

function modelById(model: string): ModelCatalogEntry {
  const entry = modelByIdOptional(model);
  if (!entry) throw new Error(`Curated model metadata is missing for ${model}.`);
  return entry;
}

function modelByIdOptional(model: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((entry) => entry.id === model);
}

function optionalModelMetadata(model: string): ModelCatalogEntry | null {
  return modelByIdOptional(model) || null;
}

function assertCloudflareModel(model: string) {
  if (!/^@cf\/[a-z0-9][a-z0-9._/-]*$/i.test(model)) {
    throw new Error(biInline(
      "Only Cloudflare-hosted @cf/ model IDs are allowed.",
      "Дозволені лише Cloudflare-hosted ID моделей із префіксом @cf/.",
    ));
  }
}

function assertMessagesSize(messages: Array<{ content: string }>) {
  const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (totalChars > MAX_TOTAL_INPUT_CHARS) {
    throw new Error(biInline(
      `Message input exceeds ${MAX_TOTAL_INPUT_CHARS} characters.`,
      `Вхідні повідомлення перевищують ${MAX_TOTAL_INPUT_CHARS} символів.`,
    ));
  }
}

function assertJsonSize(value: unknown, maxChars: number, label: string) {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(biInline(`${label} must be JSON-serializable.`, `${label} має бути JSON-сумісним.`));
  }
  if (serialized.length > maxChars) {
    throw new Error(biInline(
      `${label} exceeds ${maxChars} serialized characters.`,
      `${label} перевищує ${maxChars} символів у serialized вигляді.`,
    ));
  }
}

function normalizeAiResult(result: unknown): unknown {
  if (result instanceof ReadableStream) {
    throw new Error(biInline(
      "Streaming Workers AI responses are not supported by this MCP response layer.",
      "Streaming-відповіді Workers AI не підтримуються поточним MCP response layer.",
    ));
  }
  if (result instanceof ArrayBuffer || ArrayBuffer.isView(result) || result instanceof Blob) {
    throw new Error(biInline(
      "Binary Workers AI responses are not supported yet.",
      "Binary-відповіді Workers AI поки не підтримуються.",
    ));
  }
  if (result === undefined) return null;

  let serialized: string;
  try {
    serialized = JSON.stringify(result);
  } catch {
    return String(result);
  }
  if (serialized.length <= MAX_RESULT_CHARS) return result;
  return {
    truncated: true,
    original_chars: serialized.length,
    preview: serialized.slice(0, MAX_RESULT_CHARS),
    note: "Result was truncated by OneAIWorkers. Use a smaller input or a more compact model response.",
  };
}
