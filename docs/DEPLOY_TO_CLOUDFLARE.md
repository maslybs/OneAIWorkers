# Deploy to Cloudflare

[Ukrainian version](DEPLOY_TO_CLOUDFLARE.uk.md)

The easiest way to install OneAIWorkers is the **Deploy to Cloudflare** button in the README.

It works with this public GitHub repository:

```text
https://github.com/maslybs/OneAIWorkers
```

## What the button does

When a user clicks the button, Cloudflare can:

1. copy the project;
2. set up a Worker build;
3. create the required D1 database for OAuth;
4. deploy the Worker to the user's Cloudflare account.

## Button code

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers)
```

## User steps

1. Click **Deploy to Cloudflare**.
2. Sign in to Cloudflare.
3. Allow Cloudflare to use GitHub or GitLab if asked.
4. Wait until the Worker is deployed.
5. Open the Worker URL.
6. Copy the MCP URL.

The MCP URL looks like this:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

## Private access

The Worker supports OAuth for ChatGPT. OAuth clients and tokens are stored in D1, which Cloudflare creates during deployment.

The Worker can run without secrets. That is fine for a first test, but anyone who can complete the OAuth flow could connect.

For personal use, add `MCP_SHARED_SECRET` in Cloudflare. During OAuth connection, OneAIWorkers will ask for this secret once:

1. Open the deployed Worker.
2. Open **Settings**.
3. Open **Variables and Secrets**.
4. Add a secret named `MCP_SHARED_SECRET`.
5. Redeploy if Cloudflare asks.

Then connect to:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

## Optional notifications

Notifications work only after you add the needed secrets.

### Telegram

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

### Discord

```text
DISCORD_WEBHOOK_URL
```

### Slack

```text
SLACK_WEBHOOK_URL
```

### Generic webhook

```text
DEFAULT_WEBHOOK_URL
```

You can leave these fields empty during deployment. They are not needed for the first test.

To add them later:

1. Open Cloudflare dashboard.
2. Go to **Workers & Pages**.
3. Open your OneAIWorkers Worker.
4. Open **Settings**.
5. Open **Variables and Secrets**.
6. Add the missing value as a **Secret**.
7. Redeploy if Cloudflare asks.

## What the button does not do

The button only deploys the Worker.

It does not automatically connect ChatGPT, Telegram, Slack, Discord, or your CRM.

After deployment, the user still needs to:

- copy the `/mcp` URL into an MCP client;
- add optional secrets for private access or notifications;
- add CRM or API settings when those integrations exist.
