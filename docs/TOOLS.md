# MCP tools / MCP tools

## English

This Worker exposes a small set of MCP tools. They are designed as primitives that a scheduled LLM can combine into useful workflows.

The LLM owns memory, scheduling, and decisions. The Worker only executes controlled actions.

## Українською

Цей Worker надає невеликий набір MCP tools. Вони зроблені як прості primitives, які scheduled LLM може комбінувати у корисні workflows.

LLM відповідає за памʼять, розклад і рішення. Worker лише виконує контрольовані дії.

---

## Discovery / Огляд

### `hub_info`

Shows what the hub can do, which optional integrations are configured, and practical first prompts.

Показує, що вміє hub, які опційні інтеграції налаштовані, і дає практичні перші prompts.

## Observe tools / Tools для спостереження

### `fetch_url`

Fetches a public HTTPS URL and returns text. HTML pages are simplified into readable text by default.

Отримує публічний HTTPS URL і повертає текст. HTML-сторінки за замовчуванням спрощуються до читабельного тексту.

Use cases / Приклади:

- watch a page for changes; / стежити за змінами сторінки;
- check competitor pricing; / перевіряти pricing конкурентів;
- read documentation/changelog pages; / читати документацію/changelog pages;
- inspect a public JSON/text endpoint. / перевіряти публічний JSON/text endpoint.

### `fetch_many_urls`

Fetches up to 10 URLs in one call.

Отримує до 10 URL за один виклик.

Use cases / Приклади:

- competitor watchlists; / watchlists конкурентів;
- weekly research checks; / щотижневі research checks;
- monitoring several landing pages. / моніторинг кількох landing pages.

### `fetch_rss`

Reads RSS/Atom feeds and returns recent items.

Читає RSS/Atom feeds і повертає останні елементи.

Use cases / Приклади:

- daily research digest; / щоденний research digest;
- GitHub/blog/news monitoring; / моніторинг GitHub/blog/news;
- industry updates. / оновлення індустрії.

### `check_url_status`

Checks status code and response time for a public URL.

Перевіряє status code і response time для публічного URL.

Use cases / Приклади:

- uptime checks; / uptime checks;
- API health checks; / API health checks;
- form endpoint checks. / перевірка form endpoint.

## Action tools / Tools для дій

### `send_notification`

Sends a message to Telegram, Discord, Slack, or a generic webhook.

Надсилає повідомлення в Telegram, Discord, Slack або generic webhook.

### `call_webhook`

Calls an HTTPS webhook with a JSON payload.

Викликає HTTPS webhook з JSON payload.

Use cases / Приклади:

- trigger Make/Zapier/n8n; / запускати Make/Zapier/n8n;
- notify a custom backend; / повідомляти власний backend;
- fan out an event after LLM interpretation. / розсилати event після інтерпретації LLM.

## Factory tools / Factory tools

### `create_child_worker_from_template`

Deploys a child Worker from a safe predefined template.

Деплоїть дочірній Worker з безпечного predefined template.

Current template / Поточний template:

- `webhook-forwarder`: a small Worker that forwards POST/PUT/PATCH requests to a configured HTTPS endpoint. / невеликий Worker, який форвардить POST/PUT/PATCH запити у налаштований HTTPS endpoint.

This is optional and requires Cloudflare API credentials. It does not expose arbitrary code execution.

Це опційно й потребує Cloudflare API credentials. Tool не відкриває виконання довільного коду.

## Recommended workflow shape / Рекомендована форма workflow

```text
LLM scheduled run
  -> fetch/check data through OneAIWorkers
  -> compare with LLM memory
  -> decide what matters
  -> notify or call webhook through OneAIWorkers
  -> update LLM memory

Scheduled запуск LLM
  -> отримати/перевірити дані через OneAIWorkers
  -> порівняти з памʼяттю LLM
  -> вирішити, що важливо
  -> надіслати notification або викликати webhook через OneAIWorkers
  -> оновити памʼять LLM
```
