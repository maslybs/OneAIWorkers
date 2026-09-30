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
  ReviewPolicy,
  TeamCostBreakdown,
  TeamCostEstimate,
  TeamRecord,
  TeamStrategy,
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
  options: { strategy?: TeamStrategy; review_policy?: ReviewPolicy } = {},
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
    strategy: options.strategy || "legacy",
    max_parallel: 2,
    review_policy: options.review_policy || "on_uncertainty",
    primary_context_tokens: 2_500,
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
  let mixedBilling = false;

  for (const agent of agents) {
    const calls = modelCallsForAgent(team, agent, coordinator.id);
    const inputTokens = calls * team.expected_input_tokens_per_call;
    const expectedOutputPerCall = Math.min(team.expected_output_tokens_per_call, agent.max_output_tokens);
    const outputTokens = calls * expectedOutputPerCall;
    const maximumOutputTokens = calls * agent.max_output_tokens;
    const model = agent.model || MODEL_PROFILES[agent.profile];
    const workersAiModel = model.startsWith("@cf/");
    mixedBilling ||= !workersAiModel;
    const pricing = workersAiModel ? pricingForModel(model) : null;
    const expected = workersAiModel
      ? calculateWorkersAiBilling({
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          cached_tokens: 0,
        }, pricing)
      : { estimated_cost_usd: null, estimated_neurons: null };
    const maximum = workersAiModel
      ? calculateWorkersAiBilling({
          prompt_tokens: inputTokens,
          completion_tokens: maximumOutputTokens,
          cached_tokens: 0,
        }, pricing)
      : { estimated_cost_usd: null, estimated_neurons: null };

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
    if (calls > 0) {
      if (expected.estimated_cost_usd === null) costKnown = false;
      else totalCost += expected.estimated_cost_usd;
      if (expected.estimated_neurons === null) neuronsKnown = false;
      else totalNeurons += expected.estimated_neurons;
      if (maximum.estimated_neurons === null) maximumKnown = false;
      else maximumNeurons += maximum.estimated_neurons;
    }
  }

  return {
    currency: "USD",
    billing_type: mixedBilling ? "mixed" : "workers_ai_neurons",
    estimated_cost_usd: costKnown ? roundUsd(totalCost) : null,
    estimated_neurons: neuronsKnown ? roundMetric(totalNeurons) : null,
    maximum_neurons: maximumKnown ? roundMetric(maximumNeurons) : null,
    estimated_calls: totalCalls,
    estimated_input_tokens: totalInput,
    estimated_output_tokens: totalOutput,
    breakdown,
    warnings: [
      "This is a preflight estimate, not a billing guarantee.",
      ...(team.strategy === "adaptive"
        ? ["Adaptive estimates assume one specialist call, two model calls for a read-only scout, and a reviewer only when review policy can invoke one."]
        : ["Legacy estimates assume fixed coordinator/member rounds."]),
      ...(mixedBilling
        ? ["At least one agent uses an AI Gateway third-party model. Its live Unified Billing cost is not estimated locally; enforce provider/gateway spend limits as well."]
        : ["Workers AI neurons are calculated from the dated model pricing snapshot; account-wide usage is not available to this Worker."]),
      ...(costKnown ? [] : ["At least one selected model lacks local unit pricing, so the total USD estimate is incomplete."]),
      ...(neuronsKnown ? [] : ["At least one selected model is not billed as Workers AI neurons, so the neuron estimate is incomplete."]),
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
    const calls = modelCallsForAgent(team, agent, coordinator.id);
    const workersAiModel = model.startsWith("@cf/");
    const agentHistory = workersAiModel ? await historicalTokenAverage(env, model, agent.id) : null;
    const history = agentHistory || (workersAiModel ? await historicalTokenAverage(env, model) : null);
    if (history) usesHistory = true;
    const expectedInputPerCall = Math.max(1, history?.prompt_tokens || team.expected_input_tokens_per_call);
    const expectedOutputPerCall = Math.min(
      agent.max_output_tokens,
      Math.max(0, history?.completion_tokens ?? team.expected_output_tokens_per_call),
    );
    const pricing = workersAiModel ? pricingForModel(model) : null;
    const expected = calculateWorkersAiBilling({
      prompt_tokens: calls * expectedInputPerCall,
      completion_tokens: calls * expectedOutputPerCall,
      cached_tokens: 0,
    }, pricing);
    const maximum = calculateWorkersAiBilling({
      prompt_tokens: calls * Math.max(team.expected_input_tokens_per_call, expectedInputPerCall),
      completion_tokens: calls * agent.max_output_tokens,
      cached_tokens: 0,
    }, pricing);

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
    if (calls > 0) {
      if (expected.estimated_neurons === null) expectedKnown = false;
      else expectedTotal += expected.estimated_neurons;
      if (maximum.estimated_neurons === null) maximumKnown = false;
      else maximumTotal += maximum.estimated_neurons;
    }
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
    // Static estimates still work when local D1 aggregation is unavailable.
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
    expected_fits_within_local_remaining: remaining === null || expectedNeurons === null ? null : expectedNeurons <= remaining,
    maximum_fits_within_local_remaining: remaining === null || maximumNeurons === null ? null : maximumNeurons <= remaining,
    resets_at: resetsAt,
    source: usesHistory ? "local_history_and_team_config" : "team_config",
    confidence: usesHistory ? "partial" : "low",
    breakdown,
    warning: "This preflight covers only locally metered Workers AI calls. AI Gateway third-party calls and other account consumers are outside this neuron ledger.",
  };
}

export function estimateSingleCallCost(model: string, inputTokens: number, outputTokens: number): number | null {
  if (!model.startsWith("@cf/")) return null;
  return calculateWorkersAiBilling({
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    cached_tokens: 0,
  }, pricingForModel(model)).estimated_cost_usd;
}

export function estimateSingleCallNeurons(model: string, inputTokens: number, outputTokens: number): number | null {
  if (!model.startsWith("@cf/")) return null;
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
    estimated_cost_usd: number | null;
    estimated_neurons: number | null;
    token_source: "local_reported_tokens" | "local_estimated_tokens";
  },
): void {
  usage.input_tokens += call.input_tokens;
  usage.output_tokens += call.output_tokens;
  if (call.estimated_cost_usd === null) usage.unpriced_calls += 1;
  else usage.estimated_cost_usd = roundUsd(usage.estimated_cost_usd + call.estimated_cost_usd);
  if (call.estimated_neurons !== null) usage.estimated_neurons = roundMetric(usage.estimated_neurons + call.estimated_neurons);
  if (call.token_source === "local_reported_tokens") usage.reported_token_calls += 1;
  else usage.estimated_token_calls += 1;
}

function modelCallsForAgent(team: TeamRecord, agent: AgentRecord, coordinatorId: string): number {
  if (team.strategy === "legacy") return agent.id === coordinatorId ? team.max_rounds + 1 : team.max_rounds;
  if (agent.kind === "synthesizer") return 0;
  if (agent.kind === "reviewer") return team.review_policy === "never" ? 0 : 1;
  if (agent.kind === "scout" && agent.tool_policy === "read_only" && agent.max_tool_calls > 0) return 2;
  return 1;
}

function pricingForModel(model: string): AiUnitPricing | null {
  const catalog = aiModelsList({ task: "all", capability: "all" });
  const metadata = catalog.models.find((item) => item.id === model);
  return metadata?.pricing_usd_per_million_units || null;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
