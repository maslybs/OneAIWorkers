# Install guide

[Ukrainian version](INSTALL.uk.md)

OneAIWorkers is a personal Cloudflare Worker MCP server.

It does not require KV, D1, databases, queues, or Cloudflare cron. Your LLM is expected to handle memory, scheduling, and decisions.

## Option A: Deploy to Cloudflare button

This is the easiest path for non-technical users.

1. Open the repository README.
2. Click **Deploy to Cloudflare**.
3. Sign in to Cloudflare.
4. Let Cloudflare create or import and deploy the Worker.
5. Copy your deployed `/mcp` URL.
6. Connect it to ChatGPT or another MCP client.

More details: [`DEPLOY_TO_CLOUDFLARE.md`](DEPLOY_TO_CLOUDFLARE.md).

## Option B: Manual install

### 1. Requirements

You need:

- a Cloudflare account;
- Node.js 20+;
- Wrangler login with `npx wrangler login`;
- a ChatGPT account with connector/developer mode support, or another remote MCP client.

### 2. Install dependencies

```bash
npm install
```

### 3. Login to Cloudflare

```bash
npx wrangler login
```

### 4. Optional but recommended: add a shared secret

For private personal use, set a secret:

```bash
npx wrangler secret put MCP_SHARED_SECRET
```

Then connect to:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

This is intentionally simple. For a public app, use real OAuth or Cloudflare Access.

### 5. Optional notification secrets

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

Generic webhooks are useful for Make, Zapier, n8n, Discord, Slack, or your own endpoint.

### 6. Optional child Worker factory

Only configure this if you want the MCP tool `create_child_worker_from_template` to deploy safe child Workers.

```bash
npx wrangler secret put CF_API_TOKEN
```

In `wrangler.toml` or dashboard variables:

```toml
CF_ACCOUNT_ID = "your-cloudflare-account-id"
CF_WORKERS_DEV_SUBDOMAIN = "your-workers-dev-subdomain"
```

The Cloudflare API token should have the minimum permissions needed to edit Workers in the target account. Do not use your global API key.

### 7. Local development

```bash
npm run dev
```

Local MCP endpoint:

```text
http://localhost:8787/mcp
```

You can test with MCP Inspector:

```bash
npm run inspect
```

### 8. Deploy

```bash
npm run deploy
```

After deploy, open:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/
```

Your MCP endpoint is:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

## Connect to ChatGPT

In ChatGPT developer mode:

1. Open Settings.
2. Go to Apps & Connectors.
3. Enable Developer mode if available.
4. Create a connector.
5. Use your public Worker `/mcp` URL.
6. Refresh tool metadata after deployments.

If you set `MCP_SHARED_SECRET`, add `?key=YOUR_SECRET` to the connector URL unless your client supports Bearer tokens.

## First prompt

```text
Use OneAIWorkers. Show me what tools are available and suggest three practical automations I can run on a schedule using your own LLM memory.
```
