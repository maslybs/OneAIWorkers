# Агенти та команди агентів

OneAIWorkers 0.8.0 підтримує data-defined AI агентів у тому самому Cloudflare Worker. Для кожного агента не створюється новий Worker, API token або окремий код.

## Як це працює

1. `agent_team_propose` аналізує опис задачі детерміновано й повертає лише пропозицію:
   - старший coordinator;
   - спеціалісти;
   - відповідальність кожного;
   - етапи orchestration;
   - очікувані результати;
   - приблизну вартість у USD;
   - expected і maximum neuron estimates;
   - create payload із `confirmed: false`.
2. Після перевірки користувач окремо підтверджує `agent_team_create`.
3. Перед кожним виконанням `agent_team_start` знову показує кошторис і вимагає `confirmed: true`.
4. Durable Object ставить run у чергу. Coordinator планує роботу, спеціалісти виконують свої частини, coordinator дає feedback між rounds і синтезує фінальний результат.
5. `agent_run_status` повертає stage, outputs, usage estimate, neuron usage, error або final result.
6. `agent_run_cancel` запитує зупинку між AI calls.

## Контроль вартості

Кошторис базується на:

- кількості агентів;
- кількості rounds;
- очікуваних input/output tokens на один call;
- curated pricing metadata вибраних Workers AI моделей.

`max_budget_usd` може бути заданий у team або для конкретного run. Якщо estimate перевищує budget, OneAIWorkers не починає жодного AI call.

Це estimate, а не billing guarantee. Реальна вартість залежить від фактичних tokens, retries, змін pricing та daily free Workers AI allocation.

## Neuron preflight та usage

Proposal тепер містить expected і output-bounded maximum neuron estimates. Перед тим як `agent_team_start` поставить run у чергу, OneAIWorkers порівнює ці estimates з локально відстеженим залишком PSY на поточну UTC-добу. Якщо є локальна історія, expected estimate використовує 30-денне середнє token usage для agent/model; інакше використовуються team token assumptions.

Кожен agent call записується в спільний D1 Neuron Meter із `run_id` та `agent_id`. Run status накопичує estimated neurons і показує, чи кожен call використовував Cloudflare-reported tokens або локальну fallback estimate. Це не account-wide Cloudflare total; деталі наведено в `NEURON_METER.uk.md`.

## Увімкнення й вимкнення

- `agent_update` з `enabled: false` блокує майбутні runs цього агента.
- `agent_team_update` з `enabled: false` блокує майбутні runs команди.
- Активний run контролюється через `agent_run_status` і `agent_run_cancel`.
- Видалення агента або команди завжди потребує explicit confirmation.

## Обмеження 0.8.0

- Максимум 8 агентів у команді.
- Максимум 3 rounds.
- Agents виконують AI-only analysis/drafting/review. Вони ще не викликають saved connector tools.
- Cancellation є cooperative: AI request, що вже виконується, не можна перервати, але наступний step не почнеться.
- Черга, progress і results зберігаються в SQLite-backed Durable Object `AgentManager`.
- Локальний Neuron Meter не бачить usage інших Workers або dashboard calls у тому самому Cloudflare account.

## Клієнти із закешованим списком tools

Деякі MCP-клієнти зберігають старий список верхньорівневих команд. Для таких клієнтів OneAIWorkers має дві постійні живі дії:

1. Викличте `list_connectors` з `include_actions: true`.
2. Для керування конекторами використовуйте `connector_id: system`, для AI та агентів — `connector_id: native`, а для збереженого конектора — його власний ID.
3. Виберіть потрібну action та її `input_schema`.
4. Викличте `call_connector_tool` з цим ID та назвою action.

Шлюз читає поточний реєстр конекторів із D1 під час кожного виклику. Для сумісності зі старими клієнтами відомі системні дії також працюють через `connector_id: native`.

Приклад proposal без створення агентів і без AI-витрат:

```json
{
  "connector_id": "native",
  "action_name": "agent_team_propose",
  "input": {
    "task": "Проаналізувати архітектуру застосунку",
    "max_agents": 4,
    "priority": "balanced",
    "max_rounds": 1
  },
  "dry_run": false,
  "confirmed": false
}
```

Для AI inference, створення, зміни, видалення, запуску або cancellation використовується зовнішнє поле `confirmed: true`. `dry_run: true` лише перевіряє input і нічого не запускає.

Neuron status через frozen gateway:

```json
{
  "connector_id": "native",
  "action_name": "ai_neuron_status",
  "input": {}
}
```

## Основні tools

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
