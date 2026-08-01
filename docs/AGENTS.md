# Agents and agent teams

OneAIWorkers stores agent definitions and agent teams in the same Cloudflare Worker. It does not create a separate Worker or key for every agent.

## Flow

1. Search for an approved agent with `w_search` or use a known immutable agent reference.
2. Start it with `w_agent_run` and set `max_steps` and `max_budget_usd`.
3. The agent works through the same permission router as every plugin action.
4. The run reports progress, usage, errors, and the final result.
5. Large results are stored and returned through `result_id`.

## Safety and cost control

- Every run has a step limit.
- A run may have a USD budget limit.
- Agents cannot see unavailable plugins or actions.
- Agents cannot approve their own risky actions.
- Creation, update, deletion, message sending, deployment, paid model calls, and other risky work require a one-time user confirmation.
- Cancellation is cooperative: a Workers AI request already in progress finishes, but the next step does not start.

## Current limits

- Up to 8 agents per team.
- Up to 3 review rounds.
- Agent state and queues use the `AgentManager` Durable Object.
- Workers AI usage is recorded in the D1 Neuron Meter.

The public MCP command list remains unchanged when an agent or plugin is added.
