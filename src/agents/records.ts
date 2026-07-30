import type {
  AgentRecord,
  AgentRow,
  RunRecord,
  RunRow,
  RunStateData,
  TeamCostEstimate,
  TeamRecord,
  TeamRow,
} from "./types";

export function agentFromRow(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    instructions: row.instructions,
    profile: row.profile,
    model: row.model || undefined,
    enabled: Boolean(row.enabled),
    max_output_tokens: row.max_output_tokens,
    temperature: row.temperature,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function teamFromRow(row: TeamRow): TeamRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    coordinator_agent_id: row.coordinator_agent_id,
    member_agent_ids: parseStringArray(row.member_agent_ids_json),
    enabled: Boolean(row.enabled),
    max_rounds: row.max_rounds,
    expected_input_tokens_per_call: row.expected_input_tokens_per_call,
    expected_output_tokens_per_call: row.expected_output_tokens_per_call,
    max_budget_usd: row.max_budget_usd,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function runFromRow(row: RunRow): RunRecord {
  const state = JSON.parse(row.state_json) as RunStateData;
  state.usage = {
    input_tokens: state.usage?.input_tokens ?? 0,
    output_tokens: state.usage?.output_tokens ?? 0,
    estimated_cost_usd: state.usage?.estimated_cost_usd ?? 0,
    estimated_neurons: state.usage?.estimated_neurons ?? 0,
    reported_token_calls: state.usage?.reported_token_calls ?? 0,
    estimated_token_calls: state.usage?.estimated_token_calls ?? 0,
  };
  const estimate = JSON.parse(row.estimate_json) as TeamCostEstimate;
  estimate.billing_type ||= "workers_ai_neurons";
  estimate.estimated_neurons ??= null;
  estimate.maximum_neurons ??= null;
  estimate.breakdown = (estimate.breakdown || []).map((item) => ({
    ...item,
    maximum_output_tokens: item.maximum_output_tokens ?? item.output_tokens,
    estimated_neurons: item.estimated_neurons ?? null,
    maximum_neurons: item.maximum_neurons ?? null,
  }));
  return {
    id: row.id,
    team_id: row.team_id,
    task: row.task,
    status: row.status,
    stage: row.stage,
    state,
    estimate,
    final_result: row.final_result,
    error: row.error,
    cancellation_requested: Boolean(row.cancellation_requested),
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
  };
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Invalid stored member_agent_ids_json.");
  }
  return parsed;
}
