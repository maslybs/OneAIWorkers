# Install guide

[Ukrainian version](INSTALL.uk.md)

OneAIWorkers is a small Cloudflare Worker that gives an AI assistant safe actions through MCP.

It does not need a database, queues, or Cloudflare cron. The AI assistant keeps memory and decides what to do.

## Option A: Deploy button

This is the easiest way.

1. Open the repository README.
2. Click **Deploy to Cloudflare**.
3. Sign in to Cloudflare.
4. Wait until the Worker is deployed.
5. Copy the `/mcp` URL.
6. Add it to ChatGPT or another MCP client.

More details: [`DEPLOY_TO_CLOUDFLARE.md`](DEPLOY_TO_CLOUDFLARE.md).

## Option B: Manual install

### 1. Requirements

You need:

- a Cloudflare account;
- Node.js 20 or newer;
- Wrangler login;
- ChatGPT with connector support, or another MCP client.

### 2. Install packages

```bash
npm install
```

### 3. Login to Cloudflare

```bash
npx wrangler login
```

### 4. Add private access

This step is optional, but recommended.

```bash
npx wrangler secret put MCP_SHARED_SECRET
```

Then connect to:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

For a public app, use OAuth or Cloudflare Access instead.

### 5. Add notification secrets

Add only what you need.

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

Generic webhooks are useful for Make, Zapier, n8n, Discord, Slack, or your own system.

### 6. Child Worker creation

This is optional.

Use it only if you want the tool `create_child_worker_from_template` to create small child Workers.

```bash
npx wrangler secret put CF_API_TOKEN
```

Set these in `wrangler.toml` or in the Cloudflare dashboard:

```toml
CF_ACCOUNT_ID = "your-cloudflare-account-id"
CF_WORKERS_DEV_SUBDOMAIN = "your-workers-dev-subdomain"
```

Use a scoped Cloudflare API token. Do not use your global API key.

### 7. Local development

```bash
npm run dev
```

Local MCP URL:

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

Your MCP URL will look like this:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

## Connect to ChatGPT

1. Open ChatGPT settings.
2. Open Apps and Connectors.
3. Turn on developer mode if needed.
4. Create a connector.
5. Use your Worker `/mcp` URL.
6. Refresh tool metadata after deployments.

If you added `MCP_SHARED_SECRET`, add `?key=YOUR_SECRET` to the URL unless your client supports Bearer tokens.

## First prompt

```text
Use OneAIWorkers. Show me what tools are available and suggest three useful automations I can run on a schedule.
```
