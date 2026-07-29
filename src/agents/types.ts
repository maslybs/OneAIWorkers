import { z } from "zod";
import { agentDefinitionSchema, agentProfileSchema, prioritySchema } from "./schemas";

export type AgentProfile = z.infer<typeof agentProfileSchema>;
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;
export type Priority = z.infer<typeof prioritySchema>;

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type RunStage = "planning" | "members" | "feedback" | "synthesis";

export interface AgentRecord extends AgentDefinition {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface TeamRecord {
  id: string;
  name: string;
  description: string;
  coordinator_agent_id: string;
  member_agent_ids: string[];
  enabled: boolean;
  max_rounds: number;
  expected_input_tokens_per_call: number;
  expected_output_tokens_per_call: number;
  max_budget_usd: number | null;
  created_at: string;
  updated_at: string;
}

export interface RunOutput {
  agent_id: string;
  agent_name: string;
  round: number;
  model: string;
  output: string;
}

export interface UsageEstimate {
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export interface RunStateData {
  round: number;
  member_index: number;
  coordinator_plan?: string;
  feedback?: string;
  outputs: RunOutput[];
  usage: UsageEstimate;
}

export interface RunRecord {
  id: string;
  team_id: string;
  task: string;
  status: RunStatus;
  stage: RunStage;
  state: RunStateData;
  estimate: TeamCostEstimate;
  final_result: string | null;
  error: string | null;
  cancellation_requested: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TeamCostBreakdown {
  agent_id?: string;
  agent_name: string;
  profile: AgentProfile;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number | null;
}

export interface TeamCostEstimate {
  currency: "USD";
  estimated_cost_usd: number | null;
  estimated_calls: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  breakdown: TeamCostBreakdown[];
  warnings: string[];
  pricing_snapshot_verified_at: string;
}

export interface AgentRow {
  id: string;
  name: string;
  role: string;
  instructions: string;
  profile: AgentProfile;
  model: string | null;
  enabled: number;
  max_output_tokens: number;
  temperature: number;
  created_at: string;
  updated_at: string;
}

export interface TeamRow {
  id: string;
  name: string;
  description: string;
  coordinator_agent_id: string;
  member_agent_ids_json: string;
  enabled: number;
  max_rounds: number;
  expected_input_tokens_per_call: number;
  expected_output_tokens_per_call: number;
  max_budget_usd: number | null;
  created_at: string;
  updated_at: string;
}

export interface RunRow {
  id: string;
  team_id: string;
  task: string;
  status: RunStatus;
  stage: RunStage;
  state_json: string;
  estimate_json: string;
  final_result: string | null;
  error: string | null;
  cancellation_requested: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AgentCallResult {
  text: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export interface TeamCreateInput {
  name: string;
  description: string;
  agents: AgentDefinition[];
  coordinator_index: number;
  enabled: boolean;
  max_rounds: number;
  expected_input_tokens_per_call: number;
  expected_output_tokens_per_call: number;
  max_budget_usd?: number;
}
