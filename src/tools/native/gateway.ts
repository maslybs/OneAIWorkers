import { z } from "zod";
import { biInline } from "../../i18n";
import type { Env } from "../../types";
import type { JsonObject } from "../connectors/types";
import { findNativeTool, NATIVE_TOOLS } from "./registry";
import type { NativeToolInvocation } from "./types";

export const NATIVE_CONNECTOR_ID = "native";

const NATIVE_CONNECTOR_ALIASES = new Set([NATIVE_CONNECTOR_ID, "oneaiworkers", "system"]);

export function isNativeConnectorId(connectorId: string): boolean {
  return NATIVE_CONNECTOR_ALIASES.has(connectorId);
}

export function nativeConnectorView(env: Env, includeActions: boolean): JsonObject {
  const connector: JsonObject = {
    connector_id: NATIVE_CONNECTOR_ID,
    name: "OneAIWorkers Native",
    description: "Stable compatibility gateway for native AI and agent capabilities. Discover actions with list_connectors(include_actions=true), then invoke them through call_connector_tool.",
    mode: "native",
    virtual: true,
    persisted_in_d1: false,
    gateway_route: "call_connector_tool",
    enabled: true,
    workers_ai_configured: Boolean(env.AI),
    agent_manager_configured: Boolean(env.AGENT_MANAGER),
  };
  if (includeActions) connector.actions = NATIVE_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: z.toJSONSchema(tool.schema),
    read_only: tool.read_only,
    side_effect: !tool.read_only,
    consumes_ai: tool.consumes_ai,
    requires_confirmation: tool.requires_confirmation,
    available: nativeToolAvailable(env, tool.name),
  }));
  return connector;
}

export async function callNativeTool(env: Env, invocation: NativeToolInvocation): Promise<unknown> {
  const tool = findNativeTool(invocation.action_name);
  if (!tool) {
    throw new Error(biInline(
      `Unknown native action: ${invocation.action_name}. Use list_connectors with include_actions=true to discover current native actions.`,
      `Невідома native action: ${invocation.action_name}. Використайте list_connectors з include_actions=true, щоб отримати актуальні native actions.`,
    ));
  }

  const input: Record<string, unknown> = { ...invocation.input };
  if ("confirmed" in tool.schema.shape) input.confirmed = invocation.confirmed;
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(biInline(
      `Invalid input for ${tool.name}: ${z.prettifyError(parsed.error)}`,
      `Некоректні параметри для ${tool.name}: ${z.prettifyError(parsed.error)}`,
    ));
  }

  if (invocation.dry_run) {
    return {
      ok: true,
      native: true,
      dry_run: true,
      action_name: tool.name,
      validated_input: parsed.data,
      consumes_ai: tool.consumes_ai,
      requires_confirmation: tool.requires_confirmation,
      note: "No native action was executed.",
    };
  }

  if (tool.requires_confirmation && !invocation.confirmed) {
    throw new Error(biInline(
      `Explicit confirmation is required for native action ${tool.name}. Retry call_connector_tool with confirmed=true after the user approves.`,
      `Для native action ${tool.name} потрібне явне підтвердження. Повторіть call_connector_tool з confirmed=true після згоди користувача.`,
    ));
  }

  return {
    ok: true,
    native: true,
    action_name: tool.name,
    result: await tool.handler(env, parsed.data),
  };
}

function nativeToolAvailable(env: Env, actionName: string): boolean {
  if (actionName === "ai_neuron_status" || actionName === "ai_neuron_history") return Boolean(env.OAUTH_DB);
  if (actionName.startsWith("ai_")) return Boolean(env.AI);
  if (actionName === "agent_capabilities" || actionName === "agent_team_propose") return true;
  if (actionName === "agent_team_start") return Boolean(env.AGENT_MANAGER && env.AI);
  if (actionName.startsWith("agent_")) return Boolean(env.AGENT_MANAGER);
  return true;
}
