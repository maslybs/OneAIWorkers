# OneAIWorkers

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers)

[Англійська версія](README.md)

OneAIWorkers — це невеликий Cloudflare Worker, який надає remote MCP server для LLM-автоматизацій.

```text
LLM = памʼять + розклад + reasoning
Worker = безпечний executor дій
```

Проєкт використовує підтримувану TypeScript-структуру. Основний entrypoint Worker — `src/index.ts`, а tools розділені на окремі модулі.

## Найпростіше встановлення

Натисніть **Deploy to Cloudflare** на початку README. Cloudflare імпортує публічний репозиторій, налаштує Workers Builds і задеплоїть Worker у ваш Cloudflare account.

Після деплою підключіть цей MCP URL до ChatGPT або іншого MCP-клієнта:

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

## Рекомендований приватний setup

Для приватного використання задайте shared secret:

```bash
npx wrangler secret put MCP_SHARED_SECRET
npm run deploy
```

Потім підключайтесь через:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

## MCP tools

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

## Файли

```text
src/index.ts              entrypoint Worker і HTTP routes
src/server.ts             реєстрація MCP tools
src/tools/observe.ts      fetch_url, fetch_rss, check_url_status
src/tools/notify.ts       notifications і generic webhooks
src/tools/factory.ts      безпечна factory дочірніх Workers
src/auth.ts               auth через MCP shared secret
src/security.ts           helpers для безпеки URL і ключів
src/i18n.ts               helpers для runtime-текстів двома мовами
docs/INSTALL.uk.md        повна інструкція встановлення
docs/DEPLOY_TO_CLOUDFLARE.uk.md гайд по Deploy button
docs/NON_TECHNICAL_USERS.uk.md простий гайд для нетехнічних користувачів
docs/PROMPTS.uk.md        готові prompts
docs/SECURITY.uk.md       нотатки з безпеки
docs/TOOLS.uk.md          довідник tools
```

## Чого він не робить

- Він не зберігає памʼять для LLM.
- Він не містить KV, D1, queues або workflow storage.
- Він не приймає довільний AI-generated JavaScript для деплою.
- Він не надає OAuth або multi-user SaaS security з коробки.

## Розробка

```bash
npm run dev
npm run typecheck
npm run deploy
```

## Ліцензія

MIT
