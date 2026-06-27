# Інструкція встановлення

[Англійська версія](INSTALL.md)

OneAIWorkers — це невеликий Cloudflare Worker, який дає AI-помічнику безпечні дії через MCP.

Йому не потрібна база даних, черги або розклад Cloudflare. AI-помічник сам памʼятає дані й вирішує, що робити.

## Варіант A: кнопка розгортання

Це найпростіший спосіб.

1. Відкрийте README репозиторію.
2. Натисніть **Розгорнути в Cloudflare**.
3. Увійдіть у Cloudflare.
4. Дочекайтесь розгортання Worker.
5. Скопіюйте `/mcp` посилання.
6. Додайте його в ChatGPT або інший MCP-клієнт.

Детальніше: [`DEPLOY_TO_CLOUDFLARE.uk.md`](DEPLOY_TO_CLOUDFLARE.uk.md).

## Варіант B: ручне встановлення

### 1. Що потрібно

Вам потрібно:

- обліковий запис Cloudflare;
- Node.js 20 або новіший;
- вхід у Wrangler;
- ChatGPT з підтримкою підключень або інший MCP-клієнт.

### 2. Встановити пакети

```bash
npm install
```

### 3. Увійти в Cloudflare

```bash
npx wrangler login
```

### 4. Додати приватний доступ

Цей крок не обовʼязковий, але рекомендований.

```bash
npx wrangler secret put MCP_SHARED_SECRET
```

Потім підключайтесь до:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

Для публічного застосунку краще використовувати OAuth або Cloudflare Access.

### 5. Додати секрети для повідомлень

Додавайте тільки те, що вам потрібно.

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

#### Звичайний webhook

```bash
npx wrangler secret put DEFAULT_WEBHOOK_URL
```

Webhook корисний для Make, Zapier, n8n, Discord, Slack або вашої системи.

### 6. Створення дочірніх Worker

Це не обовʼязково.

Використовуйте це тільки якщо хочете, щоб інструмент `create_child_worker_from_template` створював невеликі дочірні Workers.

```bash
npx wrangler secret put CF_API_TOKEN
```

Задайте це у `wrangler.toml` або в панелі Cloudflare:

```toml
CF_ACCOUNT_ID = "your-cloudflare-account-id"
CF_WORKERS_DEV_SUBDOMAIN = "your-workers-dev-subdomain"
```

Використовуйте обмежений Cloudflare API token. Не використовуйте глобальний API key.

### 7. Локальна розробка

```bash
npm run dev
```

Локальне MCP-посилання:

```text
http://localhost:8787/mcp
```

Можна перевіряти через MCP Inspector:

```bash
npm run inspect
```

### 8. Розгорнути

```bash
npm run deploy
```

Ваше MCP-посилання виглядатиме так:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

## Підключити до ChatGPT

1. Відкрийте налаштування ChatGPT.
2. Відкрийте Apps and Connectors.
3. Увімкніть режим розробника, якщо потрібно.
4. Створіть підключення.
5. Вкажіть `/mcp` посилання вашого Worker.
6. Оновіть опис інструментів після розгортання.

Якщо ви додали `MCP_SHARED_SECRET`, додайте `?key=YOUR_SECRET` до посилання, якщо ваш клієнт не підтримує Bearer tokens.

## Перший запит

```text
Використай OneAIWorkers. Покажи, які інструменти доступні, і запропонуй три корисні автоматизації, які можна запускати за розкладом.
```
