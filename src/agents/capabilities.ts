import type { Env } from "../types";
import { MAX_AGENTS, MAX_ROUNDS } from "./constants";

export function agentCapabilities(env: Env) {
  return {
    configured: Boolean(env.AGENT_MANAGER && env.AI),
    durable_object_binding: Boolean(env.AGENT_MANAGER),
    workers_ai_binding: Boolean(env.AI),
    ai_gateway: {
      supported: Boolean(env.AI),
      gateway_id_configured: Boolean(env.AI_GATEWAY_ID),
      third_party_model_ids: "provider/model",
      unified_billing: "available when enabled for the selected AI Gateway/provider",
    },
    jev: {
      configured: Boolean(env.TYPESAFE_API_KEY),
      model: env.TYPESAFE_MODEL || "jev-latest",
      role: "optional routing and verification signal; never a security authority",
    },
    architecture: "bounded adaptive subagents stored in one SQLite-backed Durable Object namespace",
    creates_new_workers: false,
    requires_cloudflare_api_token: false,
    execution: {
      mode: "durable adaptive batches via Durable Object alarms",
      max_agents_per_team: MAX_AGENTS,
      max_rounds: MAX_ROUNDS,
      max_parallel: 3,
      background_progress: true,
      cancellation: "cooperative between model/tool calls",
      connector_tool_execution: "read_only_adaptive",
      external_writes: "never available to subagents; return proposed actions to the primary model",
      compact_output: "evidence packets bounded by the team's primary_context_tokens target",
    },
    controls: [
      "Existing teams remain in legacy mode; new proposals use adaptive mode.",
      "Adaptive teams avoid mandatory coordinator calls and only invoke a reviewer when needed.",
      "Read-only scouts inherit the exact tenant/user/endpoint policy context of w_agent_run.",
      "Every team run has step and budget limits; every scout has a separate tool-call limit.",
    ],
    limitations: [
      "Agent tool use is intentionally read-only and bounded; external writes remain a primary-model responsibility.",
      "Cancellation cannot interrupt a model or external read already in flight; it takes effect before the next step.",
      "Third-party AI Gateway calls may not have a local price snapshot; those calls are reported as unpriced until live billing data is available.",
      "Jev is optional and fail-open: routing falls back to deterministic rules when unavailable.",
    ],
  };
}
