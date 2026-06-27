# For non-technical users / Для нетехнічних користувачів

## English

OneAIWorkers is not a separate app with a dashboard. It is a small Cloudflare Worker that gives your LLM a safe set of actions.

The LLM keeps memory and runs on a schedule. The Worker only performs actions when the LLM calls it.

### What users can do with it

- Ask the LLM to check websites on a schedule.
- Ask the LLM to monitor competitor pages.
- Ask the LLM to collect RSS/news updates.
- Ask the LLM to call a Make/Zapier/n8n webhook.
- Ask the LLM to send Telegram/Discord/Slack notifications.

### What users need

Minimum:

1. A Cloudflare account.
2. This Worker deployed to Cloudflare.
3. The public `/mcp` URL connected to ChatGPT or another MCP client.

Optional:

- `MCP_SHARED_SECRET` for private access.
- Telegram/Discord/Slack/webhook secrets for notifications.
- Cloudflare API token only if they want child Worker creation.

### Simple installation flow

1. Download the project ZIP or clone the GitHub repo.
2. Open the folder in a terminal.
3. Run `npm install`.
4. Run `npx wrangler login`.
5. Run `npm run deploy`.
6. Copy the deployed `/mcp` URL.
7. Add that URL as a connector in ChatGPT or another MCP client.

### First prompt

```text
Use OneAIWorkers. Show me what tools you have and suggest three simple automations I can run on a schedule.
```

## Українською

OneAIWorkers — це не окремий додаток із dashboard. Це невеликий Cloudflare Worker, який дає вашій LLM безпечний набір дій.

LLM тримає памʼять і запускається по розкладу. Worker лише виконує дії, коли LLM його викликає.

### Що користувачі можуть робити

- Просити LLM перевіряти сайти по розкладу.
- Просити LLM моніторити сторінки конкурентів.
- Просити LLM збирати RSS/news updates.
- Просити LLM викликати Make/Zapier/n8n webhook.
- Просити LLM надсилати Telegram/Discord/Slack notifications.

### Що потрібно користувачу

Мінімум:

1. Cloudflare account.
2. Задеплоєний Worker.
3. Публічний `/mcp` URL, підключений до ChatGPT або іншого MCP-клієнта.

Опційно:

- `MCP_SHARED_SECRET` для приватного доступу.
- Telegram/Discord/Slack/webhook secrets для повідомлень.
- Cloudflare API token тільки якщо потрібне створення дочірніх Worker.

### Простий flow встановлення

1. Завантажити ZIP проєкту або склонувати GitHub repo.
2. Відкрити папку в terminal.
3. Запустити `npm install`.
4. Запустити `npx wrangler login`.
5. Запустити `npm run deploy`.
6. Скопіювати задеплоєний `/mcp` URL.
7. Додати цей URL як connector у ChatGPT або іншому MCP-клієнті.

### Перший prompt

```text
Використай OneAIWorkers. Покажи, які tools у тебе є, і запропонуй три прості автоматизації, які можна запускати по розкладу.
```
