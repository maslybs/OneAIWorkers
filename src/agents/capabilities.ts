import type { Env } from "../types";
import { MAX_AGENTS, MAX_ROUNDS } from "./constants";

export function agentCapabilities(env: Env) {
  return {
    configured: Boolean(env.AGENT_MANAGER && env.AI),
    durable_object_binding: Boolean(env.AGENT_MANAGER),
    workers_ai_binding: Boolean(env.AI),
    architecture: "data-defined agents stored in one SQLite-backed Durable Object namespace",
    creates_new_workers: false,
    requires_cloudflare_api_token: false,
    execution: {
      mode: "durable queued steps via Durable Object alarms",
      max_agents_per_team: MAX_AGENTS,
      max_rounds: MAX_ROUNDS,
      background_progress: true,
      cancellation: "cooperative between model calls",
      connector_tool_execution: false,
    },
    controls: [
      "Agents and teams can be enabled, disabled, updated, or deleted.",
      "Every team run has a preflight USD estimate and can enforce a maximum budget.",
      "A proposed team is never created until the user confirms agent_team_create.",
      "A run is never started until the user confirms agent_team_start.",
    ],
    limitations: [
      "Version 0.7 runs AI-only specialist agents. Saved connector tools are not yet callable from agent turns.",
      "Cancellation cannot interrupt a Workers AI request already in flight; it takes effect before the next step.",
      "Costs are estimates based on configured token assumptions and a dated curated pricing snapshot.",
    ],
  };
}
