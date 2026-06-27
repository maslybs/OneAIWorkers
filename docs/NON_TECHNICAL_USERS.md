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

1. Click **Deploy to Cloudflare** in the README.
2. Deploy the Worker.
3. Copy the `/mcp` URL.
4. Add the URL to ChatGPT or another MCP client.
5. Add optional secrets if you want messages or private access.

## First prompt

```text
Use OneAIWorkers. Show me what tools you have and suggest three simple automations I can run on a schedule.
```
