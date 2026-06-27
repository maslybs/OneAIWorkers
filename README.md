# OneAIWorkers

[Українська версія](README.uk.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers)

OneAIWorkers gives your AI assistant safe hands.

Your AI assistant can read, think, remember, plan, and decide. OneAIWorkers gives it a safe way to do real actions: check a website, read an RSS feed, send a Telegram message, call a webhook, connect to an API, or create a separate Worker for a special task.

You connect one MCP URL to ChatGPT or another MCP client. Behind that one URL, OneAIWorkers can expose many tools and connectors.

```text
AI assistant → OneAIWorkers MCP → your tools, APIs, webhooks, and child Workers
```

## When this is useful

OneAIWorkers is useful when you want your AI assistant to do small real-world tasks without giving it direct access to everything.

Examples:

```text
Check my website every morning and tell me in Telegram if it is down.
```

```text
Read this RSS feed and send me only important updates.
```

```text
When I ask, create a lead in my CRM using its API.
```

```text
Send a webhook to Make, Zapier, or n8n when a customer fills a form.
```

```text
Build a small custom Worker that parses a page and exposes it as a tool.
```

```text
Create a simple bot or API bridge as a separate child Worker.
```

The goal is not to replace your AI assistant. The goal is to give it a safe action layer.

## How it works

OneAIWorkers has two modes.

### 1. Basic mode

This is the default mode. It works after one-click deploy.

The main Worker stores connector settings in D1 and executes API calls itself.

Use this for:

```text
REST APIs
CRMs
billing systems
webhooks
Telegram, Discord, Slack messages
simple internal tools
Make, Zapier, n8n
```

The AI does not need to know your real API keys. It only knows the name of the secret.

Example:

```text
Secret name: CRM_API_TOKEN
Real value: hidden inside Cloudflare Secrets
```

The connector can then say:

```json
{
  "auth": {
    "type": "bearer_secret",
    "secret_name": "CRM_API_TOKEN"
  }
}
```

OneAIWorkers reads the real secret only when it makes the API call.

### 2. Advanced mode: Worker Builder

This mode is for special cases.

The main Worker can create a separate child Worker through the Cloudflare API. This is useful when a connector needs its own code, its own public endpoint, a bot-like flow, a parser, or special logic.

Use this for:

```text
custom bots
custom parsers
special webhook receivers
API bridges with complex logic
separate tools that should be isolated from the main Worker
```

This mode needs:

```text
CF_ACCOUNT_ID
CF_API_TOKEN
CF_WORKERS_DEV_SUBDOMAIN optional
```

These are not needed for the first setup. Add them only when you want OneAIWorkers to create extra Workers.

Custom code should be reviewed before deploy. OneAIWorkers blocks some dangerous JavaScript patterns, but this is not a full security audit. Treat Worker Builder as an advanced feature.

## What is created during install

The deploy button installs the main Worker.

Cloudflare can also create the D1 database from `wrangler.toml`.

The D1 database is used for:

```text
OAuth clients
OAuth tokens
connector registry
connector actions
audit records
```

It is not used as AI memory. Your AI assistant keeps the memory and schedule. OneAIWorkers stores only the settings it needs to work.

## Quick start

### Step 1. Deploy

Click the button:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers)

Cloudflare will ask you to connect your account and deploy the Worker.

The first deploy is intentionally minimal, but it still asks for one required secret: `MCP_SHARED_SECRET`. This protects OAuth connection and manual MCP access.

Generate a long random value and save it during deploy.

After deploy, use `connector_setup_status` to see the real state of D1, saved connectors, configured secrets, and missing secrets. It reports secret names only; values stay hidden.

After deploy, add only the extra secrets you need in Cloudflare:

```text
Cloudflare dashboard
→ Workers & Pages
→ your OneAIWorkers Worker
→ Settings
→ Variables and Secrets
→ Add Secret
```

Optional secrets you can add later:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
DISCORD_WEBHOOK_URL
SLACK_WEBHOOK_URL
DEFAULT_WEBHOOK_URL
CF_ACCOUNT_ID
CF_API_TOKEN
CF_WORKERS_DEV_SUBDOMAIN
PUBLIC_BASE_URL
```

### Step 2. Add a shared secret

This is recommended.

`MCP_SHARED_SECRET` is a private password. OneAIWorkers asks for it during OAuth connection. It can also be used for manual access with `?key=`.

Use a long random value.

You can add it during deploy or later in Cloudflare:

```text
Cloudflare dashboard
→ Workers & Pages
→ your OneAIWorkers Worker
→ Settings
→ Variables and Secrets
→ Add Secret
```

### Step 3. Connect ChatGPT

In ChatGPT Developer Mode, add a custom MCP app.

Use:

```text
Authentication: OAuth
Server URL: https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

Do not add `?key=` when you use OAuth.

When ChatGPT opens the connection page, enter your `MCP_SHARED_SECRET` if you set one.

### Step 4. Ask for status

After connection, ask:

```text
Show OneAIWorkers status.
```

The AI should call `hub_info` and show what is configured.

## Built-in tools

OneAIWorkers includes these tools:

```text
hub_info
fetch_url
fetch_many_urls
fetch_rss
check_url_status
send_notification
call_webhook
save_connector
list_connectors
test_connector
call_connector_tool
delete_connector
create_child_worker_from_template
deploy_custom_child_worker
```

## Basic connector example

Imagine you have a CRM API.

The CRM docs say:

```text
POST https://api.example-crm.com/v1/leads
Authorization: Bearer YOUR_API_TOKEN
Body: { "name": "...", "email": "..." }
```

First, add your real API token to Cloudflare Secrets:

```text
CRM_API_TOKEN = real token from your CRM
```

Then tell your AI assistant:

```text
Create a OneAIWorkers connector called crm.
It should have one action: create_lead.
Use POST https://api.example-crm.com/v1/leads.
Use bearer_secret with secret_name CRM_API_TOKEN.
Body fields: name and email.
```

The AI can create this connector through `save_connector`.

### Supported connector authentication

Connector manifests support these auth types:

```text
none
bearer_secret
auth_header_secret
api_key_header_secret
api_key_query_secret
basic_secret
basic_secret_pair
oauth2_client_credentials
oauth2_refresh_token
google_oauth2_refresh_token
```

Use `basic_secret_pair` when both username/login and password/key must stay in Cloudflare Secrets. This is useful for APIs such as DataForSEO:

```json
{
  "type": "basic_secret_pair",
  "username_secret_name": "DATAFORSEO_API_LOGIN",
  "password_secret_name": "DATAFORSEO_API_PASSWORD"
}
```

Use `oauth2_refresh_token` for APIs where you already have a refresh token:

```json
{
  "type": "oauth2_refresh_token",
  "token_url": "https://api.example.com/oauth/token",
  "client_id_secret_name": "EXAMPLE_CLIENT_ID",
  "client_secret_secret_name": "EXAMPLE_CLIENT_SECRET",
  "refresh_token_secret_name": "EXAMPLE_REFRESH_TOKEN"
}
```

Use `google_oauth2_refresh_token` for Google APIs after you create OAuth credentials and store the refresh token in Cloudflare Secrets:

```json
{
  "type": "google_oauth2_refresh_token",
  "client_id_secret_name": "GOOGLE_CLIENT_ID",
  "client_secret_secret_name": "GOOGLE_CLIENT_SECRET",
  "refresh_token_secret_name": "GOOGLE_REFRESH_TOKEN"
}
```

This version does not yet include a built-in Google connection page. For now, Google OAuth values are added as Cloudflare Secrets. A later version can add a `/connect/google` page and store encrypted tokens in D1.

After that you can say:

```text
Create a CRM lead for Anna Smith, anna@example.com.
```

The AI calls:

```text
call_connector_tool
connector_id: crm
action_name: create_lead
input: { name: "Anna Smith", email: "anna@example.com" }
```

OneAIWorkers sends the request to the CRM. The real API token stays hidden in Cloudflare Secrets.

## Advanced child Worker example

Use child Workers only when a simple API connector is not enough.

Example tasks:

```text
Make a small parser that reads a page and returns clean product data.
```

```text
Make a webhook receiver that verifies a signature and then calls another API.
```

```text
Make a small bot endpoint with custom logic.
```

To enable this mode, add these secrets/settings to the main Worker:

```text
CF_ACCOUNT_ID
CF_API_TOKEN
CF_WORKERS_DEV_SUBDOMAIN optional
```

Then ask the AI:

```text
Create a child Worker for this parser.
Show me the code and explain what it does before deploying.
```

After review, the AI can call `deploy_custom_child_worker`.

The child Worker exposes:

```text
/health
/tools/list
/tools/call
```

Then save it as a connector using `save_connector` with:

```text
mode: child_worker
child_worker_url: https://child-worker.your-subdomain.workers.dev
child_worker_token_secret: CHILD_WORKER_TOKEN
```

The child token is shown once after deploy. Store it as a Cloudflare Secret, for example:

```text
CHILD_WORKER_TOKEN
```

Then the main Worker can route tool calls to that child Worker.

## Notifications

Telegram needs:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

Discord needs:

```text
DISCORD_WEBHOOK_URL
```

Slack needs:

```text
SLACK_WEBHOOK_URL
```

Generic webhook needs:

```text
DEFAULT_WEBHOOK_URL
```

You can add these during deploy or later in Cloudflare settings.

## Security model

OneAIWorkers follows a few simple rules:

```text
Secrets stay in Cloudflare Secrets.
The AI sees secret names, not secret values.
Only HTTPS URLs are allowed.
Local/private network URLs are blocked.
Connector actions are stored in D1.
OAuth tokens are stored in D1.
Child Workers are optional.
Custom child Worker code should be reviewed before deploy.
```

For simple API access, use basic connectors.

For unusual logic, use child Workers.

## Local development

```bash
npm install
npm run dev
```

For local secrets, copy:

```bash
cp .dev.vars.example .dev.vars
```

Then fill only the values you need.

Run type check:

```bash
npm run typecheck
```

Deploy manually:

```bash
npm run deploy
```

## Recommended first setup

Start with this:

```text
MCP_SHARED_SECRET
```

Then connect ChatGPT with OAuth.

Add integrations only when you need them:

```text
Telegram messages → TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
Discord messages → DISCORD_WEBHOOK_URL
Slack messages → SLACK_WEBHOOK_URL
Make/Zapier/n8n → DEFAULT_WEBHOOK_URL or a saved connector
Custom API → add API secret, then create a connector
Custom code → enable Worker Builder
```

## License

MIT
