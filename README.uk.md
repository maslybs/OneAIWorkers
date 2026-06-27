# OneAIWorkers

[![Розгорнути в Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers)

[Англійська версія](README.md)

OneAIWorkers — це невеликий Cloudflare Worker, який дає AI-помічнику кілька безпечних дій через MCP.

```text
AI-помічник = памʼятає, планує, вирішує
Worker = виконує безпечні дії
```

Код написаний на TypeScript і розділений на невеликі файли. Так його легше читати, перевіряти й підтримувати.

## Найпростіше встановлення

Натисніть **Розгорнути в Cloudflare** на початку сторінки.

Cloudflare скопіює цей публічний репозиторій, налаштує Worker і розгорне його у вашому обліковому записі Cloudflare.

Після розгортання підключіть це MCP-посилання до ChatGPT або іншого MCP-клієнта:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

Повна інструкція: [`docs/DEPLOY_TO_CLOUDFLARE.uk.md`](docs/DEPLOY_TO_CLOUDFLARE.uk.md).

## Ручне встановлення

```bash
npm install
npx wrangler login
npm run deploy
```

## Приватний доступ

Для ChatGPT виберіть **OAuth** у налаштуваннях застосунку. OneAIWorkers зберігає OAuth-клієнти й токени в невеликій D1 базі, яку Cloudflare створює під час розгортання.

Для додаткового захисту додайте спільний секрет. Під час OAuth-підключення користувач введе цей секрет один раз:

```bash
npx wrangler secret put MCP_SHARED_SECRET
npm run deploy
```

Для ручного доступу через спільний секрет підключайтесь через:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

## Що він уміє

```text
hub_info
fetch_url
fetch_many_urls
fetch_rss
check_url_status
send_notification
call_webhook
create_child_worker_from_template
```

Простими словами, він може:

- читати публічні вебсторінки;
- читати RSS-стрічки;
- перевіряти, чи працює сайт;
- надсилати повідомлення в Telegram, Discord, Slack або у webhook;
- викликати webhook у Make, Zapier, n8n або у вашій системі;
- створювати невеликий дочірній Worker із безпечного шаблону.

## Основні файли

```text
src/index.ts              точка входу Worker і HTTP-маршрути
src/server.ts             реєстрація MCP-інструментів
src/tools/observe.ts      читання сторінок, RSS, перевірки стану
src/tools/notify.ts       повідомлення і webhook
src/tools/factory.ts      безпечне створення дочірнього Worker
src/auth.ts               доступ через спільний секрет
src/security.ts           допоміжні функції для безпеки URL і ключів
src/i18n.ts               допоміжні функції для текстів під час роботи
docs/                     інструкції для користувачів і розробників
```

## Чого він не робить

- Він не зберігає памʼять AI-помічника.
- Він не використовує базу даних для памʼяті AI. D1 потрібна тільки для OAuth-клієнтів і токенів.
- Він не виконує довільний код, створений AI.
- Він не має повної системи користувачів, оплат або OAuth.

## Розробка

```bash
npm run dev
npm run typecheck
npm run deploy
```

## Ліцензія

MIT
