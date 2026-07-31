# Agents and agent teams

OneAIWorkers 0.8.0 supports data-defined AI agents inside the same Cloudflare Worker. It does not create a new Worker, API token, or code deployment for each agent.

## Flow

1. `agent_team_propose` deterministically returns a proposal only:
   - senior coordinator;
   - specialist agents;
   - responsibilities;
   - orchestration stages;
   - expected results;
   - estimated USD cost;
   - a create payload with `confirmed: false`.
2. The user reviews it and separately confirms `agent_team_create`.
3. Every execution requires a separate confirmed `agent_team_start` call.
4. A SQLite-backed Durable Object queues the run. The coordinator plans, specialists produce deliverables, optional review rounds provide feedback, and the coordinator synthesizes the final result.
5. `agent_run_status` reports stage, outputs, estimated usage, errors, or final result.
6. `agent_run_cancel` requests cancellation between Workers AI calls.

## Cost control

The preflight estimate uses agent count, rounds, expected input/output tokens per call, and the curated pricing metadata for each selected Workers AI model.

A team or run can define `max_budget_usd`. If the estimate exceeds that limit, no model call starts.

The value is an estimate, not a billing guarantee. Actual cost depends on real token usage, retries, pricing changes, and the daily free Workers AI allocation.

## Neuron preflight and usage

Proposals now include expected and output-bounded maximum neuron estimates. Before `agent_team_start` queues a run, OneAIWorkers compares those estimates with the locally tracked PSY remainder for the current UTC day. When local history exists, the expected estimate uses a 30-day agent/model token average; otherwise it uses the team token assumptions.

Every agent call is recorded in the shared D1 Neuron Meter with `run_id` and `agent_id`. Run status accumulates estimated neurons and reports whether each call used Cloudflare-reported tokens or a local fallback estimate. This is not an account-wide Cloudflare total; see `NEURON_METER.md`.

## Lifecycle controls

- Disable an agent with `agent_update` and `enabled: false`.
- Disable a team with `agent_team_update` and `enabled: false`.
- Inspect or cancel an active run through `agent_run_status` and `agent_run_cancel`.
- Create, update, delete, run, and cancel operations require explicit confirmation where appropriate.

## Version 0.8.0 limits

- Up to 8 agents per team.
- Up to 3 review rounds.
- Agents perform AI-only analysis, drafting, review, and synthesis. They do not yet invoke saved connector tools.
- Cancellation is cooperative: a Workers AI request already in flight cannot be interrupted, but the next step will not start.
- Registry, queue, progress, budgets, and results are stored in the SQLite-backed `AgentManager` Durable Object.
- The local Neuron Meter does not include other Workers or dashboard calls in the same Cloudflare account.

## Clients with a cached tool list

Some MCP clients keep a frozen snapshot of top-level tools. OneAIWorkers keeps two permanent live methods for those clients:

1. Call `list_connectors` with `include_actions: true`.
2. Use `connector_id: system` for connector management, `connector_id: native` for AI and agents, or a saved connector's own ID.
3. Select the required action and its `input_schema`.
4. Call `call_connector_tool` with that connector ID and action name.

The gateway reads the current D1 connector registry on every call. Known system actions also work with `connector_id: native` for older cached clients.

Example proposal without creating agents or consuming AI:

```json
{
  "connector_id": "native",
  "action_name": "agent_team_propose",
  "input": {
    "task": "Review the application architecture",
    "max_agents": 4,
    "priority": "balanced",
    "max_rounds": 1
  },
  "dry_run": false,
  "confirmed": false
}
```

AI inference, creation, updates, deletion, execution, and cancellation use the outer `confirmed: true` field. `dry_run: true` only validates the input and executes nothing.

## Tools

```text
agent_capabilities
agent_team_propose
agent_create
agent_list
agent_get
agent_update
agent_delete
agent_team_create
agent_team_list
agent_team_get
agent_team_update
agent_team_delete
agent_team_start
agent_run_list
agent_run_status
agent_run_cancel
ai_neuron_status
ai_neuron_history
```
