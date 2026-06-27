# Install guide / Інструкція встановлення

## English

OneAIWorkers is a personal Cloudflare Worker MCP server.

It does not require KV, D1, databases, queues, or Cloudflare cron. Your LLM is expected to handle memory, scheduling, and decisions.

## Українською

OneAIWorkers — це персональний Cloudflare Worker MCP server.

Він не потребує KV, D1, баз даних, queues або Cloudflare cron. Очікується, що ваша LLM сама відповідає за памʼять, розклад і рішення.

---

## Option A: Deploy to Cloudflare button / Варіант A: кнопка Deploy to Cloudflare

This is the easiest path for non-technical users.

Це найпростіший шлях для нетехнічних користувачів.

1. Open the repository README. / Відкрийте README репозиторію.
2. Click **Deploy to Cloudflare**. / Натисніть **Deploy to Cloudflare**.
3. Sign in to Cloudflare. / Увійдіть у Cloudflare.
4. Let Cloudflare create/import and deploy the Worker. / Дайте Cloudflare створити/import і задеплоїти Worker.
5. Copy your deployed `/mcp` URL. / Скопіюйте задеплоєний `/mcp` URL.
6. Connect it to ChatGPT or another MCP client. / Підключіть його до ChatGPT або іншого MCP-клієнта.

More details: [`docs/DEPLOY_TO_CLOUDFLARE.md`](DEPLOY_TO_CLOUDFLARE.md).

## Option B: Manual install / Варіант B: ручне встановлення

### 1. Requirements / Вимоги

You need: / Вам потрібно:

- a Cloudflare account; / Cloudflare account;
- Node.js 20+; / Node.js 20+;
- Wrangler login (`npx wrangler login`); / login у Wrangler (`npx wrangler login`);
- a ChatGPT account with connector/developer mode support, or another remote MCP client. / ChatGPT account із підтримкою connector/developer mode або інший remote MCP client.

### 2. Install dependencies / Встановити залежності

```bash
npm install
```

### 3. Login to Cloudflare / Увійти в Cloudflare

```bash
npx wrangler login
```

### 4. Optional but recommended: add a shared secret / Опційно, але рекомендовано: додайте shared secret

For private personal use, set a secret: / Для приватного персонального використання задайте secret:

```bash
npx wrangler secret put MCP_SHARED_SECRET
```

Then connect to: / Потім підключайтесь до:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

This is intentionally simple. For a public app, use real OAuth or Cloudflare Access.

Це спеціально простий варіант. Для публічного додатку використовуйте справжній OAuth або Cloudflare Access.

### 5. Optional notification secrets / Опційні secrets для повідомлень

#### Telegram

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

#### Discord

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
```

#### Slack

```bash
npx wrangler secret put SLACK_WEBHOOK_URL
```

#### Generic webhook / Generic webhook

```bash
npx wrangler secret put DEFAULT_WEBHOOK_URL
```

Generic webhooks are useful for Make, Zapier, n8n, Discord, Slack, or your own endpoint.

Generic webhooks корисні для Make, Zapier, n8n, Discord, Slack або власного endpoint.

### 6. Optional child Worker factory / Опційна factory дочірніх Worker

Only configure this if you want the MCP tool `create_child_worker_from_template` to deploy safe child Workers.

Налаштовуйте це тільки якщо хочете, щоб MCP tool `create_child_worker_from_template` деплоїв безпечні дочірні Workers.

```bash
npx wrangler secret put CF_API_TOKEN
```

In `wrangler.toml` or dashboard variables: / У `wrangler.toml` або dashboard variables:

```toml
CF_ACCOUNT_ID = "your-cloudflare-account-id"
CF_WORKERS_DEV_SUBDOMAIN = "your-workers-dev-subdomain"
```

The Cloudflare API token should have the minimum permissions needed to edit Workers in the target account. Do not use your global API key.

Cloudflare API token має мати мінімальні permissions, потрібні для редагування Workers у цільовому account. Не використовуйте global API key.

### 7. Local development / Локальна розробка

```bash
npm run dev
```

Local MCP endpoint: / Локальний MCP endpoint:

```text
http://localhost:8787/mcp
```

You can test with MCP Inspector: / Можна тестувати через MCP Inspector:

```bash
npm run inspect
```

### 8. Deploy / Деплой

```bash
npm run deploy
```

After deploy, open: / Після деплою відкрийте:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/
```

Your MCP endpoint is: / Ваш MCP endpoint:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

## Connect to ChatGPT / Підключення до ChatGPT

In ChatGPT developer mode: / У ChatGPT developer mode:

1. Open Settings. / Відкрийте Settings.
2. Go to Apps & Connectors. / Перейдіть в Apps & Connectors.
3. Enable Developer mode if available. / Увімкніть Developer mode, якщо він доступний.
4. Create a connector. / Створіть connector.
5. Use your public Worker `/mcp` URL. / Вкажіть публічний `/mcp` URL вашого Worker.
6. Refresh tool metadata after deployments. / Оновлюйте tool metadata після деплоїв.

If you set `MCP_SHARED_SECRET`, add `?key=YOUR_SECRET` to the connector URL unless your client supports Bearer tokens.

Якщо ви задали `MCP_SHARED_SECRET`, додайте `?key=YOUR_SECRET` до connector URL, якщо ваш клієнт не підтримує Bearer tokens.

## First prompt / Перший prompt

```text
Use OneAIWorkers. Show me what tools are available and suggest three practical automations I can run on a schedule using your own LLM memory.

Використай OneAIWorkers. Покажи, які tools доступні, і запропонуй три практичні автоматизації, які можна запускати по розкладу з твоєю власною LLM-памʼяттю.
```
