# Інструкція встановлення

[Англійська версія](INSTALL.md)

OneAIWorkers — це невеликий Cloudflare Worker, який дає AI-помічнику безпечні дії через MCP.

Йому не потрібна база даних для памʼяті ШІ. Помічник сам памʼятає дані й вирішує, що робити. OneAIWorkers використовує D1 для OAuth, налаштувань плагінів, прав, пошуку, великих результатів і записів аудиту.

## Варіант A: простий встановлювач без GitHub

Це найпростіший спосіб.

1. Відкрийте [сторінку встановлення OneAIWorkers](https://workers.bgdn.dev/?lang=uk).
2. Натисніть **Увійти через Cloudflare**.
3. Виберіть обліковий запис Cloudflare.
4. Натисніть **Встановити**.
5. Збережіть показані адресу `/mcp` і спільний секрет.
6. Додайте адресу в ChatGPT або інший MCP-клієнт.

Користувачу не потрібні GitHub, Node.js або Wrangler.

## Варіант B: кнопка Cloudflare для розробників

Стара кнопка розгортання все ще доступна, але Cloudflare підключає GitHub або GitLab. Детальніше: [`DEPLOY_TO_CLOUDFLARE.uk.md`](DEPLOY_TO_CLOUDFLARE.uk.md).

## Варіант C: ручне встановлення

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

Потім підключайтесь через OAuth за адресою:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

Для ручного клієнта, який підтримує токен у заголовку, передавайте спільний секрет через `Authorization: Bearer`. Ніколи не додавайте його до адреси.

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

### 6. Ручне створення Worker плагіна

Це не обовʼязково.

Використовуйте це лише тоді, коли розробник свідомо вмикає старий прямий режим і створює малий Worker із перевіреного шаблону. Звичайні плагіни з каталогу не потребують постійного ключа Cloudflare API.

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
2. Відкрийте розділ застосунків.
3. Увімкніть режим розробника, якщо потрібно.
4. Створіть підключення.
5. Вкажіть `/mcp` посилання вашого Worker.
6. Підключіться через OAuth і введіть секрет доступу OneAIWorkers.

Якщо ви додали `MCP_SHARED_SECRET`, використовуйте OAuth або передавайте секрет через заголовок `Authorization: Bearer`. Секрети в адресі не приймаються.

## Перший запит

```text
Використай OneAIWorkers. Покажи, які інструменти доступні, і запропонуй три корисні автоматизації, які можна запускати за розкладом.
```
