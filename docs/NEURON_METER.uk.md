# Neuron Meter

OneAIWorkers 0.8.0 містить локальний Neuron Meter для кожного Workers AI inference, виконаного через цей deployment.

## Межі та точність

- Моделі з ID, що починається з `@cf/`, використовують Workers AI neuron billing.
- Third-party provider моделі на кшталт `openai/gpt-4.1-mini` використовують AI Gateway Unified Billing і не повинні відніматися від Workers AI neuron allocation.
- Поточні AI tools OneAIWorkers приймають лише Cloudflare-hosted моделі `@cf/`. Billing classifier готовий для майбутніх AI Gateway tools, але цей реліз не вмикає непомітно новий third-party USD spend path.
- Локальний meter охоплює тільки виклики через цей OneAIWorkers deployment. Без authenticated Cloudflare analytics він не бачить інші Workers, dashboard calls або account-wide usage.

Cloudflare зараз включає 10 000 Workers AI neurons на UTC-добу. На платному плані використання понад free allocation коштує $0.011 за 1 000 neurons. Ліміт скидається о 00:00 UTC.

## Розрахунок

Для моделі з датованими unit pricing metadata:

```text
regular_input_tokens = max(0, prompt_tokens - cached_tokens)

estimated_cost_usd =
  regular_input_tokens / 1 000 000 × input_price
  + cached_tokens / 1 000 000 × cached_input_price
  + completion_tokens / 1 000 000 × output_price

estimated_neurons = estimated_cost_usd × 1000 / 0.011
```

Cached tokens спочатку віднімаються від звичайних prompt tokens, тому cached input не рахується двічі.

`actual_neurons` залишається `null`: Cloudflare може повернути фактичні token counts, але neurons усе одно розраховуються за датованою таблицею rates, а не повертаються платформою як авторитетне per-request neuron value.

## Джерела token counts

Meter використовує два рівні:

- `local_reported_tokens`: Workers AI response містив `usage` з token counts.
- `local_estimated_tokens`: `usage` був відсутній, тому OneAIWorkers оцінив токени за розміром input/output.

Reported tokens підвищують confidence, але добовий підсумок усе одно partial, бо стосується лише цього deployment.

## Billing block у відповіді

Кожен результат `ai_chat`, `ai_embeddings`, `ai_extract_json` і `ai_run` містить `billing` з такими полями:

- model та request ID;
- prompt, completion, cached і total tokens;
- estimated USD cost та neurons;
- локально відстежене використання PSY за сьогодні;
- локальний залишок free allocation і usage percent;
- наступний UTC reset;
- source та confidence;
- попередження про відсутність account-wide total;
- hard-limit status, якщо він відомий.

## Tools

```text
ai_neuron_status
ai_neuron_history
```

Обидві дії доступні через W Gateway. Спочатку знайдіть дію, а потім викличте незмінне посилання, яке повернув `w_search`:

```json
{
  "tool_ref": "oneaiworkers:workers-ai/ai_neuron_status@1.3.1",
  "arguments": {}
}
```

`ai_neuron_history` повертає лише metadata. Prompts і outputs моделі ніколи не записуються в billing ledger.

## Agent-team preflight

Agent proposals містять:

- `estimated_neurons` за налаштованими expected input/output tokens;
- `maximum_neurons` на основі `max_output_tokens` кожного агента, тоді як input tokens залишаються явним planning assumption.

Перед постановкою run у чергу OneAIWorkers додає `neuron_preflight`:

- expected і maximum neurons;
- поточне локально відстежене usage та remainder;
- expected/max fit відносно локального залишку;
- per-agent breakdown;
- кількість historical samples;
- UTC reset і confidence warning.

Коли є локальна історія, expected prompt/output tokens беруться з 30-денної середньої для agent/model та обмежуються `max_output_tokens` агента. Інакше використовується team configuration.

Під час виконання run status накопичує estimated neurons і рахує, скільки calls мали reported або estimated token data.

## Зберігання

D1 database ліниво створює:

```sql
CREATE TABLE ai_neuron_usage (...);
CREATE TABLE ai_neuron_events (...);
```

Usage table зберігає request/run/agent IDs, model, token counts, estimated cost, estimated neurons, source і UTC timestamp. Вона не зберігає prompts, inputs, outputs або secrets.

Event table зберігає підтверджені platform signals, зокрема Cloudflare Workers AI error `3036`.

## Поведінка при hard limit

Коли Cloudflare повертає error `3036` / HTTP 429 через вичерпаний daily free allocation, OneAIWorkers:

1. записує event `daily_limit_3036`, якщо D1 доступний;
2. повертає явну помилку про daily neuron allocation;
3. показує `hard_limit_observed_today: true` через `ai_neuron_status` до наступної UTC-доби.
