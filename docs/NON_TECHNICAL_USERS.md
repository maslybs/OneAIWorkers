# For non-technical users

[Ukrainian version](NON_TECHNICAL_USERS.uk.md)

OneAIWorkers is not a separate app with a dashboard. It is a small Cloudflare Worker that gives your LLM a safe set of actions.

The LLM keeps memory and runs on a schedule. The Worker only performs actions when the LLM calls it.

## What users can do with it

- Ask the LLM to check websites on a schedule.
- Ask the LLM to monitor competitor pages.
- Ask the LLM to collect RSS/news updates.
- Ask the LLM to call a Make/Zapier/n8n webhook.
- Ask the LLM to send Telegram/Discord/Slack notifications.

## What users need

Minimum:

1. A Cloudflare account.
2. This Worker deployed to Cloudflare.
3. The public `/mcp` URL connected to ChatGPT or another MCP client.

Optional:

- `MCP_SHARED_SECRET` for private access.
- Telegram/Discord/Slack/webhook secrets for notifications.
- Cloudflare API token only if they want child Worker creation.

## Simple installation flow

1. Click **Deploy to Cloudflare** in the README, or download the project ZIP.
2. Deploy the Worker to your Cloudflare account.
3. Copy the deployed `/mcp` URL.
4. Add that URL as a connector in ChatGPT or another MCP client.
5. Add optional secrets if you want private access or notifications.

## First prompt

```text
Use OneAIWorkers. Show me what tools you have and suggest three simple automations I can run on a schedule.
```
