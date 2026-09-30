# Агенти та команди агентів

Agent v2 у OneAIWorkers — це **обмежений шар для винесення контексту й роботи з основної моделі**, а не необмежений автономний swarm. Його задача — забрати на себе великі логи, пошук, сирі дані та первинний аналіз і повернути ChatGPT/Claude невеликий доказовий результат.

Існуючі збережені команди залишаються в режимі `legacy`. Нові пропозиції використовують `adaptive`.

## Adaptive flow

1. Команда запускається через `w_agent_run` із жорстким `max_steps` та бюджетом.
2. Якщо налаштований `TYPESAFE_API_KEY`, TypeSafe Jev використовується як дешевий сигнал для routing/verification. Якщо Jev недоступний або невпевнений, працюють детерміновані правила.
3. Запускаються лише 1–3 корисні workers, а не всі ролі команди.
4. `scout` може шукати й викликати тільки **read-only дії W Gateway**. Він успадковує ті самі tenant/user/endpoint/session permissions, що й початковий `w_agent_run`.
5. Scout має обмежений flow: пошук capabilities → один короткий план tool calls → паралельні read-only calls → один compact evidence result.
6. `specialist` аналізує обмежений набір доказів без автономних write-дій.
7. `reviewer` запускається лише коли policy або невизначеність справді потребують незалежної перевірки.
8. В adaptive mode немає обов'язкового окремого LLM-виклику coordinator/synthesizer. OneAIWorkers детерміновано формує компактний фінальний результат із ціллю `primary_context_tokens`.

Результат містить conclusion, confidence, facts, evidence, uncertainties і proposed actions замість передачі основній моделі сирого великого контексту.

## Типи агентів

- `scout` — знаходить і фільтрує докази; може мати bounded read-only tools.
- `specialist` — вирішує вузьку аналітичну/coding/domain задачу.
- `reviewer` — незалежно перевіряє слабкі або суперечливі висновки.
- `synthesizer` — лишається для явного/legacy використання; adaptive mode зазвичай не витрачає ще один model call на synthesis.

## Безпека tools

Adaptive subagent **не отримує** універсальний write-capable `w_call`.

Короткоживучий підписаний capability переносить security context початкового W Gateway request у Durable Object. Внутрішній broker повторно перевіряє звичайні discovery/execute policies і дозволяє тільки tools, які одночасно `read_only` і не вимагають confirmation.

Якщо agent вважає, що треба щось змінити, він повертає це в `proposed_actions`. Основний MCP-клієнт може виконати дію звичайним `w_call` із нормальним confirmation користувача.

Jev ніколи не приймає рішення про permissions, credentials або confirmation.

## Моделі та AI Gateway

Профілі Workers AI надалі використовують `@cf/...`. Також agent може мати точний third-party ID у форматі `provider/model`, якщо налаштовано `AI_GATEWAY_ID`. Такий inference іде через Cloudflare AI Gateway з logging metadata.

Якщо `AI_GATEWAY_ID` заданий, native Workers AI calls теж проходять через gateway для observability, але локальний Neuron Meter зберігається.

Для third-party models локальний pricing snapshot може бути відсутній. Тоді OneAIWorkers позначає call як unpriced locally; для реального spend limit треба також використовувати AI Gateway/provider controls.

## Optional TypeSafe Jev

`TYPESAFE_API_KEY` вмикає Jev. Додатково можна задати `TYPESAFE_MODEL` (default `jev-latest`) та `TYPESAFE_API_URL`.

Jev використовується тільки для дешевих typed-рішень: наприклад, яку роль запускати або чи потрібен reviewer. Якщо API не відповідає, run не падає — використовується deterministic fallback.

## Обмеження

- До 8 агентів у збереженій команді.
- В одному adaptive batch — максимум 3 workers.
- `max_steps` обмежує загальну кількість model/tool work.
- Кожен scout має окремий `max_tool_calls` (максимум 8).
- Tools тільки read-only; автономні зовнішні write-дії навмисно не підтримуються.
- Cancellation працює між model/tool calls.
- Приватний broker capability не повертається в run status і видаляється після завершення.
- Для дуже великих tool results scout поки використовує compact W Gateway preview/result reference; автоматичний deep `w_result_read` loop навмисно ще не додано.

## Legacy teams

Команди, створені до Agent v2, мігрують із `strategy: legacy`. Їхній flow coordinator → specialists → optional feedback → synthesis лишається для сумісності. Новий `agent_team_propose` створює adaptive proposal.
