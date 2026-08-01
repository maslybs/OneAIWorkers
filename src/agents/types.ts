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
  estimated_neurons: number;
  reported_token_calls: number;
  estimated_token_calls: number;
}

export interface RunStateData {
  round: number;
  member_index: number;
  max_steps: number;
  steps_completed: number;
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
  maximum_output_tokens: number;
  estimated_cost_usd: number | null;
  estimated_neurons: number | null;
  maximum_neurons: number | null;
}

export interface AgentNeuronPreflightBreakdown {
  agent_id?: string;
  agent_name: string;
  model: string;
  calls: number;
  expected_input_tokens_per_call: number;
  expected_output_tokens_per_call: number;
  maximum_output_tokens_per_call: number;
  history_samples: number;
  expected_neurons: number | null;
  maximum_neurons: number | null;
}

export interface AgentNeuronPreflight {
  billing_type: "workers_ai_neurons";
  expected_neurons: number | null;
  maximum_neurons: number | null;
  current_local_used_neurons: number | null;
  current_local_remaining_neurons: number | null;
  daily_allocation: number;
  expected_fits_within_local_remaining: boolean | null;
  maximum_fits_within_local_remaining: boolean | null;
  resets_at: string;
  source: "local_history_and_team_config" | "team_config";
  confidence: "partial" | "low";
  breakdown: AgentNeuronPreflightBreakdown[];
  warning: string;
}

export interface TeamCostEstimate {
  currency: "USD";
  billing_type: "workers_ai_neurons";
  estimated_cost_usd: number | null;
  estimated_neurons: number | null;
  maximum_neurons: number | null;
  estimated_calls: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  breakdown: TeamCostBreakdown[];
  neuron_preflight?: AgentNeuronPreflight;
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
  estimated_neurons: number;
  token_source: "local_reported_tokens" | "local_estimated_tokens";
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
