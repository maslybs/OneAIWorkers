# OneAIWorkers

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers)

[Ukrainian version](README.uk.md)

OneAIWorkers is a small Cloudflare Worker that exposes a remote MCP server for LLM-triggered automations.

```text
LLM = memory + schedule + reasoning
Worker = safe action executor
```

The project uses a maintainable TypeScript structure. The main Worker entrypoint is `src/index.ts`, and tools are split into focused modules.

## Easiest install

Click **Deploy to Cloudflare** at the top of this README. Cloudflare will import the public repository, configure Workers Builds, and deploy the Worker to your Cloudflare account.

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

## Recommended private setup

For private use, set a shared secret:

```bash
npx wrangler secret put MCP_SHARED_SECRET
npm run deploy
```

Then connect with:

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

## Files

```text
src/index.ts              Worker entrypoint and HTTP routes
src/server.ts             MCP tool registration
src/tools/observe.ts      fetch_url, fetch_rss, check_url_status
src/tools/notify.ts       notifications and generic webhooks
src/tools/factory.ts      safe child Worker factory
src/auth.ts               MCP shared-secret auth
src/security.ts           URL and key safety helpers
src/i18n.ts               bilingual runtime text helpers
docs/INSTALL.md           full install guide
docs/DEPLOY_TO_CLOUDFLARE.md Deploy button guide
docs/NON_TECHNICAL_USERS.md plain-language usage guide
docs/PROMPTS.md           ready-to-use prompts
docs/SECURITY.md          security notes
docs/TOOLS.md             tool reference
```

## What it does not do

- It does not store memory for the LLM.
- It does not include KV, D1, queues, or workflow storage.
- It does not accept arbitrary AI-generated JavaScript for deployment.
- It does not provide OAuth or multi-user SaaS security out of the box.

## Development

```bash
npm run dev
npm run typecheck
npm run deploy
```

## License

MIT
