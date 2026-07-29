import { aiModelsList, MODEL_PROFILES } from "../tools/ai";
import type {
  AgentDefinition,
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
  let costKnown = true;
  let totalCalls = 0;
  let totalInput = 0;
  let totalOutput = 0;

  for (const agent of agents) {
    const calls = agent.id === coordinator.id ? team.max_rounds + 1 : team.max_rounds;
    const inputTokens = calls * team.expected_input_tokens_per_call;
    const outputTokens = calls * team.expected_output_tokens_per_call;
    const model = agent.model || MODEL_PROFILES[agent.profile];
    const cost = estimateSingleCallCost(model, inputTokens, outputTokens);

    breakdown.push({
      agent_id: agent.id,
      agent_name: agent.name,
      profile: agent.profile,
      model,
      calls,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: cost,
    });
    totalCalls += calls;
    totalInput += inputTokens;
    totalOutput += outputTokens;
    if (cost === null) costKnown = false;
    else totalCost += cost;
  }

  return {
    currency: "USD",
    estimated_cost_usd: costKnown ? roundUsd(totalCost) : null,
    estimated_calls: totalCalls,
    estimated_input_tokens: totalInput,
    estimated_output_tokens: totalOutput,
    breakdown,
    warnings: [
      "This is a preflight estimate, not a billing guarantee.",
      "Actual cost depends on actual input/output tokens, model pricing changes, retries, and Cloudflare free neuron allocation.",
      ...(costKnown ? [] : ["At least one selected model lacks curated unit pricing; the total cost cannot be calculated reliably."]),
    ],
    pricing_snapshot_verified_at: PRICING_SNAPSHOT_VERIFIED_AT,
  };
}

export function estimateSingleCallCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const catalog = aiModelsList({ task: "all", capability: "all" });
  const metadata = catalog.models.find((item) => item.id === model);
  const pricing = metadata?.pricing_usd_per_million_units;
  if (!pricing) return null;
  return roundUsd(
    (inputTokens / 1_000_000) * pricing.input
    + (outputTokens / 1_000_000) * (pricing.output ?? 0),
  );
}

export function addUsage(
  usage: UsageEstimate,
  call: { input_tokens: number; output_tokens: number; estimated_cost_usd: number },
): void {
  usage.input_tokens += call.input_tokens;
  usage.output_tokens += call.output_tokens;
  usage.estimated_cost_usd = roundUsd(usage.estimated_cost_usd + call.estimated_cost_usd);
}
