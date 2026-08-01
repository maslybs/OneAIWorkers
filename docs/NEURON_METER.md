# Neuron Meter

OneAIWorkers 0.8.0 includes a local Neuron Meter for every Workers AI inference performed through this deployment.

## Scope and confidence

- Models whose IDs start with `@cf/` use Workers AI neuron billing.
- Third-party provider model IDs such as `openai/gpt-4.1-mini` use AI Gateway Unified Billing and must not be subtracted from the Workers AI neuron allocation.
- The current OneAIWorkers AI tools accept Cloudflare-hosted `@cf/` models only. The billing classifier is ready for future AI Gateway tools, but this release does not silently enable a new third-party USD spend path.
- The local meter covers only calls made through this OneAIWorkers deployment. It cannot see other Workers, dashboard calls, or account-wide usage without authenticated Cloudflare analytics access.

Cloudflare currently includes 10,000 Workers AI neurons per UTC day. Paid usage above the free allocation is priced at $0.011 per 1,000 neurons. The allocation resets at 00:00 UTC.

## Calculation

For a model with dated unit pricing metadata:

```text
regular_input_tokens = max(0, prompt_tokens - cached_tokens)

estimated_cost_usd =
  regular_input_tokens / 1,000,000 × input_price
  + cached_tokens / 1,000,000 × cached_input_price
  + completion_tokens / 1,000,000 × output_price

estimated_neurons = estimated_cost_usd × 1000 / 0.011
```

Cached tokens are subtracted from regular prompt tokens before applying the cached rate, so cached input is not counted twice.

`actual_neurons` remains `null`: Cloudflare may report actual token counts, but neurons are still calculated from the dated rate table rather than returned as an authoritative per-request neuron value.

## Token sources

The meter uses two source levels:

- `local_reported_tokens`: the Workers AI response contained a `usage` object with token counts.
- `local_estimated_tokens`: the response omitted usage, so OneAIWorkers estimated tokens from input and output size.

Reported tokens improve confidence, but the daily total is still partial because it is local to this deployment.

## Returned billing block

Every `ai_chat`, `ai_embeddings`, `ai_extract_json`, and `ai_run` result includes a `billing` object with:

- model and request ID;
- prompt, completion, cached, and total tokens;
- estimated USD cost and neurons;
- locally tracked PSY usage today;
- remaining local free allocation and usage percentage;
- next UTC reset time;
- source and confidence;
- account-total caveat;
- hard-limit status when known.

## Tools

```text
ai_neuron_status
ai_neuron_history
```

Both actions are available through W Gateway. Search first, then call the immutable reference returned by `w_search`:

```json
{
  "tool_ref": "oneaiworkers:workers-ai/ai_neuron_status@1.1.0",
  "arguments": {}
}
```

`ai_neuron_history` returns metadata only. Prompts and model outputs are never stored in the billing ledger.

## Agent-team preflight

Agent proposals include:

- `estimated_neurons`, based on configured expected input/output tokens;
- `maximum_neurons`, using each agent's `max_output_tokens` while treating input tokens as an explicit planning assumption.

Before a run is queued, OneAIWorkers adds `neuron_preflight` with:

- expected and maximum neurons;
- current locally tracked usage and remainder;
- expected/max fit against the local remainder;
- per-agent breakdown;
- historical sample counts;
- UTC reset time and confidence warning.

When local history exists, expected prompt/output tokens use a 30-day agent/model average, capped by each agent's maximum output tokens. Otherwise the team configuration is used.

During execution, run status accumulates estimated neurons and counts how many calls used reported versus estimated token data.

## Storage

The D1 database lazily creates:

```sql
CREATE TABLE ai_neuron_usage (...);
CREATE TABLE ai_neuron_events (...);
```

The usage table stores request/run/agent IDs, model, token counts, estimated cost, estimated neurons, source, and UTC timestamp. It does not store prompts, inputs, outputs, or secrets.

The event table records confirmed platform signals such as Cloudflare Workers AI error `3036`.

## Hard-limit behavior

When Cloudflare returns error `3036` / HTTP 429 for exhausted daily free allocation, OneAIWorkers:

1. records a `daily_limit_3036` event when D1 is available;
2. returns an explicit daily-neuron-allocation error;
3. exposes `hard_limit_observed_today: true` through `ai_neuron_status` until the next UTC day.
