import { z } from "zod";
import { sha256Base64Url } from "../crypto";
import { redactSensitiveText } from "../security";
import { APP_VERSION } from "../update";
import type { Env } from "../types";
import { ensureCredentialSchema } from "../vault";
import { ensureMarketplaceSchema, type InstalledPackageRow } from "../marketplace";
import {
  ensureConnectorSchema,
  humanizeActionName,
  isDestructiveConnectorAction,
  isReadOnlyConnectorAction,
  SYSTEM_ACTIONS,
} from "../tools/integrations";
import { NATIVE_TOOLS } from "../tools/native";
import type { ActionRow, ConnectorRow } from "../tools/connectors/types";
import { processEmbeddingJobs, rebuildVectorClusters } from "./embeddings";
import { bumpCatalogRevision, ensureWGatewaySchema, metaValue, setMetaValue, wDatabase } from "./schema";
import type { CapabilityKind, WExecutionPlan } from "./types";

interface RegistryToolInput {
  pluginId: string;
  pluginName: string;
  pluginDescription: string;
  version: string;
  packageFormat: string;
  packageHash: string;
  capabilityId: string;
  capabilityKind: CapabilityKind;
  capabilityTitle: string;
  capabilityDescription: string;
  target: string;
  runtimeType: string;
  methodName: string;
  title: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  executionPlan: WExecutionPlan;
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
  requiresConfirmation: boolean;
  connectionType?: string | null;
  requiredScopes?: string[];
  semanticFamily?: string | null;
  aliases?: string[];
  presentationMode?: "data" | "visual";
}

export async function syncWRegistry(
  env: Env,
  options: { force?: boolean; embeddings?: boolean; clusters?: boolean } = {},
): Promise<{ changed: boolean; revision: number; tools: number; embeddings?: unknown; clusters?: unknown }> {
  await ensureConnectorSchema(env);
  await ensureMarketplaceSchema(env);
  await ensureCredentialSchema(env);
  await ensureWGatewaySchema(env);
  const tools = await collectRegistryTools(env);
  const fingerprint = await sha256Base64Url(JSON.stringify(tools.map((item) => ({
    ref: toolRef(item),
    schema: item.inputSchema,
    description: item.description,
    aliases: item.aliases || [],
    plan: item.executionPlan,
  }))));
  const previous = await metaValue(env, "registry_fingerprint");
  let revision = Number.parseInt(await metaValue(env, "catalog_revision") || "0", 10) || 0;
  let changed = options.force === true || fingerprint !== previous;
  if (changed) {
    await writeRegistry(env, tools);
    await syncLegacyConnections(env);
    await setMetaValue(env, "registry_fingerprint", fingerprint);
    revision = await bumpCatalogRevision(env);
  }
  const embeddingResult = options.embeddings === false ? undefined : await processEmbeddingJobs(env);
  const clusterResult = options.clusters ? await rebuildVectorClusters(env) : undefined;
  return { changed, revision, tools: tools.length, embeddings: embeddingResult, clusters: clusterResult };
}

export async function ensureWRegistryCurrent(env: Env): Promise<void> {
  await syncWRegistry(env, { embeddings: true });
}

async function collectRegistryTools(env: Env): Promise<RegistryToolInput[]> {
  const output: RegistryToolInput[] = [];
  const systemVersion = APP_VERSION;
  for (const action of SYSTEM_ACTIONS) {
    const methodName = publicMethodName(action.name);
    const publicSchema = publicSystemInputSchema(action.schema);
    output.push({
      pluginId: "oneaiworkers",
      pluginName: "OneAIWorkers",
      pluginDescription: "Private MCP gateway, plugin registry, Workers AI, and automation runtime.",
      version: systemVersion,
      packageFormat: "oneai.plugin.v1",
      packageHash: `builtin:${systemVersion}`,
      capabilityId: "system",
      capabilityKind: "plugin",
      capabilityTitle: "OneAIWorkers system",
      capabilityDescription: "Manages installed plugins, settings, updates, and live runtime state.",
      target: "oneaiworkers-cloudflare",
      runtimeType: "native",
      methodName,
      title: humanizeActionName(methodName),
      description: userFacingDescription(action.description),
      inputSchema: publicSchema.schema,
      outputSchema: { type: "object" },
      executionPlan: {
        type: "legacy",
        connector_id: "system",
        action_name: action.name,
        argument_aliases: publicSchema.argumentAliases,
        value_aliases: publicSchema.valueAliases,
      },
      readOnly: action.read_only,
      destructive: action.name.startsWith("delete_"),
      idempotent: action.read_only,
      requiresConfirmation: action.requires_confirmation,
      semanticFamily: `system:${familyFor(methodName)}`,
      aliases: aliasesFor(methodName),
    });
  }
  for (const native of NATIVE_TOOLS) {
    const agent = native.name.startsWith("agent_");
    const methodName = publicMethodName(native.name);
    output.push({
      pluginId: "oneaiworkers",
      pluginName: "OneAIWorkers",
      pluginDescription: "Private MCP gateway, plugin registry, Workers AI, and automation runtime.",
      version: systemVersion,
      packageFormat: "oneai.plugin.v1",
      packageHash: `builtin:${systemVersion}`,
      capabilityId: agent ? "agents" : "workers-ai",
      capabilityKind: agent ? "agent" : "plugin",
      capabilityTitle: agent ? "AI agents" : "Workers AI",
      capabilityDescription: agent ? "Creates and runs bounded agent teams." : "Runs Cloudflare Workers AI models.",
      target: "oneaiworkers-cloudflare",
      runtimeType: "native",
      methodName,
      title: humanizeActionName(methodName),
      description: userFacingDescription(native.description),
      inputSchema: inputJsonSchema(native.schema),
      outputSchema: { type: "object" },
      executionPlan: { type: "legacy", connector_id: "native", action_name: native.name },
      readOnly: native.read_only,
      destructive: /delete|cancel|revoke/u.test(native.name),
      idempotent: native.read_only,
      requiresConfirmation: native.requires_confirmation,
      semanticFamily: `${agent ? "agent" : "native"}:${familyFor(methodName)}`,
      aliases: aliasesFor(methodName),
    });
  }

  const db = wDatabase(env);
  const connectorRows = await db.prepare("SELECT * FROM connectors WHERE enabled = 1 ORDER BY connector_id").all<ConnectorRow>();
  const actionRows = await db.prepare("SELECT * FROM connector_actions ORDER BY connector_id, action_name").all<ActionRow>();
  const packageRows = await db.prepare("SELECT * FROM connector_packages ORDER BY connector_id").all<InstalledPackageRow>();
  const packages = new Map((packageRows.results || []).map((row) => [row.connector_id, row]));
  const actionsByPlugin = new Map<string, ActionRow[]>();
  for (const action of actionRows.results || []) {
    const list = actionsByPlugin.get(action.connector_id) || [];
    list.push(action);
    actionsByPlugin.set(action.connector_id, list);
  }
  for (const plugin of connectorRows.results || []) {
    const installed = packages.get(plugin.connector_id);
    const version = installed?.installed_version || legacyVersion(plugin.updated_at);
    const capabilityId = plugin.mode === "child_worker" ? "cloud" : "api";
    for (const action of actionsByPlugin.get(plugin.connector_id) || []) {
      const methodName = publicMethodName(action.action_name);
      const inputSchema = action.input_schema_json ? safeJson(action.input_schema_json, { type: "object" }) : { type: "object" };
      const readOnly = isReadOnlyConnectorAction(action);
      output.push({
        pluginId: plugin.connector_id,
        pluginName: plugin.name,
        pluginDescription: plugin.description || `${plugin.name} plugin for OneAIWorkers.`,
        version,
        packageFormat: installed ? "oneaiworkers.connector.v1" : "oneaiworkers.connector.v1",
        packageHash: installed?.checksum || `legacy:${plugin.updated_at}`,
        capabilityId,
        capabilityKind: "plugin",
        capabilityTitle: plugin.name,
        capabilityDescription: plugin.description || `${plugin.name} operations.`,
        target: "oneaiworkers-cloudflare",
        runtimeType: plugin.mode === "child_worker" ? "child_worker" : "http",
        methodName,
        title: `${plugin.name}: ${humanizeActionName(methodName)}`,
        description: userFacingDescription(action.description || `Runs ${humanizeActionName(methodName)} in ${plugin.name}.`),
        inputSchema,
        outputSchema: { type: "object" },
        executionPlan: { type: "legacy", connector_id: plugin.connector_id, action_name: action.action_name },
        readOnly,
        destructive: isDestructiveConnectorAction(action),
        idempotent: readOnly,
        requiresConfirmation: !readOnly,
        connectionType: requiresConnection(plugin, action, installed) ? plugin.connector_id : null,
        semanticFamily: `${plugin.connector_id}:${familyFor(methodName)}`,
        aliases: aliasesFor(methodName),
        presentationMode: isVisualMethod(methodName) ? "visual" : "data",
      });
    }
  }
  return output.sort((left, right) => toolRef(left).localeCompare(toolRef(right)));
}

async function writeRegistry(env: Env, tools: RegistryToolInput[]): Promise<void> {
  const db = wDatabase(env);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE w_plugins SET enabled = 0, updated_at = ? WHERE publisher_id = 'oneai'").bind(now),
    db.prepare(
      "UPDATE w_capabilities SET enabled = 0 WHERE plugin_version_id IN (SELECT pv.id FROM w_plugin_versions pv JOIN w_plugins p ON p.id = pv.plugin_id WHERE p.publisher_id = 'oneai')",
    ),
    db.prepare(
      "UPDATE w_tools SET enabled = 0, updated_at = ? WHERE capability_id IN (SELECT c.id FROM w_capabilities c JOIN w_plugin_versions pv ON pv.id = c.plugin_version_id JOIN w_plugins p ON p.id = pv.plugin_id WHERE p.publisher_id = 'oneai')",
    ).bind(now),
  ];
  const pluginVersions = new Set<string>();
  const capabilities = new Set<string>();
  for (const item of tools) {
    const versionId = versionKey(item.pluginId, item.version);
    const capabilityKey = capabilityKeyFor(versionId, item.capabilityId);
    const ref = toolRef(item);
    const toolId = await stableId("wt", ref);
    const inputSchemaJson = JSON.stringify(item.inputSchema || { type: "object" });
    const outputSchemaJson = item.outputSchema === undefined ? null : JSON.stringify(item.outputSchema);
    const schemaHash = await sha256Base64Url(`${inputSchemaJson}\n${outputSchemaJson || ""}`);
    const searchText = searchDocument(item, ref);
    const searchHash = await sha256Base64Url(searchText);
    if (!pluginVersions.has(versionId)) {
      statements.push(db.prepare(
        `INSERT INTO w_plugins (id, name, description, publisher_id, enabled, current_version_id, created_at, updated_at)
         VALUES (?, ?, ?, 'oneai', 1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
           enabled = 1, current_version_id = excluded.current_version_id, updated_at = excluded.updated_at`,
      ).bind(item.pluginId, redactSensitiveText(item.pluginName), redactSensitiveText(item.pluginDescription), versionId, now, now));
      statements.push(db.prepare(
        `INSERT INTO w_plugin_versions
           (id, plugin_id, version, package_format, package_hash, target_json, manifest_json, status, created_at, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
         ON CONFLICT(id) DO UPDATE SET package_hash = excluded.package_hash, target_json = excluded.target_json,
           manifest_json = excluded.manifest_json, status = 'published', published_at = excluded.published_at`,
      ).bind(versionId, item.pluginId, item.version, item.packageFormat, item.packageHash,
        JSON.stringify([item.target]), JSON.stringify({ format: "oneai.plugin.v1", id: item.pluginId, version: item.version }), now, now));
      pluginVersions.add(versionId);
    }
    if (!capabilities.has(capabilityKey)) {
      statements.push(db.prepare(
        `INSERT INTO w_capabilities
           (id, plugin_version_id, capability_id, kind, target, title, description, enabled,
            runtime_type, runtime_config_json, permission_manifest_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, '{}', '{}', ?)
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, target = excluded.target,
           title = excluded.title, description = excluded.description, enabled = 1, runtime_type = excluded.runtime_type`,
      ).bind(capabilityKey, versionId, item.capabilityId, item.capabilityKind, item.target,
        redactSensitiveText(item.capabilityTitle), redactSensitiveText(item.capabilityDescription), item.runtimeType, now));
      capabilities.add(capabilityKey);
    }
    statements.push(db.prepare(
      `INSERT INTO w_tools
         (id, capability_id, tool_ref, method_name, version, title, description, search_text,
          input_schema_json, output_schema_json, execution_plan_json, read_only, destructive,
          idempotent, requires_confirmation, connection_type, required_scopes_json,
          semantic_family, presentation_mode, enabled, status, schema_hash, search_text_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'published', ?, ?, ?, ?)
       ON CONFLICT(tool_ref) DO UPDATE SET capability_id = excluded.capability_id,
         title = excluded.title, description = excluded.description, search_text = excluded.search_text,
         input_schema_json = excluded.input_schema_json, output_schema_json = excluded.output_schema_json,
         execution_plan_json = excluded.execution_plan_json, read_only = excluded.read_only,
         destructive = excluded.destructive, idempotent = excluded.idempotent,
         requires_confirmation = excluded.requires_confirmation, connection_type = excluded.connection_type,
         required_scopes_json = excluded.required_scopes_json, semantic_family = excluded.semantic_family,
         presentation_mode = excluded.presentation_mode, enabled = 1, status = 'published',
         schema_hash = excluded.schema_hash, search_text_hash = excluded.search_text_hash, updated_at = excluded.updated_at`,
    ).bind(toolId, capabilityKey, ref, item.methodName, item.version, redactSensitiveText(item.title), redactSensitiveText(item.description),
      searchText, inputSchemaJson, outputSchemaJson, JSON.stringify(item.executionPlan),
      item.readOnly ? 1 : 0, item.destructive ? 1 : 0, item.idempotent ? 1 : 0,
      item.requiresConfirmation ? 1 : 0, item.connectionType || null,
      JSON.stringify(item.requiredScopes || []), item.semanticFamily || null,
      item.presentationMode || "data", schemaHash, searchHash, now, now));
    statements.push(db.prepare("DELETE FROM w_tool_aliases WHERE tool_id = ?").bind(toolId));
    for (const alias of [...new Set(item.aliases || [])].slice(0, 20)) {
      statements.push(db.prepare(
        "INSERT OR IGNORE INTO w_tool_aliases (tool_id, alias, alias_type) VALUES (?, ?, 'synonym')",
      ).bind(toolId, redactSensitiveText(alias)));
    }
    statements.push(db.prepare(
      `INSERT INTO w_embedding_jobs (id, tool_id, reason, status, attempts, created_at)
       SELECT ?, ?, 'registry_sync', 'queued', 0, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM w_tool_vectors WHERE tool_id = ? AND source_text_hash = ?
       ) AND NOT EXISTS (
         SELECT 1 FROM w_embedding_jobs WHERE tool_id = ? AND status IN ('queued', 'running')
       )`,
    ).bind(await stableId("wej", `${ref}:${searchHash}`), toolId, now, toolId, searchHash, toolId));
  }
  await db.batch(statements);

  for (const item of tools) {
    const ref = toolRef(item);
    const toolId = await stableId("wt", ref);
    await db.prepare("DELETE FROM w_tool_fts WHERE tool_ref = ?").bind(ref).run();
    await db.prepare(
      `INSERT INTO w_tool_fts (tool_ref, plugin_id, capability_id, title, description, aliases, search_text)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(ref, item.pluginId, item.capabilityId, redactSensitiveText(item.title), redactSensitiveText(item.description),
      redactSensitiveText((item.aliases || []).join(" ")), searchDocument(item, ref)).run();
    const existing = await db.prepare("SELECT id FROM w_tools WHERE tool_ref = ?").bind(ref).first<{ id: string }>();
    if (existing?.id !== toolId) throw new Error(`W registry tool identity mismatch for ${ref}.`);
  }
}

async function syncLegacyConnections(env: Env): Promise<void> {
  const db = wDatabase(env);
  const rows = await db.prepare(
    "SELECT connector_id, profile_id, updated_at FROM connector_credentials ORDER BY connector_id, profile_id",
  ).all<{ connector_id: string; profile_id: string; updated_at: number }>();
  for (const row of rows.results || []) {
    if (row.profile_id !== "user") continue;
    const id = `conn_${row.connector_id}_user`;
    const timestamp = new Date(row.updated_at * 1000).toISOString();
    await db.prepare(
      `INSERT INTO w_connections
         (id, tenant_id, user_id, plugin_id, connection_type, display_name, auth_type,
          encrypted_credentials, granted_scopes_json, status, expires_at, credential_version, created_at, updated_at)
       VALUES (?, 'default', NULL, ?, ?, ?, 'legacy_vault', '{"source":"legacy_vault"}', '[]', 'active', NULL, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = 'active', updated_at = excluded.updated_at`,
    ).bind(id, row.connector_id, row.connector_id, `${row.connector_id} account`, timestamp, timestamp).run();
  }
}

function searchDocument(item: RegistryToolInput, ref: string): string {
  return redactSensitiveText([
    `Plugin: ${item.pluginName}`,
    `Capability: ${item.capabilityTitle}`,
    `Tool: ${item.title}`,
    `Canonical reference: ${ref}`,
    `Purpose: ${item.description}`,
    `Use when: ${(item.aliases || []).join(", ") || item.methodName}`,
    `Do not use when: a different operation or plugin is required.`,
    `Produces: ${item.outputSchema ? "structured result" : "result"}.`,
    `Side effect: ${item.readOnly ? "none; read only" : item.destructive ? "can delete or revoke data" : "can change external data"}.`,
    `Authentication: ${item.connectionType ? `connected ${item.pluginName} account` : "no extra connection"}.`,
    `Aliases: ${(item.aliases || []).join(", ")}.`,
  ].join("\n"));
}

function toolRef(item: RegistryToolInput): string {
  return `${item.pluginId}:${item.capabilityId}/${item.methodName}@${item.version}`;
}

function versionKey(pluginId: string, version: string): string {
  return `${pluginId}@${version}`;
}

function capabilityKeyFor(versionId: string, capabilityId: string): string {
  return `${versionId}:${capabilityId}`;
}

async function stableId(prefix: string, value: string): Promise<string> {
  return `${prefix}_${(await sha256Base64Url(value)).slice(0, 26)}`;
}

function legacyVersion(updatedAt: number): string {
  return `0.0.${Math.max(1, Math.trunc(updatedAt || 1))}`;
}

function familyFor(name: string): string {
  return name.toLowerCase().replace(/^(get|list|create|update|delete|run|call|find|search|check|test)_/u, "") || name;
}

function aliasesFor(name: string): string[] {
  const words = name.replaceAll("_", " ");
  const verbAliases: Record<string, string[]> = {
    list: ["show", "find", "перелік", "покажи"],
    get: ["read", "inspect", "отримати", "прочитати"],
    create: ["add", "make", "створити", "додати"],
    update: ["edit", "change", "оновити", "змінити"],
    delete: ["remove", "видалити"],
    search: ["find", "lookup", "знайти", "пошук"],
    run: ["execute", "start", "запустити", "виконати"],
  };
  const verb = name.split("_")[0];
  return [words, ...(verbAliases[verb] || []).map((alias) => `${alias} ${words.split(" ").slice(1).join(" ")}`.trim())];
}

function userFacingDescription(value: string): string {
  return redactSensitiveText(value
    .replace(/connectors?/giu, "plugins")
    .replace(/конектор(ів|и|а|ом|у|і|ами|ах)?/giu, "плагін")
    .replace(/child Worker/giu, "plugin Worker"));
}

function publicMethodName(value: string): string {
  const exact: Record<string, string> = {
    connector_setup_status: "plugin_setup_status",
    connector_installation_help: "plugin_installation_help",
    list_connector_updates: "list_plugin_updates",
    get_connector_settings_link: "get_plugin_settings_link",
    save_connector: "save_plugin",
    list_connectors: "list_plugins",
    test_connector: "test_plugin",
    call_connector_tool: "call_plugin_operation",
    delete_connector: "delete_plugin",
    create_child_worker_from_template: "create_plugin_from_template",
    deploy_custom_child_worker: "deploy_custom_plugin",
  };
  return exact[value] || value.replace(/connectors?/giu, "plugins");
}

function publicSystemInputSchema(schema: z.ZodType): {
  schema: Record<string, unknown>;
  argumentAliases: Record<string, string>;
  valueAliases: Record<string, Record<string, string>>;
} {
  const input = inputJsonSchema(schema);
  const properties = input.properties && typeof input.properties === "object" && !Array.isArray(input.properties)
    ? input.properties as Record<string, unknown>
    : {};
  const aliases: Record<string, string> = {
    plugin_id: "connector_id",
    include_plugins: "include_connectors",
    plugin_url: "child_worker_url",
    plugin_binding: "child_worker_binding",
    plugin_token_secret: "child_worker_token_secret",
    plugin_token_credential: "child_worker_token_credential",
  };
  const reverse = Object.fromEntries(Object.entries(aliases).map(([publicKey, legacyKey]) => [legacyKey, publicKey]));
  const renamed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) renamed[reverse[key] || key] = pluginizeSchemaValue(value);
  const required = Array.isArray(input.required)
    ? input.required.map((key) => reverse[String(key)] || String(key))
    : undefined;
  return {
    schema: { ...input, properties: renamed, ...(required ? { required } : {}) },
    argumentAliases: Object.fromEntries(Object.entries(aliases).filter(([publicKey]) => publicKey in renamed)),
    valueAliases: "mode" in renamed ? { mode: { plugin_worker: "child_worker" } } : {},
  };
}

function pluginizeSchemaValue(value: unknown): unknown {
  if (typeof value === "string") return userFacingDescription(value).replaceAll("child_worker", "plugin_worker");
  if (Array.isArray(value)) return value.map(pluginizeSchemaValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, pluginizeSchemaValue(child)]));
}

function requiresConnection(plugin: ConnectorRow, action: ActionRow, installed?: InstalledPackageRow): boolean {
  if (plugin.mode === "child_worker" && installed) {
    try {
      const fields = JSON.parse(installed.credential_fields_json) as unknown[];
      if (Array.isArray(fields) && fields.length > 0) return true;
    } catch { return true; }
  }
  try { return (JSON.parse(action.auth_json) as { type?: string }).type !== "none"; } catch { return true; }
}

function isVisualMethod(name: string): boolean {
  return /(screenshot|render|preview|image|diagram)/u.test(name.toLowerCase());
}

function safeJson(value: string, fallback: unknown): unknown {
  try { return JSON.parse(value); } catch { return fallback; }
}

function inputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return { ...z.toJSONSchema(schema, { io: "input" }), additionalProperties: false };
}
