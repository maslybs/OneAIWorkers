import type { Env } from "../types";
import { aiModelsList, MODEL_PROFILES } from "../tools/ai";
import {
  aiNeuronStatus,
  calculateWorkersAiBilling,
  DAILY_NEURON_ALLOCATION,
  historicalTokenAverage,
  nextUtcReset,
  type AiUnitPricing,
} from "../tools/neuron-meter";
import type {
  AgentDefinition,
  AgentNeuronPreflight,
  AgentRecord,
  TeamCostBreakdown,
  TeamCostEstimate,
  TeamRecord,
  UsageEstimate,
} from "./types";
import { roundUsd } from "./utils";

const PRICING_SNAPSHOT_VERIFIED_AT = "2026-07-29";

export function estimateDefinitionsCost(
  agents: AgentDefinition[],
  coordinatorIndex: number,
  maxRounds: number,
  inputTokensPerCall: number,
  outputTokensPerCall: number,
): TeamCostEstimate {
  const now = new Date().toISOString();
  const syntheticTeam: TeamRecord = {
    id: "proposal",
    name: "proposal",
    description: "",
    coordinator_agent_id: String(coordinatorIndex),
    member_agent_ids: agents.map((_, index) => String(index)),
    enabled: true,
    max_rounds: maxRounds,
    expected_input_tokens_per_call: inputTokensPerCall,
    expected_output_tokens_per_call: outputTokensPerCall,
    max_budget_usd: null,
    created_at: now,
    updated_at: now,
  };
  const records = agents.map((agent, index): AgentRecord => ({
    id: String(index),
    ...agent,
    created_at: now,
    updated_at: now,
  }));
  return estimateTeamCost(syntheticTeam, records);
}

export function estimateTeamCost(team: TeamRecord, agents: AgentRecord[]): TeamCostEstimate {
  const coordinator = agents.find((agent) => agent.id === team.coordinator_agent_id);
  if (!coordinator) throw new Error("Coordinator agent is missing from the team.");

  const breakdown: TeamCostBreakdown[] = [];
  let totalCost = 0;
  let totalNeurons = 0;
  let maximumNeurons = 0;
  let costKnown = true;
  let neuronsKnown = true;
  let maximumKnown = true;
  let totalCalls = 0;
  let totalInput = 0;
  let totalOutput = 0;

  for (const agent of agents) {
    const calls = agent.id === coordinator.id ? team.max_rounds + 1 : team.max_rounds;
    const inputTokens = calls * team.expected_input_tokens_per_call;
    const expectedOutputPerCall = Math.min(team.expected_output_tokens_per_call, agent.max_output_tokens);
    const outputTokens = calls * expectedOutputPerCall;
    const maximumOutputTokens = calls * agent.max_output_tokens;
    const model = agent.model || MODEL_PROFILES[agent.profile];
    const pricing = pricingForModel(model);
    const expected = calculateWorkersAiBilling({
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      cached_tokens: 0,
    }, pricing);
    const maximum = calculateWorkersAiBilling({
      prompt_tokens: inputTokens,
      completion_tokens: maximumOutputTokens,
      cached_tokens: 0,
    }, pricing);

    breakdown.push({
      agent_id: agent.id,
      agent_name: agent.name,
      profile: agent.profile,
      model,
      calls,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      maximum_output_tokens: maximumOutputTokens,
      estimated_cost_usd: expected.estimated_cost_usd,
      estimated_neurons: expected.estimated_neurons,
      maximum_neurons: maximum.estimated_neurons,
    });
    totalCalls += calls;
    totalInput += inputTokens;
    totalOutput += outputTokens;
    if (expected.estimated_cost_usd === null) costKnown = false;
    else totalCost += expected.estimated_cost_usd;
    if (expected.estimated_neurons === null) neuronsKnown = false;
    else totalNeurons += expected.estimated_neurons;
    if (maximum.estimated_neurons === null) maximumKnown = false;
    else maximumNeurons += maximum.estimated_neurons;
  }

  return {
    currency: "USD",
    billing_type: "workers_ai_neurons",
    estimated_cost_usd: costKnown ? roundUsd(totalCost) : null,
    estimated_neurons: neuronsKnown ? roundMetric(totalNeurons) : null,
    maximum_neurons: maximumKnown ? roundMetric(maximumNeurons) : null,
    estimated_calls: totalCalls,
    estimated_input_tokens: totalInput,
    estimated_output_tokens: totalOutput,
    breakdown,
    warnings: [
      "This is a preflight estimate, not a billing guarantee.",
      "Workers AI neurons are calculated from the dated model pricing snapshot; account-wide usage is not available to this Worker.",
      "The maximum-neuron estimate uses each agent's max_output_tokens, while input tokens remain an explicit planning assumption.",
      ...(costKnown ? [] : ["At least one selected model lacks curated unit pricing; the total cost cannot be calculated reliably."]),
      ...(neuronsKnown ? [] : ["At least one selected model lacks curated neuron rates; the total neuron estimate is incomplete."]),
    ],
    pricing_snapshot_verified_at: PRICING_SNAPSHOT_VERIFIED_AT,
  };
}

export async function buildAgentNeuronPreflight(
  env: Env,
  team: TeamRecord,
  agents: AgentRecord[],
): Promise<AgentNeuronPreflight> {
  const coordinator = agents.find((agent) => agent.id === team.coordinator_agent_id);
  if (!coordinator) throw new Error("Coordinator agent is missing from the team.");

  const breakdown: AgentNeuronPreflight["breakdown"] = [];
  let expectedTotal = 0;
  let maximumTotal = 0;
  let expectedKnown = true;
  let maximumKnown = true;
  let usesHistory = false;

  for (const agent of agents) {
    const model = agent.model || MODEL_PROFILES[agent.profile];
    const calls = agent.id === coordinator.id ? team.max_rounds + 1 : team.max_rounds;
    const agentHistory = await historicalTokenAverage(env, model, agent.id);
    const history = agentHistory || await historicalTokenAverage(env, model);
    if (history) usesHistory = true;
    const expectedInputPerCall = Math.max(1, history?.prompt_tokens || team.expected_input_tokens_per_call);
    const expectedOutputPerCall = Math.min(
      agent.max_output_tokens,
      Math.max(0, history?.completion_tokens ?? team.expected_output_tokens_per_call),
    );
    const expected = calculateWorkersAiBilling({
      prompt_tokens: calls * expectedInputPerCall,
      completion_tokens: calls * expectedOutputPerCall,
      cached_tokens: 0,
    }, pricingForModel(model));
    const maximum = calculateWorkersAiBilling({
      prompt_tokens: calls * Math.max(team.expected_input_tokens_per_call, expectedInputPerCall),
      completion_tokens: calls * agent.max_output_tokens,
      cached_tokens: 0,
    }, pricingForModel(model));

    breakdown.push({
      agent_id: agent.id,
      agent_name: agent.name,
      model,
      calls,
      expected_input_tokens_per_call: expectedInputPerCall,
      expected_output_tokens_per_call: expectedOutputPerCall,
      maximum_output_tokens_per_call: agent.max_output_tokens,
      history_samples: history?.samples || 0,
      expected_neurons: expected.estimated_neurons,
      maximum_neurons: maximum.estimated_neurons,
    });
    if (expected.estimated_neurons === null) expectedKnown = false;
    else expectedTotal += expected.estimated_neurons;
    if (maximum.estimated_neurons === null) maximumKnown = false;
    else maximumTotal += maximum.estimated_neurons;
  }

  let used: number | null = null;
  let remaining: number | null = null;
  let resetsAt = nextUtcReset();
  try {
    const status = await aiNeuronStatus(env);
    used = typeof status.used_neurons === "number" ? status.used_neurons : null;
    remaining = typeof status.remaining_neurons === "number" ? status.remaining_neurons : null;
    resetsAt = status.period.resets_at;
  } catch {
    // The run can still use static preflight estimates when local D1 aggregation is unavailable.
  }

  const expectedNeurons = expectedKnown ? roundMetric(expectedTotal) : null;
  const maximumNeurons = maximumKnown ? roundMetric(maximumTotal) : null;
  return {
    billing_type: "workers_ai_neurons",
    expected_neurons: expectedNeurons,
    maximum_neurons: maximumNeurons,
    current_local_used_neurons: used,
    current_local_remaining_neurons: remaining,
    daily_allocation: DAILY_NEURON_ALLOCATION,
    expected_fits_within_local_remaining: remaining === null || expectedNeurons === null
      ? null
      : expectedNeurons <= remaining,
    maximum_fits_within_local_remaining: remaining === null || maximumNeurons === null
      ? null
      : maximumNeurons <= remaining,
    resets_at: resetsAt,
    source: usesHistory ? "local_history_and_team_config" : "team_config",
    confidence: usesHistory ? "partial" : "low",
    breakdown,
    warning: "This preflight compares the run only with the locally tracked PSY remainder. Other Workers AI consumers in the Cloudflare account are not included.",
  };
}

export function estimateSingleCallCost(model: string, inputTokens: number, outputTokens: number): number | null {
  return calculateWorkersAiBilling({
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    cached_tokens: 0,
  }, pricingForModel(model)).estimated_cost_usd;
}

export function estimateSingleCallNeurons(model: string, inputTokens: number, outputTokens: number): number | null {
  return calculateWorkersAiBilling({
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    cached_tokens: 0,
  }, pricingForModel(model)).estimated_neurons;
}

export function addUsage(
  usage: UsageEstimate,
  call: {
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
    estimated_neurons: number;
    token_source: "local_reported_tokens" | "local_estimated_tokens";
  },
): void {
  usage.input_tokens += call.input_tokens;
  usage.output_tokens += call.output_tokens;
  usage.estimated_cost_usd = roundUsd(usage.estimated_cost_usd + call.estimated_cost_usd);
  usage.estimated_neurons = roundMetric(usage.estimated_neurons + call.estimated_neurons);
  if (call.token_source === "local_reported_tokens") usage.reported_token_calls += 1;
  else usage.estimated_token_calls += 1;
}

function pricingForModel(model: string): AiUnitPricing | null {
  const catalog = aiModelsList({ task: "all", capability: "all" });
  const metadata = catalog.models.find((item) => item.id === model);
  return metadata?.pricing_usd_per_million_units || null;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
