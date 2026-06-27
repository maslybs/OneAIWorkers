# OneAIWorkers

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers)

[Ukrainian version](README.uk.md)

OneAIWorkers is a small Cloudflare Worker that gives an AI assistant a few safe actions it can use through MCP.

```text
AI assistant = remembers, plans, decides
Worker = does the safe actions
```

The code is TypeScript and is split into small files, so it is easier to read and maintain.

## Easiest install

Click **Deploy to Cloudflare** at the top of this page.

Cloudflare will copy this public repository, set up the Worker, and deploy it to your Cloudflare account.

After deployment, connect this MCP URL to ChatGPT or another MCP client:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

Full guide: [`docs/DEPLOY_TO_CLOUDFLARE.md`](docs/DEPLOY_TO_CLOUDFLARE.md).

## Manual install

```bash
npm install
npx wrangler login
npm run deploy
```

## Private access

For ChatGPT, use **OAuth** in the app settings. OneAIWorkers stores OAuth clients and tokens in a small D1 database that Cloudflare creates during deploy.

For extra protection, add a shared secret. During OAuth connection, the user will enter this secret once:

```bash
npx wrangler secret put MCP_SHARED_SECRET
npm run deploy
```

For manual shared-secret access, connect with:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

## What it can do

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

In simple words, it can:

- read public web pages;
- read RSS feeds;
- check if a website is working;
- send a message to Telegram, Discord, Slack, or a webhook;
- call a webhook in Make, Zapier, n8n, or your own system;
- create a small child Worker from a safe template.

## Main files

```text
src/index.ts              Worker entrypoint and HTTP routes
src/server.ts             MCP tool registration
src/tools/observe.ts      page reading, RSS, status checks
src/tools/notify.ts       notifications and webhooks
src/tools/factory.ts      safe child Worker creation
src/auth.ts               shared-secret access
src/security.ts           URL and key safety helpers
src/i18n.ts               runtime text helpers
docs/                     user and developer guides
```

## What it does not do

- It does not store memory for the AI assistant.
- It does not use a database for AI memory. D1 is used only for OAuth clients and tokens.
- It does not run arbitrary code created by AI.
- It does not include full user accounts, billing, or OAuth.

## Development

```bash
npm run dev
npm run typecheck
npm run deploy
```

## License

MIT
