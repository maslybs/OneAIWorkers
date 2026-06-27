# Deploy to Cloudflare

[Ukrainian version](DEPLOY_TO_CLOUDFLARE.uk.md)

The easiest way for non-technical users to install OneAIWorkers is the **Deploy to Cloudflare** button in the README.

Cloudflare's Deploy button works with a public GitHub or GitLab repository. It imports the project, configures Workers Builds, and deploys the Worker to the user's own Cloudflare account.

## Deploy button

The public repository is:

```text
https://github.com/maslybs/OneAIWorkers
```

The README button uses this URL:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers)
```

## User flow

1. Click **Deploy to Cloudflare**.
2. Sign in to Cloudflare.
3. Authorize GitHub or GitLab if Cloudflare asks.
4. Let Cloudflare create or import the project.
5. Wait for the Worker build and deploy.
6. Open the deployed Worker URL.
7. Copy the MCP endpoint.

The MCP endpoint is:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

## Optional private access

By default, the Worker can be deployed without secrets. That is useful for a first test, but for personal or private usage users should set `MCP_SHARED_SECRET`.

In Cloudflare dashboard:

1. Open the deployed Worker.
2. Go to **Settings**.
3. Open **Variables and Secrets**.
4. Add a secret named `MCP_SHARED_SECRET`.
5. Redeploy if Cloudflare asks.

Then connect to:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

## Optional notifications

Notification tools work only after the user configures the relevant secrets.

### Telegram

Required secrets:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

### Discord

Required secret:

```text
DISCORD_WEBHOOK_URL
```

### Slack

Required secret:

```text
SLACK_WEBHOOK_URL
```

### Generic webhook

Required secret:

```text
DEFAULT_WEBHOOK_URL
```

These secrets are optional. Users can also pass an explicit `webhook_url` to `send_notification` or use `call_webhook` directly when their MCP client allows it.

## What this button does not solve yet

The button deploys the Worker. It does not automatically connect ChatGPT, Telegram, Slack, Discord, or a CRM account.

After deploy, users still need to:

- copy the `/mcp` URL into their MCP client;
- add optional secrets if they want private access or notifications;
- configure CRM/API integrations when those are added.
