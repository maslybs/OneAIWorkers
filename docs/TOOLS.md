# MCP tools

[Ukrainian version](TOOLS.uk.md)

OneAIWorkers gives an AI assistant a small set of tools.

The AI assistant remembers, compares, and decides. The Worker only performs the action.

## `hub_info`

Shows what OneAIWorkers can do and which optional services are configured.

## Marketplace connectors

### `connector_installation_help`

Use this when the user asks how to install a connector but has not named a service or required capability yet. It returns the real flow and prevents invented Marketplace sections or unverified connector claims.

### `find_capability`

Finds a cloud connector for a named service or user task. It downloads the public catalog and ranks it inside the user's Worker, so the task text is not sent to the marketplace. A match includes the exact browser installation link. Only returned matches may be described as available.

### `list_connector_updates`

Checks installed marketplace connectors and returns a browser update link when a newer package is available.

### `get_connector_settings_link`

Creates a short-lived, one-time browser link for adding or changing a connector's credentials. Never ask the user to send an API key in chat.

### `list_connectors` and `call_connector_tool`

These are the permanent live discovery and invocation tools. They read the current D1 registry on every call.

- Use `connector_id: system` for installation, settings, updates, saving, testing, and deletion.
- Use `connector_id: native` for current Workers AI and agent actions.
- Saved connectors use their own `connector_id`.

Known system actions also work through `native` for older clients. Refreshing the client is optional and only adds shortcut tools.

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
