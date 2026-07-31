# MCP tools

[Ukrainian version](TOOLS.uk.md)

OneAIWorkers gives an AI assistant a small set of tools.

The AI assistant remembers, compares, and decides. The Worker only performs the action.

## `hub_info`

Shows what OneAIWorkers can do and which optional services are configured.

## Marketplace connectors

### `find_capability`

Finds a cloud connector for the user's task. It downloads the public catalog and ranks it inside the user's Worker, so the task text is not sent to the marketplace. A match includes a browser installation link.

### `list_connector_updates`

Checks installed marketplace connectors and returns a browser update link when a newer package is available.

### `get_connector_settings_link`

Creates a short-lived, one-time browser link for adding or changing a connector's credentials. Never ask the user to send an API key in chat.

### `list_connectors` and `call_connector_tool`

These are the stable discovery and invocation tools. They see newly installed connectors even when an MCP client has cached an older top-level tool list.

### `save_connector`

Developer option for direct HTTP APIs. It stores the manifest in D1 and references Cloudflare Secrets by name. Ready marketplace packages do not require this manual step.

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

This is an older developer option. Marketplace child Workers use the browser installer and do not need permanent Cloudflare API credentials.

## Common workflow

```text
Scheduled AI run
  -> read or check data with OneAIWorkers
  -> compare with AI memory
  -> decide what matters
  -> send a message or call a webhook
  -> remember the result
```
