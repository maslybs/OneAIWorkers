# MCP tools

[Англійська версія](TOOLS.md)

Цей Worker надає невеликий набір MCP tools. Вони зроблені як прості primitives, які scheduled LLM може комбінувати у корисні workflows.

LLM відповідає за памʼять, розклад і рішення. Worker лише виконує контрольовані дії.

## Огляд

### `hub_info`

Показує, що вміє hub, які опційні інтеграції налаштовані, і дає практичні перші prompts.

## Tools для спостереження

### `fetch_url`

Отримує публічний HTTPS URL і повертає текст. HTML-сторінки за замовчуванням спрощуються до читабельного тексту.

Приклади:

- стежити за змінами сторінки;
- перевіряти pricing конкурентів;
- читати documentation або changelog pages;
- перевіряти публічний JSON/text endpoint.

### `fetch_many_urls`

Отримує до 10 URL за один виклик.

Приклади:

- watchlists конкурентів;
- щотижневі research checks;
- моніторинг кількох landing pages.

### `fetch_rss`

Читає RSS/Atom feeds і повертає останні елементи.

Приклади:

- щоденний research digest;
- моніторинг GitHub, blog або news;
- оновлення індустрії.

### `check_url_status`

Перевіряє status code і response time для публічного URL.

Приклади:

- uptime checks;
- API health checks;
- перевірка form endpoint.

## Tools для дій

### `send_notification`

Надсилає повідомлення в Telegram, Discord, Slack або generic webhook.

### `call_webhook`

Викликає HTTPS webhook з JSON payload.

Приклади:

- запускати Make, Zapier або n8n;
- повідомляти власний backend;
- розсилати event після інтерпретації LLM.

## Factory tools

### `create_child_worker_from_template`

Деплоїть дочірній Worker з безпечного predefined template.

Поточний template:

- `webhook-forwarder`: невеликий Worker, який форвардить POST, PUT і PATCH запити у налаштований HTTPS endpoint.

Це опційно й потребує Cloudflare API credentials. Tool не відкриває виконання довільного коду.

## Рекомендована форма workflow

```text
Scheduled запуск LLM
  -> отримати/перевірити дані через OneAIWorkers
  -> порівняти з памʼяттю LLM
  -> вирішити, що важливо
  -> надіслати notification або викликати webhook через OneAIWorkers
  -> оновити памʼять LLM
```
