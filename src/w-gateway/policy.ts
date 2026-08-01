import type { Env } from "../types";
import { ensureWGatewaySchema, wDatabase } from "./schema";
import type { CapabilityKind, WEndpointConfig, WPermission, WRequestContext, WToolRecord } from "./types";

export interface WPolicy {
  config: WEndpointConfig;
  restricted: boolean;
  plugins: Set<string>;
  capabilities: Set<string>;
  tools: Set<string>;
  kinds: Set<string>;
}

export async function loadPolicy(env: Env, context: WRequestContext, permission: WPermission): Promise<WPolicy> {
  await ensureWGatewaySchema(env);
  const db = wDatabase(env);
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT OR IGNORE INTO w_endpoint_configs
       (endpoint_id, exposure_mode, exposed_plugins_json, exposed_capability_kinds_json,
        allow_direct_tools_json, access_level, updated_at)
     VALUES (?, ?, '[]', '["plugin","skill","agent"]', '[]', 'edit', ?)`,
  ).bind(context.endpointId, context.exposureMode, now).run();
  const config = await db.prepare("SELECT * FROM w_endpoint_configs WHERE endpoint_id = ?")
    .bind(context.endpointId).first<WEndpointConfig>();
  if (!config) throw new Error("W Gateway endpoint configuration is unavailable.");
  const rows = await db.prepare(
    "SELECT subject_type, subject_id FROM w_endpoint_permissions WHERE endpoint_id = ? AND permission = ?",
  ).bind(context.endpointId, permission).all<{ subject_type: string; subject_id: string }>();
  const plugins = new Set<string>();
  const capabilities = new Set<string>();
  const tools = new Set<string>();
  for (const row of rows.results || []) {
    if (row.subject_type === "plugin") plugins.add(row.subject_id);
    if (row.subject_type === "capability") capabilities.add(row.subject_id);
    if (row.subject_type === "tool") tools.add(row.subject_id);
  }
  return {
    config,
    restricted: (rows.results || []).length > 0,
    plugins,
    capabilities,
    tools,
    kinds: new Set(parseStringArray(config.exposed_capability_kinds_json)),
  };
}

export function toolAllowed(policy: WPolicy, tool: WToolRecord, permission: WPermission): boolean {
  if (!tool.enabled || !tool.plugin_enabled || tool.status !== "published") return false;
  const exposedPlugins = parseStringArray(policy.config.exposed_plugins_json);
  if (exposedPlugins.length && !exposedPlugins.includes(tool.plugin_id)) return false;
  if (policy.kinds.size && !policy.kinds.has(tool.capability_kind)) return false;
  if (policy.config.access_level === "read" && !tool.read_only && permission === "execute") return false;
  if (!policy.restricted) return true;
  return policy.plugins.has(tool.plugin_id) ||
    policy.capabilities.has(tool.capability_key) ||
    policy.capabilities.has(tool.capability_id) ||
    policy.tools.has(tool.id) ||
    policy.tools.has(tool.tool_ref);
}

export function applyRequestFilters(
  policy: WPolicy,
  tool: WToolRecord,
  filters: {
    kinds?: CapabilityKind[];
    connected_only?: boolean;
    read_only?: boolean;
    plugin_ids?: string[];
    target?: string;
  },
): boolean {
  if (!toolAllowed(policy, tool, "discover")) return false;
  if (filters.kinds?.length && !filters.kinds.includes(tool.capability_kind)) return false;
  if (filters.plugin_ids?.length && !filters.plugin_ids.includes(tool.plugin_id)) return false;
  if (filters.target && tool.capability_target !== filters.target) return false;
  if (filters.read_only === true && !tool.read_only) return false;
  if (filters.read_only === false && tool.read_only) return false;
  if (filters.connected_only && tool.connection_type && !tool.connected) return false;
  return true;
}

export function parseStringArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
