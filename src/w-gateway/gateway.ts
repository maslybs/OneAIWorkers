import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomToken, sha256Base64Url } from "../crypto";
import { bi } from "../i18n";
import { findCapability } from "../marketplace";
import { errorMessage, mcpText } from "../response";
import { redactSensitiveText, redactSensitiveValue, safeKey } from "../security";
import type { Env } from "../types";
import { APP_VERSION, getUpdateState, updateNotice } from "../update";
import { createWRequestContext } from "./context";
import { semanticPluginThreshold } from "./config";
import { confirmationStatus } from "./confirmation";
import { listAutomaticPluginActions, revokeAutomaticPluginActions } from "./confirmation-policy";
import { processEmbeddingJobs, rebuildVectorClusters } from "./embeddings";
import { resolveExecutableTool, wCall } from "./execution";
import { loadPolicy, toolAllowed } from "./policy";
import { ensureWRegistryCurrent, syncWRegistry } from "./registry";
import { readStoredResult } from "./results";
import { bumpCatalogRevision, catalogRevision, ensureWGatewaySchema, wDatabase } from "./schema";
import { loadPublishedTools, loadPublishedToolsByRefs, wSearch } from "./search";
import type { CapabilityKind, ExposureMode, WRequestContext } from "./types";

const OAUTH_SECURITY_SCHEMES = [{ type: "oauth2", scopes: ["mcp"] }] as const;
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const READ_EXTERNAL = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const WRITE_INTERNAL = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const WRITE_EXTERNAL = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const gatewayUpdateNotices = new WeakMap<McpServer, () => Promise<ReturnType<typeof updateNotice>>>();

const capabilityKind = z.enum(["plugin", "skill", "agent", "prompt", "resource", "ui"]);
const searchFilters = z.object({
  kinds: z.array(capabilityKind).max(6).optional(),
  connected_only: z.boolean().default(true),
  read_only: z.boolean().optional(),
  plugin_ids: z.array(z.string().min(1).max(100)).max(20).default([]),
  target: z.string().min(1).max(100).default("oneaiworkers-cloudflare"),
}).default({ connected_only: true, plugin_ids: [], target: "oneaiworkers-cloudflare" });

export async function createWGatewayServer(
  env: Env,
  request: Request,
  exposureMode: ExposureMode = "meta",
): Promise<McpServer> {
  const context = await createWRequestContext(request, env, exposureMode);
  const server = new McpServer(
    { name: env.HUB_NAME || "OneAIWorkers", version: APP_VERSION },
    { instructions: gatewayInstructions() },
  );
  registerWGatewayTools(server, env, context);
  return server;
}

function gatewayInstructions(): string {
  return [
    "OneAIWorkers is a private plugin gateway with a live marketplace.",
    "At the start of a conversation, and whenever the user asks what is available, what can be installed, or whether updates exist, call w_search with an empty query.",
    "That overview contains the system capabilities, installed user plugins, the current live marketplace, exact installation links, and plugin update links.",
    "For a task, call w_search with the user's goal. If it returns an installed plugin that needs setup, obtain its protected settings link. If it returns a marketplace match, put the exact install_url first and tell the user to open it in a normal browser.",
    "Never invent plugins, never rely on an old catalog remembered by the client, and never ask the user to paste service keys into chat. Keys are entered only on the protected page of the user's own OneAIWorkers.",
    "After choosing an operation, call w_describe for the exact tool_ref, then w_call. Do not guess schemas or versioned references.",
    "When w_call returns a confirmation link, tell the user that the page offers either one-time execution or automatic actions for that one plugin. The browser executes the approved action. After the user returns, use w_confirmation_status; do not repeat w_call.",
    "If the user wants to review or disable automatic plugin actions, use w_confirmation_settings or w_revoke_plugin_trust.",
    "Українською: на початку розмови та на питання про можливості, встановлення або оновлення спочатку викличте w_search з порожнім запитом. Він повертає встановлені плагіни, живий ринок і точні посилання. Не вигадуйте плагіни й не просіть ключі в чаті.",
  ].join("\n");
}

export function registerWGatewayTools(server: McpServer, env: Env, context: WRequestContext): void {
  gatewayUpdateNotices.set(server, async () => updateNotice(await getUpdateState(env, context.baseUrl)));
  register(
    server,
    "w_search",
    "Search available plugins",
    bi(
      "Finds the best available plugin operations without loading their full schemas. An empty query returns installed plugins plus the current live marketplace with exact installation links.",
      "Знаходить найкращі доступні дії плагінів без завантаження повних схем. Порожній запит повертає встановлені плагіни та поточний живий ринок із точними посиланнями встановлення.",
    ),
    {
      query: z.string().max(2_000).default(""),
      limit: z.number().int().min(1).max(20).default(8),
      filters: searchFilters,
    },
    (args) => searchCurrentRegistry(env, context, {
      query: args.query,
      limit: args.limit,
      filters: args.filters as { kinds?: CapabilityKind[]; connected_only?: boolean; read_only?: boolean; plugin_ids?: string[]; target?: string },
    }),
    READ_ONLY,
  );
  register(
    server,
    "w_describe",
    "Describe selected operations",
    bi(
      "Loads the stored input and output schemas for up to ten exact tool references returned by w_search.",
      "Завантажує збережені схеми входу й виходу для щонайбільше десяти точних посилань, повернених w_search.",
    ),
    {
      tool_refs: z.array(z.string().min(8).max(300)).min(1).max(10),
      search_id: z.string().min(8).max(200).optional(),
    },
    (args) => wDescribe(env, context, args),
    READ_ONLY,
  );
  register(
    server,
    "w_call",
    "Run one plugin operation",
    bi(
      "Runs one immutable operation after checking its stored schema, connection, permissions, confirmation, and repeat protection.",
      "Виконує одну незмінну дію після перевірки збереженої схеми, підключення, прав, підтвердження та захисту від повтору.",
    ),
    {
      tool_ref: z.string().min(8).max(300),
      arguments: z.record(z.string(), z.unknown()).default({}),
      connection_id: z.string().min(3).max(200).optional(),
      search_id: z.string().min(8).max(200).optional(),
      idempotency_key: z.string().min(1).max(200).optional(),
      confirmation_token: z.string().min(20).max(300).optional(),
    },
    (args) => wCall(env, context, args),
    WRITE_EXTERNAL,
  );
  register(
    server,
    "w_confirmation_settings",
    "Show automatic plugin permissions",
    bi(
      "Lists plugins that may run confirmed actions automatically for this MCP connection.",
      "Показує плагіни, яким дозволено автоматично виконувати дії в цьому MCP-підключенні.",
    ),
    {},
    async () => ({
      ok: true,
      default_mode: "confirm_each_action",
      automatic_plugins: await listAutomaticPluginActions(env, context),
    }),
    READ_ONLY,
  );
  register(
    server,
    "w_confirmation_status",
    "Check an approved action",
    bi(
      "Returns the result of the action executed from a confirmation page. Use this after the user returns; do not repeat w_call.",
      "Повертає результат дії, виконаної зі сторінки підтвердження. Використовуйте після повернення користувача й не повторюйте w_call.",
    ),
    { confirmation_token: z.string().min(20).max(300) },
    (args) => confirmationStatus(env, context, args.confirmation_token),
    READ_ONLY,
  );
  register(
    server,
    "w_revoke_plugin_trust",
    "Require confirmations for a plugin again",
    bi(
      "Removes automatic action permission for one plugin. Future risky actions require confirmation again.",
      "Вимикає автоматичні дії для одного плагіна. Наступні ризикові дії знову потребуватимуть підтвердження.",
    ),
    { plugin_id: z.string().min(1).max(100) },
    async (args) => ({
      ok: true,
      plugin_id: args.plugin_id,
      revoked: await revokeAutomaticPluginActions(env, context, args.plugin_id),
      mode: "confirm_each_action",
    }),
    WRITE_INTERNAL,
  );
  register(
    server,
    "w_present",
    "Create a visual result",
    bi(
      "Runs only an operation marked for images, screenshots, renders, diagrams, or previews.",
      "Виконує лише дію, позначену для зображень, знімків екрана, візуалізацій, схем або попереднього перегляду.",
    ),
    {
      tool_ref: z.string().min(8).max(300),
      arguments: z.record(z.string(), z.unknown()).default({}),
      connection_id: z.string().min(3).max(200).optional(),
      search_id: z.string().min(8).max(200).optional(),
      idempotency_key: z.string().min(1).max(200).optional(),
      confirmation_token: z.string().min(20).max(300).optional(),
    },
    (args) => wPresent(env, context, args),
    WRITE_EXTERNAL,
  );
  register(
    server,
    "w_result_read",
    "Read part of a large result",
    bi(
      "Reads only the requested part of a large result created by this user and session.",
      "Дочитує лише потрібну частину великого результату, створеного цим користувачем у цій сесії.",
    ),
    {
      result_id: z.string().min(8).max(200),
      pointer: z.string().max(1_000).default(""),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(50).default(25),
    },
    (args) => readStoredResult(env, context, args),
    READ_ONLY,
  );
  register(
    server,
    "w_agent_run",
    "Run an approved agent team",
    bi(
      "Starts an allowed agent team with a strict step and budget limit. Risky actions still require user confirmation.",
      "Запускає дозволену команду агентів із чітким обмеженням кроків і бюджету. Ризикові дії все одно потребують підтвердження користувача.",
    ),
    {
      agent_ref: z.string().min(8).max(300),
      input: z.object({ task: z.string().min(1).max(20_000) }),
      max_steps: z.number().int().min(1).max(20).default(8),
      max_budget_usd: z.number().min(0.0001).max(100).default(0.25),
      confirmation_token: z.string().min(20).max(300).optional(),
    },
    (args) => wAgentRun(env, context, args),
    WRITE_EXTERNAL,
  );
}

async function searchCurrentRegistry(
  env: Env,
  context: WRequestContext,
  input: Parameters<typeof wSearch>[2],
) {
  await ensureWRegistryCurrent(env);
  const local = await wSearch(env, context, input);
  const query = String(input.query || "").trim();
  if (!query || localSearchHasPluginResults(local)) return local;

  const installed = await wSearch(env, context, {
    ...input,
    filters: { ...(input.filters || {}), connected_only: false },
  });
  if (localSearchHasPluginResults(installed)) {
    return {
      ...local,
      installed_matches_needing_setup: (installed as { results?: unknown[] }).results || [],
      next_step: "The plugin is installed but is not ready. Use OneAIWorkers get_plugin_settings_link for its plugin_id, then ask the user to open the returned link in a normal browser. / Плагін встановлено, але він ще не готовий. Викличте get_plugin_settings_link OneAIWorkers для його plugin_id, а потім попросіть користувача відкрити отримане посилання у звичайному браузері.",
    };
  }

  try {
    const marketplace = await findCapability(env, context.baseUrl, {
      query,
      limit: Math.min(input.limit || 5, 5),
      language: /[а-яіїєґ]/iu.test(query) ? "uk" : "en",
    });
    return {
      ...local,
      marketplace,
      browser_action: marketplace.browser_action,
    };
  } catch (error) {
    return {
      ...local,
      marketplace: {
        ok: false,
        available: false,
        error: error instanceof Error ? error.message : "Marketplace is unavailable.",
      },
    };
  }
}

function localSearchHasPluginResults(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as { results?: Array<{ plugin_id?: unknown }>; plugins?: Array<{ plugin_id?: unknown }> };
  return [...(result.results || []), ...(result.plugins || [])]
    .some((item) => item?.plugin_id !== "oneaiworkers");
}

export async function createWAdminServer(env: Env, request: Request): Promise<McpServer> {
  const context = await createWRequestContext(request, env, "meta");
  const server = new McpServer({ name: `${env.HUB_NAME || "OneAIWorkers"} Admin`, version: APP_VERSION });
  gatewayUpdateNotices.set(server, async () => updateNotice(await getUpdateState(env, context.baseUrl)));
  const adminTool = <T extends z.ZodRawShape>(name: string, description: string, shape: T, handler: (args: z.infer<z.ZodObject<T>>) => unknown | Promise<unknown>) =>
    register(server, name, name, description, shape, handler, WRITE_EXTERNAL);

  adminTool("w_plugin_validate", "Validate a oneai.plugin.v1 manifest without publishing it.", {
    manifest: z.record(z.string(), z.unknown()),
  }, ({ manifest }) => validatePluginManifest(manifest));
  adminTool("w_plugin_import", "Import a validated plugin envelope into the registry.", {
    manifest: z.record(z.string(), z.unknown()),
  }, ({ manifest }) => importPluginManifest(env, manifest));
  adminTool("w_plugin_publish", "Publish one imported plugin version.", {
    plugin_id: z.string().min(1).max(100), version: z.string().min(1).max(50),
  }, (args) => setPluginVersionStatus(env, args.plugin_id, args.version, "published"));
  adminTool("w_plugin_deprecate", "Deprecate one plugin version.", {
    plugin_id: z.string().min(1).max(100), version: z.string().min(1).max(50),
  }, (args) => setPluginVersionStatus(env, args.plugin_id, args.version, "deprecated"));
  adminTool("w_plugin_rollback", "Make an earlier published plugin version current.", {
    plugin_id: z.string().min(1).max(100), version: z.string().min(1).max(50),
  }, (args) => rollbackPlugin(env, args.plugin_id, args.version));
  adminTool("w_plugin_sync", "Synchronize installed legacy packages into the plugin registry.", {}, () => syncWRegistry(env, { force: true, embeddings: true }));
  adminTool("w_plugin_reindex", "Rebuild search documents and missing embeddings.", {}, () => syncWRegistry(env, { force: true, embeddings: true, clusters: true }));
  adminTool("w_embedding_rebuild", "Recreate all plugin operation embeddings.", {}, () => rebuildEmbeddings(env));
  adminTool("w_cluster_rebuild", "Rebuild semantic vector clusters.", {}, () => rebuildVectorClusters(env));
  adminTool("w_catalog_status", "Return compact plugin registry and indexing status.", {}, () => catalogStatus(env, context));
  adminTool("w_catalog_revision", "Return the current plugin catalog revision.", {}, async () => ({ revision: await catalogRevision(env) }));
  return server;
}

async function wDescribe(env: Env, context: WRequestContext, input: { tool_refs: string[]; search_id?: string }) {
  await ensureWGatewaySchema(env);
  const policy = await loadPolicy(env, context, "describe");
  const all = await loadPublishedToolsByRefs(env, context, input.tool_refs);
  const byRef = new Map(all.map((tool) => [tool.tool_ref, tool]));
  const tools = [];
  const errors = [];
  for (const ref of input.tool_refs) {
    const tool = byRef.get(ref);
    if (!tool) { errors.push({ tool_ref: ref, code: "unknown_tool_ref" }); continue; }
    if (!toolAllowed(policy, tool, "describe")) { errors.push({ tool_ref: ref, code: "permission_denied" }); continue; }
    tools.push({
      tool_ref: tool.tool_ref,
      title: tool.title,
      description: tool.description,
      input_schema: safeJson(tool.input_schema_json, {}),
      output_schema: tool.output_schema_json ? safeJson(tool.output_schema_json, {}) : null,
      annotations: {
        read_only: Boolean(tool.read_only),
        destructive: Boolean(tool.destructive),
        idempotent: Boolean(tool.idempotent),
        requires_confirmation: Boolean(tool.requires_confirmation),
      },
      connection: {
        required: Boolean(tool.connection_type),
        type: tool.connection_type,
        available: !tool.connection_type || Boolean(tool.connected),
      },
    });
  }
  return { tools, errors };
}

async function wPresent(env: Env, context: WRequestContext, input: Parameters<typeof wCall>[2]) {
  const tool = await resolveExecutableTool(env, context, input.tool_ref, "present");
  if (tool.presentation_mode !== "visual") {
    return { ok: false, error: { code: "not_visual", message: "Use w_call for this operation. w_present is reserved for visual results." } };
  }
  return wCall(env, context, input);
}

async function wAgentRun(
  env: Env,
  context: WRequestContext,
  input: { agent_ref: string; input: { task: string }; max_steps: number; max_budget_usd: number; confirmation_token?: string },
) {
  const match = input.agent_ref.match(/^agent:([0-9a-f-]{36})@([A-Za-z0-9._-]+)$/u);
  if (!match) return { ok: false, error: { code: "invalid_agent_ref", message: "agent_ref must use agent:<team-uuid>@<version>." } };
  const startTool = (await loadPublishedTools(env, context, 50_000)).find((tool) => tool.plugin_id === "oneaiworkers" && tool.method_name === "agent_team_start");
  if (!startTool) return { ok: false, error: { code: "agent_runtime_unavailable" } };
  return wCall(env, context, {
    tool_ref: startTool.tool_ref,
    arguments: { team_id: match[1], task: input.input.task, max_steps: input.max_steps, max_budget_usd: input.max_budget_usd },
    confirmation_token: input.confirmation_token,
    idempotency_key: `agent:${match[1]}:${await sha256Base64Url(input.input.task)}`,
  });
}

function register<T extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  inputSchema: T,
  handler: (args: z.infer<z.ZodObject<T>>) => unknown | Promise<unknown>,
  annotations: Record<string, boolean>,
) {
  server.registerTool(name, {
    title,
    description,
    inputSchema,
    securitySchemes: OAUTH_SECURITY_SCHEMES,
    annotations,
  } as never, (async (args: unknown) => {
    const noticePromise = gatewayUpdateNotice(server);
    try {
      return mcpText({
        ok: true,
        data: redactSensitiveValue(await handler(args as z.infer<z.ZodObject<T>>)),
        update: await noticePromise,
      });
    } catch (error) {
      return mcpText({
        ok: false,
        message: redactSensitiveText(errorMessage(error)),
        update: await noticePromise,
      });
    }
  }) as never);
}

async function gatewayUpdateNotice(server: McpServer) {
  try {
    return await gatewayUpdateNotices.get(server)?.();
  } catch {
    return undefined;
  }
}

function validatePluginManifest(manifest: Record<string, unknown>) {
  const normalized = normalizePluginManifest(manifest);
  const errors: string[] = [];
  if (normalized.format !== "oneai.plugin.v1") errors.push("format must be oneai.plugin.v1");
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/u.test(String(normalized.id || ""))) errors.push("id is invalid");
  if (!String(normalized.name || "").trim()) errors.push("name is required");
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(String(normalized.version || ""))) errors.push("version must be semantic");
  if (!Array.isArray(normalized.targets) || !normalized.targets.length) errors.push("targets are required");
  if (!Array.isArray(normalized.capabilities) || !normalized.capabilities.length) errors.push("capabilities are required");
  const capabilityIds = new Set<string>();
  for (const capability of Array.isArray(normalized.capabilities) ? normalized.capabilities : []) {
    if (!capability || typeof capability !== "object" || Array.isArray(capability)) { errors.push("capability must be an object"); continue; }
    const item = capability as Record<string, unknown>;
    if (!capabilityKind.options.includes(String(item.kind) as never)) errors.push(`unsupported capability kind: ${String(item.kind || "")}`);
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/u.test(String(item.id || ""))) errors.push("capability id is invalid");
    if (capabilityIds.has(String(item.id))) errors.push(`capability id is duplicated: ${String(item.id)}`);
    capabilityIds.add(String(item.id));
    if (!String(item.artifact || "").trim()) errors.push(`capability ${String(item.id || "")} needs an artifact`);
    if (item.kind === "skill" && item.api) validateSkillApi(resolveArtifact(normalized, item.api, item.api_contract), item, errors);
  }
  return { ok: errors.length === 0, errors, normalized: errors.length ? null : normalized };
}

async function importPluginManifest(env: Env, manifest: Record<string, unknown>) {
  const validation = validatePluginManifest(manifest);
  if (!validation.ok || !validation.normalized) return validation;
  const normalized = validation.normalized;
  await ensureWGatewaySchema(env);
  const db = wDatabase(env);
  const pluginId = safeKey(String(normalized.id)).replaceAll(":", "-");
  const version = String(normalized.version);
  const versionId = `${pluginId}@${version}`;
  const now = new Date().toISOString();
  const manifestJson = JSON.stringify(normalized);
  const hash = await sha256Base64Url(manifestJson);
  const existing = await db.prepare("SELECT package_hash, status FROM w_plugin_versions WHERE id = ?")
    .bind(versionId).first<{ package_hash: string; status: string }>();
  if (existing?.status === "published" && existing.package_hash !== hash) {
    return { ok: false, errors: ["A published plugin version is immutable. Publish a new version."], normalized: null };
  }
  if (existing?.status === "published" && existing.package_hash === hash) {
    return { ok: true, plugin_id: pluginId, version, status: "published", unchanged: true };
  }

  await removeImportedVersionRecords(db, versionId);
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO w_plugins (id, name, description, publisher_id, enabled, current_version_id, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', 1, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, updated_at = excluded.updated_at`,
    ).bind(pluginId, redactSensitiveText(String(normalized.name)), redactSensitiveText(String(normalized.description || "")), now, now),
    db.prepare(
      `INSERT INTO w_plugin_versions
         (id, plugin_id, version, package_format, package_hash, target_json, manifest_json, status, created_at, published_at)
       VALUES (?, ?, ?, 'oneai.plugin.v1', ?, ?, ?, 'validated', ?, NULL)
       ON CONFLICT(id) DO UPDATE SET package_hash = excluded.package_hash, manifest_json = excluded.manifest_json, status = 'validated'`,
    ).bind(versionId, pluginId, version, hash, JSON.stringify(normalized.targets), manifestJson, now),
  ];
  let callableTools = 0;
  for (const rawCapability of normalized.capabilities as unknown[]) {
    const capability = rawCapability as Record<string, unknown>;
    const capabilityId = String(capability.id);
    const capabilityKey = `${versionId}:${capabilityId}`;
    const api = capability.kind === "skill" && capability.api
      ? resolveArtifact(normalized, capability.api, capability.api_contract) as Record<string, unknown>
      : null;
    const runtime = asRecord(capability.runtime);
    statements.push(db.prepare(
      `INSERT INTO w_capabilities
         (id, plugin_version_id, capability_id, kind, target, title, description, enabled,
          runtime_type, runtime_config_json, permission_manifest_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    ).bind(capabilityKey, versionId, capabilityId, String(capability.kind),
      String(capability.target || (normalized.targets as unknown[])[0] || "oneaiworkers-cloudflare"),
      redactSensitiveText(String(capability.title || capabilityId)), redactSensitiveText(String(capability.description || normalized.description || "")),
      String(api?.runtime || runtime.type || "instructional"), JSON.stringify(runtime),
      JSON.stringify(capability.permissions || normalized.permissions || {}), now));
    if (!api) continue;
    for (const rawMethod of api.methods as unknown[]) {
      const method = rawMethod as Record<string, unknown>;
      const methodName = String(method.name);
      const toolRef = `${pluginId}:${capabilityId}/${methodName}@${version}`;
      const toolId = `wt_${(await sha256Base64Url(toolRef)).slice(0, 32)}`;
      const inputSchema = asRecord(method.input_schema);
      const outputSchema = asRecord(method.output_schema);
      const annotations = asRecord(method.annotations);
      const executionPlan = {
        type: "skill",
        connector_id: String(runtime.plugin_id || pluginId),
        action_name: String(runtime.operation || "run"),
        skill_ref: `${pluginId}:${capabilityId}@${version}`,
        dispatch: asRecord(method.dispatch),
        argument_root: String(runtime.argument_root || "input"),
      };
      const inputJson = JSON.stringify(inputSchema);
      const outputJson = JSON.stringify(outputSchema);
      const searchText = pluginSearchDocument(normalized, capability, method, toolRef);
      const searchHash = await sha256Base64Url(searchText);
      statements.push(db.prepare(
        `INSERT INTO w_tools
           (id, capability_id, tool_ref, method_name, version, title, description, search_text,
            input_schema_json, output_schema_json, execution_plan_json, read_only, destructive,
            idempotent, requires_confirmation, connection_type, required_scopes_json,
            semantic_family, presentation_mode, enabled, status, schema_hash, search_text_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'validated', ?, ?, ?, ?)`,
      ).bind(toolId, capabilityKey, toolRef, methodName, version,
        redactSensitiveText(String(method.title || methodName.replaceAll("_", " "))), redactSensitiveText(String(method.description || "")), searchText,
        inputJson, outputJson, JSON.stringify(executionPlan), annotations.read_only === true ? 1 : 0,
        annotations.destructive === true ? 1 : 0, annotations.idempotent === true ? 1 : 0,
        annotations.requires_confirmation === true || annotations.destructive === true ? 1 : 0,
        runtime.connection_type ? String(runtime.connection_type) : null,
        JSON.stringify(Array.isArray(runtime.required_scopes) ? runtime.required_scopes : []),
        String(method.semantic_family || `${pluginId}:${capabilityId}:${methodName.split(/[._-]/u)[0]}`),
        method.presentation_mode === "visual" ? "visual" : "data",
        await sha256Base64Url(`${inputJson}\n${outputJson}`), searchHash, now, now));
      for (const alias of Array.isArray(method.aliases) ? method.aliases.slice(0, 20) : []) {
        if (typeof alias === "string" && alias.trim()) statements.push(
          db.prepare("INSERT OR IGNORE INTO w_tool_aliases (tool_id, alias, alias_type) VALUES (?, ?, 'synonym')")
            .bind(toolId, redactSensitiveText(alias.trim())),
        );
      }
      callableTools += 1;
    }
  }
  await db.batch(statements);
  await bumpCatalogRevision(env);
  return { ok: true, plugin_id: pluginId, version, status: "validated", callable_tools: callableTools };
}

async function setPluginVersionStatus(env: Env, pluginId: string, version: string, status: "published" | "deprecated") {
  await ensureWGatewaySchema(env);
  const db = wDatabase(env);
  const id = `${safeKey(pluginId).replaceAll(":", "-")}@${version}`;
  const row = await db.prepare("SELECT id FROM w_plugin_versions WHERE id = ?").bind(id).first<{ id: string }>();
  if (!row) return { ok: false, error: "Plugin version not found." };
  const now = new Date().toISOString();
  await db.prepare("UPDATE w_plugin_versions SET status = ?, published_at = COALESCE(published_at, ?) WHERE id = ?")
    .bind(status, now, id).run();
  if (status === "published") {
    await db.batch([
      db.prepare("UPDATE w_plugins SET current_version_id = ?, enabled = 1, updated_at = ? WHERE id = ?")
        .bind(id, now, safeKey(pluginId).replaceAll(":", "-")),
      db.prepare("UPDATE w_capabilities SET enabled = 1 WHERE plugin_version_id = ?").bind(id),
      db.prepare("UPDATE w_tools SET enabled = 1, status = 'published', updated_at = ? WHERE capability_id IN (SELECT id FROM w_capabilities WHERE plugin_version_id = ?)")
        .bind(now, id),
    ]);
    await indexImportedVersion(env, id);
  } else {
    await db.batch([
      db.prepare("UPDATE w_capabilities SET enabled = 0 WHERE plugin_version_id = ?").bind(id),
      db.prepare("UPDATE w_tools SET enabled = 0, status = 'deprecated', updated_at = ? WHERE capability_id IN (SELECT id FROM w_capabilities WHERE plugin_version_id = ?)")
        .bind(now, id),
      db.prepare("UPDATE w_plugins SET current_version_id = NULL, updated_at = ? WHERE id = ? AND current_version_id = ?")
        .bind(now, safeKey(pluginId).replaceAll(":", "-"), id),
    ]);
  }
  await bumpCatalogRevision(env);
  return { ok: true, plugin_id: pluginId, version, status };
}

async function rollbackPlugin(env: Env, pluginId: string, version: string) {
  const result = await setPluginVersionStatus(env, pluginId, version, "published");
  if (!result.ok) return result;
  return { ...result, rolled_back: true };
}

function normalizePluginManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  const normalized = structuredClone(manifest);
  if (Array.isArray(normalized.capabilities)) {
    normalized.capabilities = normalized.capabilities.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const capability = { ...(value as Record<string, unknown>) };
      if (capability.kind === "connector") capability.kind = "plugin";
      return capability;
    });
  }
  return normalized;
}

function validateSkillApi(value: unknown, capability: Record<string, unknown>, errors: string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`skill ${String(capability.id || "")} has no readable API contract`);
    return;
  }
  const api = value as Record<string, unknown>;
  if (api.format !== "oneai.skill-api.v1") errors.push(`skill ${String(capability.id)} uses an unsupported API format`);
  if (api.runtime !== "javascript") errors.push(`skill ${String(capability.id)} must use the javascript runtime`);
  if (!String(api.entry || "").trim()) errors.push(`skill ${String(capability.id)} needs an explicit entry`);
  if (!Array.isArray(api.methods) || !api.methods.length) {
    errors.push(`skill ${String(capability.id)} needs at least one method`);
    return;
  }
  const runtime = asRecord(capability.runtime);
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/u.test(String(runtime.plugin_id || ""))) {
    errors.push(`skill ${String(capability.id)} needs a fixed runtime plugin_id`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/u.test(String(runtime.operation || ""))) {
    errors.push(`skill ${String(capability.id)} needs a fixed runtime operation`);
  }
  const names = new Set<string>();
  for (const rawMethod of api.methods as unknown[]) {
    if (!rawMethod || typeof rawMethod !== "object" || Array.isArray(rawMethod)) {
      errors.push(`skill ${String(capability.id)} contains an invalid method`);
      continue;
    }
    const method = rawMethod as Record<string, unknown>;
    const name = String(method.name || "");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/u.test(name)) errors.push(`skill method name is invalid: ${name}`);
    if (names.has(name)) errors.push(`skill method is duplicated: ${name}`);
    names.add(name);
    if (!String(method.description || "").trim()) errors.push(`skill method ${name} needs a description`);
    if (!isJsonSchema(method.input_schema)) errors.push(`skill method ${name} needs an input JSON Schema`);
    if (!isJsonSchema(method.output_schema)) errors.push(`skill method ${name} needs an output JSON Schema`);
    const annotations = asRecord(method.annotations);
    for (const key of ["read_only", "destructive", "requires_confirmation"]) {
      if (typeof annotations[key] !== "boolean") errors.push(`skill method ${name} needs boolean ${key}`);
    }
  }
}

function resolveArtifact(manifest: Record<string, unknown>, reference: unknown, inline: unknown): unknown {
  if (inline && typeof inline === "object" && !Array.isArray(inline)) return inline;
  const artifacts = asRecord(manifest.artifacts);
  const value = artifacts[String(reference || "")];
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function isJsonSchema(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const schema = value as Record<string, unknown>;
  return typeof schema.type === "string" || Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf) || typeof schema.$ref === "string";
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

async function removeImportedVersionRecords(db: D1Database, versionId: string): Promise<void> {
  const tools = await db.prepare(
    "SELECT id, tool_ref FROM w_tools WHERE capability_id IN (SELECT id FROM w_capabilities WHERE plugin_version_id = ?)",
  ).bind(versionId).all<{ id: string; tool_ref: string }>();
  for (const tool of tools.results || []) {
    await db.batch([
      db.prepare("DELETE FROM w_tool_fts WHERE tool_ref = ?").bind(tool.tool_ref),
      db.prepare("DELETE FROM w_tool_vectors WHERE tool_id = ?").bind(tool.id),
      db.prepare("DELETE FROM w_embedding_jobs WHERE tool_id = ?").bind(tool.id),
      db.prepare("DELETE FROM w_tool_aliases WHERE tool_id = ?").bind(tool.id),
      db.prepare("DELETE FROM w_tool_examples WHERE tool_id = ?").bind(tool.id),
    ]);
  }
  await db.batch([
    db.prepare("DELETE FROM w_tools WHERE capability_id IN (SELECT id FROM w_capabilities WHERE plugin_version_id = ?)").bind(versionId),
    db.prepare("DELETE FROM w_capabilities WHERE plugin_version_id = ?").bind(versionId),
    db.prepare("DELETE FROM w_plugin_versions WHERE id = ? AND status != 'published'").bind(versionId),
  ]);
}

async function indexImportedVersion(env: Env, versionId: string): Promise<void> {
  const db = wDatabase(env);
  const published = await db.prepare(
    `SELECT COUNT(DISTINCT p.id) AS count
     FROM w_plugins p
     JOIN w_plugin_versions pv ON pv.id = p.current_version_id AND pv.status = 'published'
     WHERE p.enabled = 1`,
  ).first<{ count: number }>();
  const semanticEnabled = Number(published?.count || 0) >= semanticPluginThreshold(env);
  const rows = await db.prepare(
    `SELECT t.id, t.tool_ref, t.title, t.description, t.search_text, t.search_text_hash,
            c.capability_id, pv.plugin_id,
            COALESCE((SELECT GROUP_CONCAT(alias, ' ') FROM w_tool_aliases a WHERE a.tool_id = t.id), '') AS aliases
     FROM w_tools t
     JOIN w_capabilities c ON c.id = t.capability_id
     JOIN w_plugin_versions pv ON pv.id = c.plugin_version_id
     WHERE pv.id = ?`,
  ).bind(versionId).all<{
    id: string;
    tool_ref: string;
    title: string;
    description: string;
    search_text: string;
    search_text_hash: string;
    capability_id: string;
    plugin_id: string;
    aliases: string;
  }>();
  const now = new Date().toISOString();
  for (const tool of rows.results || []) {
    const statements = [
      db.prepare("DELETE FROM w_tool_fts WHERE tool_ref = ?").bind(tool.tool_ref),
      db.prepare(
        `INSERT INTO w_tool_fts (tool_ref, plugin_id, capability_id, title, description, aliases, search_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(tool.tool_ref, tool.plugin_id, tool.capability_id, tool.title, tool.description, tool.aliases, tool.search_text),
    ];
    if (semanticEnabled) {
      statements.push(db.prepare(
        `INSERT INTO w_embedding_jobs (id, tool_id, reason, status, attempts, created_at)
         SELECT ?, ?, 'plugin_publish', 'queued', 0, ?
         WHERE NOT EXISTS (SELECT 1 FROM w_tool_vectors WHERE tool_id = ? AND source_text_hash = ?)
           AND NOT EXISTS (SELECT 1 FROM w_embedding_jobs WHERE tool_id = ? AND status IN ('queued', 'running'))`,
      ).bind(`wej_${(await sha256Base64Url(`${tool.tool_ref}:${tool.search_text_hash}`)).slice(0, 32)}`,
        tool.id, now, tool.id, tool.search_text_hash, tool.id));
    }
    await db.batch(statements);
  }
  if (semanticEnabled) await processEmbeddingJobs(env, 64);
}

function pluginSearchDocument(
  manifest: Record<string, unknown>,
  capability: Record<string, unknown>,
  method: Record<string, unknown>,
  toolRef: string,
): string {
  const annotations = asRecord(method.annotations);
  return redactSensitiveText([
    `Plugin: ${String(manifest.name || manifest.id)}`,
    `Capability: ${String(capability.title || capability.id)}`,
    `Tool: ${String(method.title || method.name)}`,
    `Canonical reference: ${toolRef}`,
    `Purpose: ${String(method.description || "")}`,
    `Use when: ${(Array.isArray(method.aliases) ? method.aliases : []).join(", ") || String(method.name)}`,
    "Do not use when: another published operation is a closer match.",
    "Produces: structured result.",
    `Side effect: ${annotations.read_only === true ? "none; read only" : annotations.destructive === true ? "can remove data" : "can change external data"}.`,
    `Authentication: ${asRecord(capability.runtime).connection_type ? "a connected account is required" : "no extra account"}.`,
  ].join("\n"));
}

async function rebuildEmbeddings(env: Env) {
  await ensureWGatewaySchema(env);
  const db = wDatabase(env);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM w_tool_vectors"),
    db.prepare("DELETE FROM w_vector_clusters"),
    db.prepare("DELETE FROM w_embedding_jobs"),
    db.prepare(
      `INSERT INTO w_embedding_jobs (id, tool_id, reason, status, attempts, created_at)
       SELECT 'wej_' || substr(id, 4), id, 'admin_rebuild', 'queued', 0, ? FROM w_tools WHERE enabled = 1`,
    ).bind(now),
  ]);
  return processEmbeddingJobs(env, 64);
}

async function catalogStatus(env: Env, context: WRequestContext) {
  await ensureWGatewaySchema(env);
  const db = wDatabase(env);
  const counts: Record<string, number> = {};
  for (const table of ["w_plugins", "w_plugin_versions", "w_capabilities", "w_tools", "w_tool_vectors", "w_embedding_jobs"]) {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
    counts[table] = Number(row?.count || 0);
  }
  return { ok: true, endpoint_id: context.endpointId, revision: await catalogRevision(env), counts };
}

function safeJson(value: string, fallback: unknown): unknown {
  try { return JSON.parse(value); } catch { return fallback; }
}
