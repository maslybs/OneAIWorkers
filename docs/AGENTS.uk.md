# Агенти та команди агентів

OneAIWorkers 0.7.0 підтримує data-defined AI агентів у тому самому Cloudflare Worker. Для кожного агента не створюється новий Worker, API token або окремий код.

## Як це працює

1. `agent_team_propose` аналізує опис задачі детерміновано й повертає лише пропозицію:
   - старший coordinator;
   - спеціалісти;
   - відповідальність кожного;
   - етапи orchestration;
   - очікувані результати;
   - приблизну вартість у USD;
   - create payload із `confirmed: false`.
2. Після перевірки користувач окремо підтверджує `agent_team_create`.
3. Перед кожним виконанням `agent_team_start` знову показує кошторис і вимагає `confirmed: true`.
4. Durable Object ставить run у чергу. Coordinator планує роботу, спеціалісти виконують свої частини, coordinator дає feedback між rounds і синтезує фінальний результат.
5. `agent_run_status` повертає stage, outputs, usage estimate, error або final result.
6. `agent_run_cancel` запитує зупинку між AI calls.

## Контроль вартості

Кошторис базується на:

- кількості агентів;
- кількості rounds;
- очікуваних input/output tokens на один call;
- curated pricing metadata вибраних Workers AI моделей.

`max_budget_usd` може бути заданий у team або для конкретного run. Якщо estimate перевищує budget, OneAIWorkers не починає жодного AI call.

Це estimate, а не billing guarantee. Реальна вартість залежить від фактичних tokens, retries, змін pricing та daily free Workers AI allocation.

## Увімкнення й вимкнення

- `agent_update` з `enabled: false` блокує майбутні runs цього агента.
- `agent_team_update` з `enabled: false` блокує майбутні runs команди.
- Активний run контролюється через `agent_run_status` і `agent_run_cancel`.
- Видалення агента або команди завжди потребує explicit confirmation.

## Обмеження 0.7.0

- Максимум 8 агентів у команді.
- Максимум 3 rounds.
- Agents виконують AI-only analysis/drafting/review. Вони ще не викликають saved connector tools.
- Cancellation є cooperative: AI request, що вже виконується, не можна перервати, але наступний step не почнеться.
- Черга, progress і results зберігаються в SQLite-backed Durable Object `AgentManager`.

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
```
