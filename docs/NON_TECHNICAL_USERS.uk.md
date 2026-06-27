# Для нетехнічних користувачів

[Англійська версія](NON_TECHNICAL_USERS.md)

OneAIWorkers — це не окремий додаток із dashboard. Це невеликий Cloudflare Worker, який дає вашій LLM безпечний набір дій.

LLM тримає памʼять і запускається по розкладу. Worker лише виконує дії, коли LLM його викликає.

## Що користувачі можуть робити

- Просити LLM перевіряти сайти по розкладу.
- Просити LLM моніторити сторінки конкурентів.
- Просити LLM збирати RSS/news updates.
- Просити LLM викликати Make/Zapier/n8n webhook.
- Просити LLM надсилати Telegram/Discord/Slack notifications.

## Що потрібно користувачу

Мінімум:

1. Cloudflare account.
2. Задеплоєний Worker.
3. Публічний `/mcp` URL, підключений до ChatGPT або іншого MCP-клієнта.

Опційно:

- `MCP_SHARED_SECRET` для приватного доступу.
- Telegram/Discord/Slack/webhook secrets для повідомлень.
- Cloudflare API token тільки якщо потрібне створення дочірніх Worker.

## Простий flow встановлення

1. Натиснути **Deploy to Cloudflare** в README або завантажити ZIP проєкту.
2. Задеплоїти Worker у свій Cloudflare account.
3. Скопіювати задеплоєний `/mcp` URL.
4. Додати цей URL як connector у ChatGPT або іншому MCP-клієнті.
5. Додати optional secrets, якщо потрібен приватний доступ або повідомлення.

## Перший prompt

```text
Використай OneAIWorkers. Покажи, які tools у тебе є, і запропонуй три прості автоматизації, які можна запускати по розкладу.
```
