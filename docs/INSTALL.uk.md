# Інструкція встановлення

[Англійська версія](INSTALL.md)

OneAIWorkers — це персональний Cloudflare Worker MCP server.

Він не потребує KV, D1, баз даних, queues або Cloudflare cron. Очікується, що ваша LLM сама відповідає за памʼять, розклад і рішення.

## Варіант A: кнопка Deploy to Cloudflare

Це найпростіший шлях для нетехнічних користувачів.

1. Відкрийте README репозиторію.
2. Натисніть **Deploy to Cloudflare**.
3. Увійдіть у Cloudflare.
4. Дайте Cloudflare створити або імпортувати й задеплоїти Worker.
5. Скопіюйте задеплоєний `/mcp` URL.
6. Підключіть його до ChatGPT або іншого MCP-клієнта.

Детальніше: [`DEPLOY_TO_CLOUDFLARE.uk.md`](DEPLOY_TO_CLOUDFLARE.uk.md).

## Варіант B: ручне встановлення

### 1. Вимоги

Вам потрібно:

- Cloudflare account;
- Node.js 20+;
- login у Wrangler через `npx wrangler login`;
- ChatGPT account із підтримкою connector/developer mode або інший remote MCP client.

### 2. Встановити залежності

```bash
npm install
```

### 3. Увійти в Cloudflare

```bash
npx wrangler login
```

### 4. Опційно, але рекомендовано: додайте shared secret

Для приватного персонального використання задайте secret:

```bash
npx wrangler secret put MCP_SHARED_SECRET
```

Потім підключайтесь до:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

Це спеціально простий варіант. Для публічного додатку використовуйте справжній OAuth або Cloudflare Access.

### 5. Опційні secrets для повідомлень

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

#### Generic webhook

```bash
npx wrangler secret put DEFAULT_WEBHOOK_URL
```

Generic webhooks корисні для Make, Zapier, n8n, Discord, Slack або власного endpoint.

### 6. Опційна factory дочірніх Worker

Налаштовуйте це тільки якщо хочете, щоб MCP tool `create_child_worker_from_template` деплоїв безпечні дочірні Workers.

```bash
npx wrangler secret put CF_API_TOKEN
```

У `wrangler.toml` або dashboard variables:

```toml
CF_ACCOUNT_ID = "your-cloudflare-account-id"
CF_WORKERS_DEV_SUBDOMAIN = "your-workers-dev-subdomain"
```

Cloudflare API token має мати мінімальні permissions, потрібні для редагування Workers у цільовому account. Не використовуйте global API key.

### 7. Локальна розробка

```bash
npm run dev
```

Локальний MCP endpoint:

```text
http://localhost:8787/mcp
```

Можна тестувати через MCP Inspector:

```bash
npm run inspect
```

### 8. Деплой

```bash
npm run deploy
```

Після деплою відкрийте:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/
```

Ваш MCP endpoint:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

## Підключення до ChatGPT

У ChatGPT developer mode:

1. Відкрийте Settings.
2. Перейдіть в Apps & Connectors.
3. Увімкніть Developer mode, якщо він доступний.
4. Створіть connector.
5. Вкажіть публічний `/mcp` URL вашого Worker.
6. Оновлюйте tool metadata після деплоїв.

Якщо ви задали `MCP_SHARED_SECRET`, додайте `?key=YOUR_SECRET` до connector URL, якщо ваш клієнт не підтримує Bearer tokens.

## Перший prompt

```text
Використай OneAIWorkers. Покажи, які tools доступні, і запропонуй три практичні автоматизації, які можна запускати по розкладу з твоєю власною LLM-памʼяттю.
```
