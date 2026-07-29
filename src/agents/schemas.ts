import { z } from "zod";
import {
  DEFAULT_INPUT_TOKENS_PER_CALL,
  DEFAULT_OUTPUT_TOKENS_PER_CALL,
  MAX_AGENTS,
  MAX_INSTRUCTIONS_CHARS,
  MAX_ROUNDS,
  MAX_RUNS_RETURNED,
  MAX_TASK_CHARS,
} from "./constants";

export const agentProfileSchema = z.enum(["fast", "balanced", "reasoning", "vision", "coding", "agentic"]);
export const prioritySchema = z.enum(["lowest-cost", "lowest-latency", "balanced", "highest-quality"]);

export const agentDefinitionSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(200),
  instructions: z.string().min(1).max(MAX_INSTRUCTIONS_CHARS),
  profile: agentProfileSchema.default("balanced"),
  model: z.string().regex(/^@cf\/[a-z0-9][a-z0-9._/-]*$/i).max(200).optional(),
  enabled: z.boolean().default(true),
  max_output_tokens: z.number().int().min(128).max(4_096).default(1_024),
  temperature: z.number().min(0).max(1.5).default(0.2),
});

export const agentCapabilitiesSchema = {};

export const agentTeamProposeSchema = {
  task: z.string().min(1).max(MAX_TASK_CHARS),
  max_agents: z.number().int().min(2).max(MAX_AGENTS).default(4),
  priority: prioritySchema.default("balanced"),
  max_rounds: z.number().int().min(1).max(MAX_ROUNDS).default(1),
  max_budget_usd: z.number().min(0.0001).max(100).optional(),
  expected_input_tokens_per_call: z.number().int().min(100).max(100_000).default(DEFAULT_INPUT_TOKENS_PER_CALL),
  expected_output_tokens_per_call: z.number().int().min(50).max(16_000).default(DEFAULT_OUTPUT_TOKENS_PER_CALL),
};

export const agentCreateSchema = {
  ...agentDefinitionSchema.shape,
  confirmed: z.boolean().default(false),
};

export const agentListSchema = {
  include_disabled: z.boolean().default(true),
};

export const agentGetSchema = {
  agent_id: z.string().uuid(),
};

export const agentUpdateSchema = {
  agent_id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  role: z.string().min(1).max(200).optional(),
  instructions: z.string().min(1).max(MAX_INSTRUCTIONS_CHARS).optional(),
  profile: agentProfileSchema.optional(),
  model: z.string().regex(/^@cf\/[a-z0-9][a-z0-9._/-]*$/i).max(200).nullable().optional(),
  enabled: z.boolean().optional(),
  max_output_tokens: z.number().int().min(128).max(4_096).optional(),
  temperature: z.number().min(0).max(1.5).optional(),
  confirmed: z.boolean().default(false),
};

export const agentDeleteSchema = {
  agent_id: z.string().uuid(),
  confirmed: z.boolean().default(false),
};

export const agentTeamCreateSchema = {
  name: z.string().min(1).max(120),
  description: z.string().max(2_000).default(""),
  agents: z.array(agentDefinitionSchema).min(2).max(MAX_AGENTS),
  coordinator_index: z.number().int().min(0).max(MAX_AGENTS - 1).default(0),
  enabled: z.boolean().default(true),
  max_rounds: z.number().int().min(1).max(MAX_ROUNDS).default(1),
  expected_input_tokens_per_call: z.number().int().min(100).max(100_000).default(DEFAULT_INPUT_TOKENS_PER_CALL),
  expected_output_tokens_per_call: z.number().int().min(50).max(16_000).default(DEFAULT_OUTPUT_TOKENS_PER_CALL),
  max_budget_usd: z.number().min(0.0001).max(100).optional(),
  confirmed: z.boolean().default(false),
};

export const agentTeamListSchema = {
  include_disabled: z.boolean().default(true),
};

export const agentTeamGetSchema = {
  team_id: z.string().uuid(),
};

export const agentTeamUpdateSchema = {
  team_id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2_000).optional(),
  coordinator_agent_id: z.string().uuid().optional(),
  member_agent_ids: z.array(z.string().uuid()).min(2).max(MAX_AGENTS).optional(),
  enabled: z.boolean().optional(),
  max_rounds: z.number().int().min(1).max(MAX_ROUNDS).optional(),
  expected_input_tokens_per_call: z.number().int().min(100).max(100_000).optional(),
  expected_output_tokens_per_call: z.number().int().min(50).max(16_000).optional(),
  max_budget_usd: z.number().min(0.0001).max(100).nullable().optional(),
  confirmed: z.boolean().default(false),
};

export const agentTeamDeleteSchema = {
  team_id: z.string().uuid(),
  delete_agents: z.boolean().default(false),
  confirmed: z.boolean().default(false),
};

export const agentTeamStartSchema = {
  team_id: z.string().uuid(),
  task: z.string().min(1).max(MAX_TASK_CHARS),
  max_budget_usd: z.number().min(0.0001).max(100).optional(),
  confirmed: z.boolean().default(false),
};

export const agentRunStatusSchema = {
  run_id: z.string().uuid(),
};

export const agentRunListSchema = {
  team_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(MAX_RUNS_RETURNED).default(20),
};

export const agentRunCancelSchema = {
  run_id: z.string().uuid(),
  confirmed: z.boolean().default(false),
};
