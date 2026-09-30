# Agents and agent teams

OneAIWorkers Agent v2 is designed as a **bounded context-offloading layer**, not as an unrestricted autonomous swarm. Its job is to move large searches, logs, source material, and first-pass analysis away from the primary ChatGPT/Claude context and return a small evidence packet.

Existing saved teams remain in `legacy` mode. New proposals use `adaptive` mode.

## Adaptive flow

1. Start an approved team with `w_agent_run`, a strict `max_steps`, and a budget.
2. TypeSafe Jev is used as an optional low-cost routing/verification signal when `TYPESAFE_API_KEY` is configured. If Jev is unavailable or inconclusive, deterministic routing is used.
3. One to three useful workers are selected instead of running every configured role.
4. A `scout` may search and call only **read-only W Gateway operations**. It inherits the same tenant, user, endpoint, session, and permission context as the original `w_agent_run`.
5. Scouts use a bounded flow: capability search → one short tool plan → parallel read-only calls → one compact evidence response.
6. `specialist` agents analyze bounded evidence without autonomous writes.
7. A `reviewer` runs only when policy or uncertainty indicates that independent review is useful.
8. Adaptive mode does not spend a mandatory coordinator/synthesis model call. OneAIWorkers deterministically returns a compact result targeted to `primary_context_tokens`.

The intended result is a small packet containing conclusions, confidence, facts, evidence, uncertainties, and proposed actions rather than raw source material.

## Agent kinds

- `scout`: retrieve/filter evidence; may use bounded read-only tools.
- `specialist`: solve a bounded analytical/coding/domain problem.
- `reviewer`: independently challenge weak or conflicting conclusions.
- `synthesizer`: retained for explicit/legacy use; adaptive mode normally avoids an extra synthesis model call.

## Tool safety

Adaptive subagents do **not** receive a general write-capable `w_call`.

A short-lived signed capability carries the original W Gateway security context into the Durable Object. The internal broker repeats normal discovery/execute policy checks and accepts only tools that are both `read_only` and do not require confirmation.

If an agent believes a write would help, it returns the operation in `proposed_actions`. The primary MCP client can then execute it through normal `w_call` and user confirmation.

Jev output is never used as a permission, credential, or confirmation decision.

## Models and AI Gateway

Workers AI profiles continue to use `@cf/...` model IDs. An agent may also use an explicit third-party `provider/model` ID when `AI_GATEWAY_ID` is configured. Those requests are sent through the Cloudflare Workers AI binding with AI Gateway logging metadata.

If `AI_GATEWAY_ID` is configured, native Workers AI calls are also routed through the gateway for observability while retaining the local Neuron Meter.

Third-party AI Gateway calls may not have a curated local price snapshot. In that case OneAIWorkers reports the call as unpriced locally; use AI Gateway/provider spend controls in addition to `max_budget_usd`.

## Optional TypeSafe Jev

Set `TYPESAFE_API_KEY` to enable Jev. Optional overrides are `TYPESAFE_MODEL` (default `jev-latest`) and `TYPESAFE_API_URL`.

Jev is used only for cheap typed decisions such as “which role is useful?” or “does this evidence need review?”. It is fail-open: an API failure falls back to deterministic routing rather than breaking the run.

## Limits

- Up to 8 agents in a saved team.
- Adaptive execution uses at most 3 workers in one batch.
- `max_steps` bounds model/tool work for the whole run.
- Each scout has its own `max_tool_calls` limit (maximum 8).
- Tool access is read-only; autonomous external writes are intentionally unsupported.
- Cancellation is cooperative between model/tool calls.
- The private broker capability is not returned in run status and is cleared when the run terminates.
- Large tool results currently rely on their compact W Gateway preview/result reference; deep automatic `w_result_read` traversal is not part of the bounded scout loop yet.

## Legacy teams

Teams created before Agent v2 migrate with `strategy: legacy`. Their coordinator → specialists → optional feedback → synthesis behavior remains available for compatibility. New `agent_team_propose` responses use adaptive mode.
