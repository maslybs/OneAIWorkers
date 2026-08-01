import { randomToken, sha256Base64Url } from "../crypto";
import { redactSensitiveText, redactSensitiveValue } from "../security";
import { callConnectorTool } from "../tools/integrations";
import type { Env } from "../types";
import { consumeConfirmationToken, issueConfirmationToken } from "./confirmation";
import { validateJsonSchema } from "./json-schema";
import { loadPolicy, toolAllowed } from "./policy";
import { normalizeExecutionResult } from "./results";
import { ensureWRegistryCurrent } from "./registry";
import { ensureWGatewaySchema, wDatabase } from "./schema";
import { loadPublishedTools, loadPublishedToolsByRefs } from "./search";
import type { WExecutionPlan, WRequestContext, WToolRecord } from "./types";

export interface WCallInput {
  tool_ref: string;
  arguments: Record<string, unknown>;
  connection_id?: string;
  search_id?: string;
  idempotency_key?: string;
  confirmation_token?: string;
}

export async function wCallLegacyAction(
  env: Env,
  context: WRequestContext,
  input: {
    plugin_id: string;
    action_name: string;
    arguments: Record<string, unknown>;
    dry_run?: boolean;
    idempotency_key?: string;
    confirmation_token?: string;
  },
) {
  await ensureWRegistryCurrent(env);
  const candidates = await loadPublishedTools(env, context, 50_000);
  const tool = candidates.find((candidate) => {
    const plan = safeJson(candidate.execution_plan_json, null) as WExecutionPlan | null;
    return plan?.type === "legacy" && plan.connector_id === input.plugin_id && plan.action_name === input.action_name;
  });
  if (!tool) throw new Error("This plugin operation is not published in the current registry.");
  const plan = safeJson(tool.execution_plan_json, null) as WExecutionPlan | null;
  const publicArguments = compatibilityArguments(
    input.arguments || {},
    plan?.argument_aliases || {},
    plan?.value_aliases || {},
  );
  await resolveExecutableTool(env, context, tool.tool_ref, "execute");
  const validation = validateJsonSchema(safeJson(tool.input_schema_json, { type: "object" }), publicArguments);
  if (!validation.valid) return { ok: false, error: { code: "invalid_arguments", details: validation.errors } };
  if (input.dry_run) {
    return callConnectorTool(env, {
      connector_id: input.plugin_id,
      action_name: input.action_name,
      input: input.arguments || {},
      dry_run: true,
      confirmed: false,
    }, context.baseUrl);
  }
  return wCall(env, context, {
    tool_ref: tool.tool_ref,
    arguments: publicArguments,
    idempotency_key: input.idempotency_key,
    confirmation_token: input.confirmation_token,
  });
}

export async function wCall(env: Env, context: WRequestContext, input: WCallInput) {
  const started = Date.now();
  await ensureWRegistryCurrent(env);
  await ensureWGatewaySchema(env);
  const tool = await resolveExecutableTool(env, context, input.tool_ref, "execute");
  await validateSearchSession(env, context, input.search_id);
  const schema = safeJson(tool.input_schema_json, { type: "object" });
  const validation = validateJsonSchema(schema, input.arguments || {});
  if (!validation.valid) return { ok: false, error: { code: "invalid_arguments", message: "Arguments do not match the stored schema.", details: validation.errors } };
  const argumentsHash = await sha256Base64Url(canonicalJson(input.arguments || {}));
  const connectionId = await resolveConnection(env, context, tool, input.connection_id);

  let confirmationUsed = false;
  if (tool.requires_confirmation) {
    confirmationUsed = await consumeConfirmationToken(env, context, tool.tool_ref, argumentsHash, input.confirmation_token || "");
    if (!confirmationUsed) {
      const issued = await issueConfirmationToken(env, context, tool.tool_ref, argumentsHash);
      return {
        ok: false,
        confirmation_required: true,
        tool_ref: tool.tool_ref,
        confirmation_token: issued.token,
        confirmation_url: `${context.baseUrl}/confirm/${encodeURIComponent(issued.token)}`,
        expires_at: issued.expiresAt,
        message: "Ask the user to open the confirmation link and approve the exact action. Retry only after that approval, with unchanged arguments and this token.",
      };
    }
  }

  const idempotency = await existingIdempotentResult(env, context, tool, input.idempotency_key, argumentsHash);
  if (idempotency) return idempotency;
  const executionId = `wexec_${randomToken(18)}`;
  const keyHash = input.idempotency_key ? await sha256Base64Url(input.idempotency_key) : null;
  try {
    const plan = safeJson(tool.execution_plan_json, null) as WExecutionPlan | null;
    if (!plan || !plan.connector_id || !plan.action_name || !["legacy", "skill"].includes(plan.type)) {
      throw new Error("This tool has no supported execution plan.");
    }
    const runtimeInput = plan.type === "skill"
      ? skillRuntimeInput(input.arguments || {}, plan.argument_root, plan.dispatch || {})
      : legacyRuntimeInput(input.arguments || {}, plan.argument_aliases || {}, plan.value_aliases || {});
    const rawResult = await callConnectorTool(env, {
      connector_id: plan.connector_id,
      action_name: plan.action_name,
      input: runtimeInput,
      dry_run: false,
      confirmed: confirmationUsed || !tool.requires_confirmation,
    }, context.baseUrl);
    const httpStatus = extractHttpStatus(rawResult);
    const safeResult = redactSensitiveValue(toPublicPluginValue(rawResult));
    const normalized = await normalizeExecutionResult(env, context, safeResult);
    if (pluginInvocationFailed(rawResult, httpStatus)) {
      const response = {
        ok: false,
        execution_id: executionId,
        tool_ref: tool.tool_ref,
        duration_ms: Date.now() - started,
        error: {
          code: httpStatus === 401 || httpStatus === 403 ? "plugin_authentication_failed" : "plugin_request_failed",
          message: httpStatus === 401 || httpStatus === 403
            ? "The service rejected the saved plugin credentials. Open the protected plugin settings page and save a valid key."
            : "The plugin request failed.",
          http_status: httpStatus,
          details: normalized,
        },
      };
      await auditExecution(env, context, tool, executionId, connectionId, argumentsHash, "failed", Date.now() - started, httpStatus, response.error.code, confirmationUsed, keyHash);
      return response;
    }
    const response = {
      ok: true,
      execution_id: executionId,
      tool_ref: tool.tool_ref,
      duration_ms: Date.now() - started,
      result: normalized,
    };
    await storeIdempotentResult(env, context, tool, input.idempotency_key, keyHash, argumentsHash, executionId, response);
    await auditExecution(env, context, tool, executionId, connectionId, argumentsHash, "completed", Date.now() - started, httpStatus, null, confirmationUsed, keyHash);
    return response;
  } catch (error) {
    const message = publicPluginText(redactSensitiveText(error instanceof Error ? error.message : "Execution failed."));
    await auditExecution(env, context, tool, executionId, connectionId, argumentsHash, "failed", Date.now() - started, null, "execution_failed", confirmationUsed, keyHash);
    return { ok: false, execution_id: executionId, tool_ref: tool.tool_ref, duration_ms: Date.now() - started, error: { code: "execution_failed", message } };
  }
}

export async function resolveExecutableTool(
  env: Env,
  context: WRequestContext,
  toolRef: string,
  permission: "describe" | "execute" | "present",
): Promise<WToolRecord> {
  const tool = (await loadPublishedToolsByRefs(env, context, [toolRef]))[0];
  if (!tool) throw new Error(`Unknown or unavailable tool_ref: ${toolRef}`);
  const policy = await loadPolicy(env, context, permission);
  if (!toolAllowed(policy, tool, permission)) throw new Error(`Permission denied for ${toolRef}.`);
  return tool;
}

async function validateSearchSession(env: Env, context: WRequestContext, searchId?: string): Promise<void> {
  if (!searchId) return;
  const row = await wDatabase(env).prepare(
    `SELECT id FROM w_search_sessions
     WHERE id = ? AND tenant_id = ? AND user_id = ? AND endpoint_id = ? AND expires_at >= ?`,
  ).bind(searchId, context.tenantId, context.userId, context.endpointId, new Date().toISOString()).first<{ id: string }>();
  if (!row) throw new Error("search_id is expired or belongs to another user. Run w_search again.");
}

async function resolveConnection(
  env: Env,
  context: WRequestContext,
  tool: WToolRecord,
  requested?: string,
): Promise<string | null> {
  if (!tool.connection_type) return null;
  const db = wDatabase(env);
  const where = requested ? "id = ? AND" : "";
  const values = requested ? [requested] : [];
  const row = await db.prepare(
    `SELECT id, granted_scopes_json FROM w_connections WHERE ${where} tenant_id = ? AND plugin_id = ?
       AND connection_type = ? AND status = 'active'
       AND (user_id IS NULL OR user_id = ?) AND (expires_at IS NULL OR expires_at >= ?)
     ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`,
  ).bind(...values, context.tenantId, tool.plugin_id, tool.connection_type, context.userId,
    new Date().toISOString(), context.userId).first<{ id: string; granted_scopes_json: string | null }>();
  if (!row) throw new Error(`Plugin ${tool.plugin_name} is not connected. Open its protected settings page first.`);
  const granted = new Set(stringArray(row.granted_scopes_json));
  const missing = stringArray(tool.required_scopes_json).filter((scope) => !granted.has(scope));
  if (missing.length) throw new Error(`Plugin ${tool.plugin_name} needs additional account permissions: ${missing.join(", ")}.`);
  return row.id;
}

async function existingIdempotentResult(
  env: Env,
  context: WRequestContext,
  tool: WToolRecord,
  key: string | undefined,
  argumentsHash: string,
): Promise<unknown | null> {
  if (!key) return null;
  const keyHash = await sha256Base64Url(key);
  const row = await wDatabase(env).prepare(
    `SELECT arguments_hash, result_json FROM w_idempotency_keys
     WHERE tenant_id = ? AND user_id = ? AND tool_ref = ? AND key_hash = ? AND expires_at >= ?`,
  ).bind(context.tenantId, context.userId, tool.tool_ref, keyHash, new Date().toISOString())
    .first<{ arguments_hash: string; result_json: string | null }>();
  if (!row) return null;
  if (row.arguments_hash !== argumentsHash) throw new Error("The idempotency key was already used with different arguments.");
  return row.result_json ? JSON.parse(row.result_json) : { ok: false, error: { code: "idempotency_result_unavailable" } };
}

async function storeIdempotentResult(
  env: Env,
  context: WRequestContext,
  tool: WToolRecord,
  key: string | undefined,
  keyHash: string | null,
  argumentsHash: string,
  executionId: string,
  result: unknown,
): Promise<void> {
  if (!key || !keyHash) return;
  const created = new Date();
  const expires = new Date(created.getTime() + 24 * 60 * 60 * 1000);
  const serialized = JSON.stringify(result);
  await wDatabase(env).prepare(
    `INSERT INTO w_idempotency_keys
       (tenant_id, user_id, tool_ref, key_hash, arguments_hash, execution_id, result_json, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(context.tenantId, context.userId, tool.tool_ref, keyHash, argumentsHash,
    executionId, serialized.slice(0, 100_000), created.toISOString(), expires.toISOString()).run();
}

async function auditExecution(
  env: Env,
  context: WRequestContext,
  tool: WToolRecord,
  executionId: string,
  connectionId: string | null,
  argumentsHash: string,
  status: string,
  duration: number,
  httpStatus: number | null,
  errorCode: string | null,
  confirmationUsed: boolean,
  idempotencyHash: string | null,
): Promise<void> {
  await wDatabase(env).prepare(
    `INSERT INTO w_execution_events
       (id, tool_ref, plugin_version_id, tenant_id, user_id, endpoint_id, connection_id,
        arguments_hash, status, duration_ms, http_status, error_code, confirmation_used,
        idempotency_key_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(executionId, tool.tool_ref, tool.plugin_version_id, context.tenantId, context.userId,
    context.endpointId, connectionId, argumentsHash, status, duration, httpStatus, errorCode,
    confirmationUsed ? 1 : 0, idempotencyHash, new Date().toISOString()).run();
}

function extractHttpStatus(value: unknown): number | null {
  const statuses: number[] = [];
  const visit = (item: unknown, depth: number) => {
    if (!item || typeof item !== "object" || depth > 6) return;
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 20)) visit(child, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(item as Record<string, unknown>).slice(0, 50)) {
      if ((key === "status" || key === "http_status") && Number.isInteger(child) && Number(child) >= 100 && Number(child) <= 599) {
        statuses.push(Number(child));
      }
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return statuses.find((status) => status >= 400) || statuses[0] || null;
}

function pluginInvocationFailed(value: unknown, httpStatus: number | null): boolean {
  if (httpStatus && httpStatus >= 400) return true;
  let failed = false;
  const visit = (item: unknown, depth: number) => {
    if (failed || !item || typeof item !== "object" || depth > 6) return;
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 20)) visit(child, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(item as Record<string, unknown>).slice(0, 50)) {
      if (key === "ok" && child === false) {
        failed = true;
        return;
      }
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return failed;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeJson(value: string, fallback: unknown): unknown {
  try { return JSON.parse(value); } catch { return fallback; }
}

function stringArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function skillRuntimeInput(
  argumentsValue: Record<string, unknown>,
  argumentRoot: string | undefined,
  dispatch: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = argumentRoot ? { [argumentRoot]: structuredClone(argumentsValue) } : structuredClone(argumentsValue);
  for (const [path, value] of Object.entries(dispatch)) setPath(output, path, value);
  return output;
}

function legacyRuntimeInput(
  argumentsValue: Record<string, unknown>,
  aliases: Record<string, string>,
  valueAliases: Record<string, Record<string, string>>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(argumentsValue)) {
    const legacyKey = aliases[key] || key;
    const mapped = valueAliases[key] && typeof value === "string" ? valueAliases[key][value] || value : value;
    output[legacyKey] = mapped;
  }
  return output;
}

function compatibilityArguments(
  argumentsValue: Record<string, unknown>,
  aliases: Record<string, string>,
  valueAliases: Record<string, Record<string, string>>,
): Record<string, unknown> {
  const reverseKeys = Object.fromEntries(Object.entries(aliases).map(([publicKey, legacyKey]) => [legacyKey, publicKey]));
  const output: Record<string, unknown> = {};
  for (const [legacyKey, value] of Object.entries(argumentsValue)) {
    const publicKey = reverseKeys[legacyKey] || legacyKey;
    const reverseValues = valueAliases[publicKey]
      ? Object.fromEntries(Object.entries(valueAliases[publicKey]).map(([publicValue, oldValue]) => [oldValue, publicValue]))
      : {};
    output[publicKey] = typeof value === "string" ? reverseValues[value] || value : value;
  }
  return output;
}

function toPublicPluginValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/connectors/giu, "plugins")
      .replace(/connector/giu, "plugin")
      .replace(/конектор(ів|и|а|ом|у|і|ами|ах)?/giu, "плагін")
      .replace(/child[_ ]worker/giu, "plugin worker");
  }
  if (Array.isArray(value)) return value.map(toPublicPluginValue);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const publicKey = key
      .replace(/connectors/giu, "plugins")
      .replace(/connector/giu, "plugin")
      .replace(/child_worker/giu, "plugin_worker");
    output[publicKey] = toPublicPluginValue(child);
  }
  return output;
}

function publicPluginText(value: string): string {
  return String(toPublicPluginValue(value));
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter((part) => /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(part));
  if (!parts.length || parts.join(".") !== path) throw new Error("The skill dispatch path is invalid.");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!child || typeof child !== "object" || Array.isArray(child)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1) as string] = value;
}
