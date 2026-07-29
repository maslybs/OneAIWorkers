import { z } from "zod";
import { estimateDefinitionsCost } from "./pricing";
import {
  expectedResults,
  proposalAgents,
  proposalName,
  taskCategory,
} from "./proposal-templates";
import { agentTeamProposeSchema } from "./schemas";

export function agentTeamPropose(args: z.infer<z.ZodObject<typeof agentTeamProposeSchema>>) {
  const category = taskCategory(args.task);
  let agents = proposalAgents(category, args.priority).slice(0, args.max_agents);
  if (agents.length < 2) {
    agents = proposalAgents("general", args.priority).slice(0, Math.max(2, args.max_agents));
  }

  let estimate = estimateDefinitionsCost(
    agents,
    0,
    args.max_rounds,
    args.expected_input_tokens_per_call,
    args.expected_output_tokens_per_call,
  );
  const warnings = [...estimate.warnings];

  if (
    args.max_budget_usd !== undefined
    && estimate.estimated_cost_usd !== null
    && estimate.estimated_cost_usd > args.max_budget_usd
  ) {
    agents = agents.map((agent, index) => ({
      ...agent,
      profile: index === 0 ? "balanced" as const : "fast" as const,
      model: undefined,
    }));
    estimate = estimateDefinitionsCost(
      agents,
      0,
      args.max_rounds,
      args.expected_input_tokens_per_call,
      args.expected_output_tokens_per_call,
    );
    warnings.push(
      "The initial proposal exceeded the requested budget, so premium profiles were downgraded to balanced/fast profiles.",
    );
  }

  if (
    args.max_budget_usd !== undefined
    && estimate.estimated_cost_usd !== null
    && estimate.estimated_cost_usd > args.max_budget_usd
  ) {
    warnings.push(
      "The downgraded proposal still exceeds the requested budget. Reduce rounds, agent count, or token assumptions before creation.",
    );
  }

  const name = proposalName(category);
  return {
    proposal_only: true,
    created: false,
    requires_explicit_confirmation: true,
    task_category: category,
    team: {
      name,
      description: `A proposed ${category} team for: ${args.task.slice(0, 300)}`,
      coordinator_index: 0,
      agents,
      max_rounds: args.max_rounds,
      expected_input_tokens_per_call: args.expected_input_tokens_per_call,
      expected_output_tokens_per_call: args.expected_output_tokens_per_call,
      max_budget_usd: args.max_budget_usd,
    },
    orchestration: {
      sequence: [
        "The coordinator creates a delegation plan.",
        "Specialists execute their assigned parts one at a time through durable queued steps.",
        ...(args.max_rounds > 1
          ? ["The coordinator reviews the round and sends feedback for revision."]
          : []),
        "The coordinator synthesizes the final result.",
      ],
      expected_results: expectedResults(category),
      stop_and_control: [
        "Use agent_run_cancel to request cancellation between model calls.",
        "Set an agent or team enabled=false to prevent future runs.",
        "Use agent_run_status to inspect current stage, outputs, usage estimate, and final result.",
      ],
    },
    estimate: { ...estimate, warnings },
    create_payload: {
      name,
      description: `A ${category} team proposed for the supplied task.`,
      agents,
      coordinator_index: 0,
      enabled: true,
      max_rounds: args.max_rounds,
      expected_input_tokens_per_call: args.expected_input_tokens_per_call,
      expected_output_tokens_per_call: args.expected_output_tokens_per_call,
      max_budget_usd: args.max_budget_usd,
      confirmed: false,
    },
  };
}
