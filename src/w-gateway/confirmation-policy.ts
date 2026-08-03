import type { Env } from "../types";
import { ensureWGatewaySchema, wDatabase } from "./schema";
import type { WRequestContext } from "./types";

export interface TrustedPluginPolicy {
  plugin_id: string;
  plugin_version_id: string;
  mode: "automatic";
  updated_at: string;
}

export async function pluginActionsAutomatic(
  env: Env,
  context: WRequestContext,
  pluginId: string,
  pluginVersionId: string,
): Promise<boolean> {
  await ensureWGatewaySchema(env);
  const row = await wDatabase(env).prepare(
    `SELECT 1 AS allowed FROM w_plugin_confirmation_policies
     WHERE tenant_id = ? AND user_id = ? AND endpoint_id = ?
       AND plugin_id = ? AND plugin_version_id = ? AND mode = 'automatic'`,
  ).bind(context.tenantId, context.userId, context.endpointId, pluginId, pluginVersionId)
    .first<{ allowed: number }>();
  return Boolean(row?.allowed);
}

export async function allowAutomaticPluginActions(
  env: Env,
  context: WRequestContext,
  pluginId: string,
  pluginVersionId: string,
): Promise<void> {
  await ensureWGatewaySchema(env);
  const now = new Date().toISOString();
  await wDatabase(env).prepare(
    `INSERT INTO w_plugin_confirmation_policies
       (tenant_id, user_id, endpoint_id, plugin_id, plugin_version_id, mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'automatic', ?, ?)
     ON CONFLICT(tenant_id, user_id, endpoint_id, plugin_id) DO UPDATE SET
       plugin_version_id = excluded.plugin_version_id,
       mode = 'automatic',
       updated_at = excluded.updated_at`,
  ).bind(context.tenantId, context.userId, context.endpointId, pluginId, pluginVersionId, now, now).run();
}

export async function revokeAutomaticPluginActions(
  env: Env,
  context: WRequestContext,
  pluginId: string,
): Promise<boolean> {
  await ensureWGatewaySchema(env);
  const result = await wDatabase(env).prepare(
    `DELETE FROM w_plugin_confirmation_policies
     WHERE tenant_id = ? AND user_id = ? AND endpoint_id = ? AND plugin_id = ?`,
  ).bind(context.tenantId, context.userId, context.endpointId, pluginId).run();
  return Boolean(result.meta.changes);
}

export async function listAutomaticPluginActions(
  env: Env,
  context: WRequestContext,
): Promise<TrustedPluginPolicy[]> {
  await ensureWGatewaySchema(env);
  const rows = await wDatabase(env).prepare(
    `SELECT plugin_id, plugin_version_id, mode, updated_at
     FROM w_plugin_confirmation_policies
     WHERE tenant_id = ? AND user_id = ? AND endpoint_id = ? AND mode = 'automatic'
     ORDER BY plugin_id`,
  ).bind(context.tenantId, context.userId, context.endpointId).all<TrustedPluginPolicy>();
  return rows.results || [];
}
