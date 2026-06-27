# MCP tools

[Ukrainian version](TOOLS.uk.md)

OneAIWorkers gives an AI assistant a small set of tools.

The AI assistant remembers, compares, and decides. The Worker only performs the action.

## `hub_info`

Shows what OneAIWorkers can do and which optional services are configured.

## Reading and checking

### `fetch_url`

Reads one public HTTPS page and returns text.

Use it to:

- watch a page for changes;
- check competitor prices;
- read public documentation;
- inspect a public JSON or text endpoint.

### `fetch_many_urls`

Reads up to 10 public HTTPS pages in one call.

Use it for several pages or competitors.

### `fetch_rss`

Reads an RSS or Atom feed and returns recent items.

Use it for news, blogs, changelogs, or research.

### `check_url_status`

Checks if a public URL works and how long it takes to respond.

Use it for website or API health checks.

## Actions

### `send_notification`

Sends a message to Telegram, Discord, Slack, or a webhook.

### `call_webhook`

Calls an HTTPS webhook with JSON data.

Use it to trigger Make, Zapier, n8n, or your own system.

## Worker creation

### `create_child_worker_from_template`

Creates a child Cloudflare Worker from a safe template.

Current template:

- `webhook-forwarder`: forwards POST, PUT, and PATCH requests to a configured HTTPS endpoint.

This is optional. It needs Cloudflare API credentials. It does not run arbitrary code.

## Common workflow

```text
Scheduled AI run
  -> read or check data with OneAIWorkers
  -> compare with AI memory
  -> decide what matters
  -> send a message or call a webhook
  -> remember the result
```
