import { z } from "zod";
import {
  agentCapabilities,
  agentCapabilitiesSchema,
  agentCreate,
  agentCreateSchema,
  agentDelete,
  agentDeleteSchema,
  agentGet,
  agentGetSchema,
  agentList,
  agentListSchema,
  agentRunCancel,
  agentRunCancelSchema,
  agentRunList,
  agentRunListSchema,
  agentRunStatus,
  agentRunStatusSchema,
  agentTeamCreate,
  agentTeamCreateSchema,
  agentTeamDelete,
  agentTeamDeleteSchema,
  agentTeamGet,
  agentTeamGetSchema,
  agentTeamList,
  agentTeamListSchema,
  agentTeamPropose,
  agentTeamProposeSchema,
  agentTeamStart,
  agentTeamStartSchema,
  agentTeamUpdate,
  agentTeamUpdateSchema,
  agentUpdate,
  agentUpdateSchema,
} from "../../agents";
import {
  aiCapabilities,
  aiCapabilitiesSchema,
  aiChat,
  aiChatSchema,
  aiEmbeddings,
  aiEmbeddingsSchema,
  aiExtractJson,
  aiExtractJsonSchema,
  aiModelsList,
  aiModelsListSchema,
  aiRecommendModel,
  aiRecommendModelSchema,
  aiRun,
  aiRunSchema,
} from "../ai";
import {
  aiNeuronHistory,
  aiNeuronHistorySchema,
  aiNeuronStatus,
  aiNeuronStatusSchema,
} from "../neuron-meter";
import type { NativeToolDefinition } from "./types";

function define(
  name: string,
  description: string,
  shape: Record<string, z.ZodType>,
  options: Pick<NativeToolDefinition, "read_only" | "consumes_ai" | "requires_confirmation" | "handler">,
): NativeToolDefinition {
  return { name, description, schema: z.object(shape), ...options };
}

export const NATIVE_TOOLS: NativeToolDefinition[] = [
  define("ai_capabilities", "Reports native Workers AI configuration, model profiles, limits, and safety notes.", aiCapabilitiesSchema, {
    read_only: true,
    consumes_ai: false,
    requires_confirmation: false,
    handler: (env) => aiCapabilities(env),
  }),
  define("ai_models_list", "Lists the curated Workers AI models and their dated pricing metadata.", aiModelsListSchema, {
    read_only: true,
    consumes_ai: false,
    requires_confirmation: false,
    handler: (_env, args) => aiModelsList(args),
  }),
  define("ai_recommend_model", "Selects a curated model deterministically without invoking AI.", aiRecommendModelSchema, {
    read_only: true,
    consumes_ai: false,
    requires_confirmation: false,
    handler: (_env, args) => aiRecommendModel(args),
  }),
  define("ai_neuron_status", "Shows today's locally tracked PSY neuron usage, remaining free allocation, reset time, and confidence limits.", aiNeuronStatusSchema, {
    read_only: true,
    consumes_ai: false,
    requires_confirmation: false,
    handler: (env) => aiNeuronStatus(env),
  }),
  define("ai_neuron_history", "Lists recent local neuron ledger entries without storing prompts or model outputs.", aiNeuronHistorySchema, {
    read_only: true,
    consumes_ai: false,
    requires_confirmation: false,
    handler: (env, args) => aiNeuronHistory(env, args),
  }),
  define("ai_chat", "Runs a non-streaming Workers AI chat request and consumes AI quota.", aiChatSchema, {
    read_only: false,
    consumes_ai: true,
    requires_confirmation: true,
    handler: (env, args) => aiChat(env, args),
  }),
  define("ai_embeddings", "Creates Workers AI embeddings and consumes AI quota.", aiEmbeddingsSchema, {
    read_only: false,
    consumes_ai: true,
    requires_confirmation: true,
    handler: (env, args) => aiEmbeddings(env, args),
  }),
  define("ai_extract_json", "Runs schema-guided JSON extraction and consumes AI quota.", aiExtractJsonSchema, {
    read_only: false,
    consumes_ai: true,
    requires_confirmation: true,
    handler: (env, args) => aiExtractJson(env, args),
  }),
  define("ai_run", "Runs an advanced non-streaming Workers AI request and consumes AI quota.", aiRunSchema, {
    read_only: false,
    consumes_ai: true,
    requires_confirmation: true,
    handler: (env, args) => aiRun(env, args),
  }),
  define("agent_capabilities", "Reports agent storage, orchestration, cost-control, and cancellation capabilities.", agentCapabilitiesSchema, {
    read_only: true,
    consumes_ai: false,
    requires_confirmation: false,
    handler: (env) => agentCapabilities(env),
  }),
  define("agent_team_propose", "Builds a reviewable agent-team proposal and USD estimate without creating agents or invoking AI.", agentTeamProposeSchema, {
    read_only: true,
    consumes_ai: false,
    requires_confirmation: false,
    handler: (_env, args) => agentTeamPropose(args),
  }),
  define("agent_create", "Creates one data-defined agent in AgentManager.", agentCreateSchema, {
    read_only: false,
    consumes_ai: false,
    requires_confirmation: true,
    handler: (env, args) => agentCreate(env, args),
  }),
  define("agent_list", "Lists stored agents, optionally including disabled agents.", agentListSchema, {
    read_only: true,
    consumes_ai: false,
    requires_confirmation: false,
    handler: (env, args) => agentList(env, args),
  }),
  define("agent_get", "Gets one stored agent by ID.", agentGetSchema, {
    read_only: true,
    consumes_ai: false,
    requires_confirmation: false,
    handler: (env, args) => agentGet(env, args),
  }),
  define("agent_update", "Updates or enables/disables one stored agent.", agentUpdateSchema, {
    read_only: false,
    consumes_ai: false,
    requires_confirmation: true,
    handler: (env, args) => agentUpdate(env, args),
  }),
  define("agent_delete", "Deletes one stored agent when it is no longer assigned to a team.", agentDeleteSchema, {
    read_only: false,
    consumes_ai: false,
    requires_confirmation: true,
    handler: (env, args) => agentDelete(env, args),
  }),
  define("agent_team_create", "Creates a confirmed agent team from a reviewed proposal.", agentTeamCreateSchema, {
    read_only: false,
    consumes_ai: false,
    requires_confirmation: true,
    handler: (env, args) => agentTeamCreate(env, args),
  }),
  define("agent_team_list", "Lists stored agent teams, optionally including disabled teams.", agentTeamListSchema, {
    read_only: true,
    consumes_ai: false,
    requires_confirmation: false,
    handler: (env, args) => agentTeamList(env, args),
  }),
  define("agent_team_get", "Gets one agent team, its members, and its current cost estimate.", agentTeamGetSchema, {
    read_only: true,
    consumes_ai: false,
    requires_confirmation: false,
    handler: (env, args) => agentTeamGet(env, args),
  }),
  define("agent_team_update", "Updates team membership, coordinator, rounds, budget, or enabled state.", agentTeamUpdateSchema, {
    read_only: false,
    consumes_ai: false,
    requires_confirmation: true,
    handler: (env, args) => agentTeamUpdate(env, args),
  }),
  define("agent_team_delete", "Deletes one agent team and can optionally delete unused member agents.", agentTeamDeleteSchema, {
    read_only: false,
    consumes_ai: false,
    requires_confirmation: true,
    handler: (env, args) => agentTeamDelete(env, args),
  }),
  define("agent_team_start", "Queues a confirmed agent-team run after enforcing its preflight budget.", agentTeamStartSchema, {
    read_only: false,
    consumes_ai: true,
    requires_confirmation: true,
    handler: (env, args) => agentTeamStart(env, args),
  }),
  define("agent_run_list", "Lists durable agent runs, optionally filtered by team.", agentRunListSchema, {
    read_only: true,
    consumes_ai: false,
    requires_confirmation: false,
    handler: (env, args) => agentRunList(env, args),
  }),
  define("agent_run_status", "Gets progress, outputs, usage estimate, error, or final result for one run.", agentRunStatusSchema, {
    read_only: true,
    consumes_ai: false,
    requires_confirmation: false,
    handler: (env, args) => agentRunStatus(env, args),
  }),
  define("agent_run_cancel", "Requests cooperative cancellation before the next model call.", agentRunCancelSchema, {
    read_only: false,
    consumes_ai: false,
    requires_confirmation: true,
    handler: (env, args) => agentRunCancel(env, args),
  }),
];

const NATIVE_TOOL_BY_NAME = new Map(NATIVE_TOOLS.map((tool) => [tool.name, tool]));

export function findNativeTool(actionName: string): NativeToolDefinition | null {
  const normalized = actionName.startsWith("native_") ? actionName.slice("native_".length) : actionName;
  return NATIVE_TOOL_BY_NAME.get(normalized) || null;
}
