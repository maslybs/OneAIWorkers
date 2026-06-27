# OneAIWorkers

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers)

## English

A small Cloudflare Worker that exposes a remote MCP server for LLM-triggered automations.

The model is intentionally simple:

```text
LLM = memory + schedule + reasoning
Worker = safe action executor
```

This repository uses a maintainable TypeScript structure. The main Worker entrypoint is `src/index.ts`; tools are split into focused modules. The project is meant to be installable by technical users while still giving non-technical users a clear setup path through the Deploy to Cloudflare button or copy/paste commands.

## Українською

Невеликий Cloudflare Worker, який надає remote MCP server для LLM-автоматизацій.

Модель спеціально проста:

```text
LLM = памʼять + розклад + reasoning
Worker = безпечний executor дій
```

Репозиторій використовує підтримувану TypeScript-структуру. Основний entrypoint — `src/index.ts`; tools розділені на окремі модулі. Проєкт має бути зручним для технічних користувачів і водночас мати зрозумілий setup для нетехнічних через Deploy to Cloudflare button або copy/paste команди.

---

## Easiest install / Найпростіше встановлення

Click **Deploy to Cloudflare** at the top of this README. Cloudflare will clone the public repo into the user's GitHub/GitLab account, configure Workers Builds, and deploy the Worker to the user's Cloudflare account.

Натисніть **Deploy to Cloudflare** на початку README. Cloudflare склонує public repo в GitHub/GitLab акаунт користувача, налаштує Workers Builds і задеплоїть Worker у Cloudflare account користувача.

After deployment, connect this MCP URL to ChatGPT or another MCP client:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

Після деплою підключіть цей MCP URL до ChatGPT або іншого MCP-клієнта:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

Full guide: [`docs/DEPLOY_TO_CLOUDFLARE.md`](docs/DEPLOY_TO_CLOUDFLARE.md).

## Manual install / Ручне встановлення

```bash
npm install
npx wrangler login
npm run deploy
```

## Recommended private setup / Рекомендований приватний setup

For private use, set a shared secret:

```bash
npx wrangler secret put MCP_SHARED_SECRET
npm run deploy
```

Для приватного використання задайте shared secret:

```bash
npx wrangler secret put MCP_SHARED_SECRET
npm run deploy
```

Then connect with:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

Потім підключайтесь через:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

## MCP tools / MCP tools

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

## Files / Файли

```text
src/index.ts              Worker entrypoint and HTTP routes / entrypoint Worker і HTTP routes
src/server.ts             MCP tool registration / реєстрація MCP tools
src/tools/observe.ts      fetch_url, fetch_rss, check_url_status
src/tools/notify.ts       notifications and generic webhooks / notifications і generic webhooks
src/tools/factory.ts      safe child Worker factory / безпечна factory дочірніх Workers
src/auth.ts               MCP shared-secret auth / auth через shared secret
src/security.ts           URL and key safety helpers / helpers для безпеки URL і ключів
src/i18n.ts               bilingual text helpers / двомовні helpers
docs/INSTALL.md           full install guide / повна інструкція встановлення
docs/DEPLOY_TO_CLOUDFLARE.md Deploy button guide / гайд по Deploy button
docs/NON_TECHNICAL_USERS.md plain-language usage guide / простий гайд для нетехнічних користувачів
docs/PROMPTS.md           ready-to-use prompts / готові prompts для користувачів
```

## What it does not do / Чого він не робить

- It does not store memory for the LLM. / Він не зберігає памʼять для LLM.
- It does not include KV, D1, queues, or workflow storage. / Він не містить KV, D1, queues або workflow storage.
- It does not accept arbitrary AI-generated JavaScript for deployment. / Він не приймає довільний AI-generated JavaScript для деплою.
- It does not provide OAuth or multi-user SaaS security out of the box. / Він не надає OAuth або multi-user SaaS security з коробки.

## Development / Розробка

```bash
npm run dev
npm run typecheck
npm run deploy
```

## License / Ліцензія

MIT
