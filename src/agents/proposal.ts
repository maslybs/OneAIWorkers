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
  const adaptiveOptions = {
    strategy: "adaptive" as const,
    review_policy: "on_uncertainty" as const,
  };

  let estimate = estimateDefinitionsCost(
    agents,
    0,
    args.max_rounds,
    args.expected_input_tokens_per_call,
    args.expected_output_tokens_per_call,
    adaptiveOptions,
  );
  const warnings = [...estimate.warnings];

  if (
    args.max_budget_usd !== undefined
    && estimate.estimated_cost_usd !== null
    && estimate.estimated_cost_usd > args.max_budget_usd
  ) {
    agents = agents.map((agent) => ({
      ...agent,
      profile: agent.kind === "synthesizer" ? "balanced" as const : "fast" as const,
      model: undefined,
    }));
    estimate = estimateDefinitionsCost(
      agents,
      0,
      args.max_rounds,
      args.expected_input_tokens_per_call,
      args.expected_output_tokens_per_call,
      adaptiveOptions,
    );
    warnings.push("The initial proposal exceeded the requested budget, so adaptive roles were downgraded to balanced/fast profiles.");
  }

  if (
    args.max_budget_usd !== undefined
    && estimate.estimated_cost_usd !== null
    && estimate.estimated_cost_usd > args.max_budget_usd
  ) {
    warnings.push("The downgraded proposal still exceeds the requested budget. Reduce agent count or token assumptions before creation.");
  }

  const name = proposalName(category);
  const workers = agents.filter((agent) => agent.kind === "scout" || agent.kind === "specialist");
  const maxParallel = Math.max(1, Math.min(3, workers.length));
  return {
    proposal_only: true,
    created: false,
    requires_explicit_confirmation: true,
    task_category: category,
    team: {
      name,
      description: `A proposed adaptive ${category} team for: ${args.task.slice(0, 300)}`,
      coordinator_index: 0,
      agents,
      max_rounds: args.max_rounds,
      strategy: "adaptive" as const,
      max_parallel: maxParallel,
      review_policy: "on_uncertainty" as const,
      primary_context_tokens: 2_500,
      expected_input_tokens_per_call: args.expected_input_tokens_per_call,
      expected_output_tokens_per_call: args.expected_output_tokens_per_call,
      max_budget_usd: args.max_budget_usd,
    },
    orchestration: {
      sequence: [
        "TypeSafe Jev selects useful roles when configured; otherwise deterministic routing is used.",
        "One to three selected workers run in bounded batches. Scouts may use only read-only W Gateway actions.",
        "Workers return compact evidence packets instead of raw context.",
        "A reviewer runs only when policy or uncertainty requires it.",
        "The primary model receives the compact evidence result; no mandatory coordinator synthesis call is used.",
      ],
      expected_results: expectedResults(category),
      stop_and_control: [
        "Use agent_run_cancel to request cancellation between model/tool calls.",
        "Every run has a strict max_steps limit and every scout has a max_tool_calls limit.",
        "External writes are never available to adaptive subagents; proposed writes return to the primary model for normal confirmation.",
      ],
    },
    estimate: { ...estimate, warnings },
    create_payload: {
      name,
      description: `An adaptive ${category} team proposed for the supplied task.`,
      agents,
      coordinator_index: 0,
      enabled: true,
      max_rounds: args.max_rounds,
      strategy: "adaptive" as const,
      max_parallel: maxParallel,
      review_policy: "on_uncertainty" as const,
      primary_context_tokens: 2_500,
      expected_input_tokens_per_call: args.expected_input_tokens_per_call,
      expected_output_tokens_per_call: args.expected_output_tokens_per_call,
      max_budget_usd: args.max_budget_usd,
      confirmed: false,
    },
  };
}
