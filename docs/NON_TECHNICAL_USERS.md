# For non-technical users

[Ukrainian version](NON_TECHNICAL_USERS.uk.md)

OneAIWorkers is a small Cloudflare Worker. It gives your AI assistant safe actions.

It is not a separate app with a dashboard.

The AI assistant remembers things, checks them again later, and decides what matters. The Worker only does the actions.

## What you can do

You can ask your AI assistant to:

- check if your website is working;
- watch competitor pages;
- read RSS feeds;
- call a Make, Zapier, or n8n webhook;
- send you messages in Telegram, Discord, or Slack.

## What you need

Minimum:

1. A Cloudflare account.
2. OneAIWorkers deployed to Cloudflare.
3. The `/mcp` URL connected to ChatGPT or another MCP client.

Optional:

- `MCP_SHARED_SECRET` for private access;
- Telegram, Discord, Slack, or webhook secrets for messages;
- Cloudflare API token only if you want child Worker creation.

## Simple setup

1. Open the OneAIWorkers installer page.
2. Sign in to Cloudflare.
3. Select an account and click **Install**.
4. Save the `/mcp` URL and shared secret.
5. Add the URL to ChatGPT or another MCP client.

GitHub, Node.js, and manual D1 creation are not required. Extra secrets are needed only for notifications or other external services.

## First prompt

```text
Use OneAIWorkers. Show me what tools you have and suggest three simple automations I can run on a schedule.
```
