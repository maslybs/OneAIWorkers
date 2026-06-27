# MCP tools

[Ukrainian version](TOOLS.uk.md)

This Worker exposes a small set of MCP tools. They are designed as primitives that a scheduled LLM can combine into useful workflows.

The LLM owns memory, scheduling, and decisions. The Worker only executes controlled actions.

## Discovery

### `hub_info`

Shows what the hub can do, which optional integrations are configured, and practical first prompts.

## Observe tools

### `fetch_url`

Fetches a public HTTPS URL and returns text. HTML pages are simplified into readable text by default.

Use cases:

- watch a page for changes;
- check competitor pricing;
- read documentation or changelog pages;
- inspect a public JSON/text endpoint.

### `fetch_many_urls`

Fetches up to 10 URLs in one call.

Use cases:

- competitor watchlists;
- weekly research checks;
- monitoring several landing pages.

### `fetch_rss`

Reads RSS/Atom feeds and returns recent items.

Use cases:

- daily research digest;
- GitHub, blog, or news monitoring;
- industry updates.

### `check_url_status`

Checks status code and response time for a public URL.

Use cases:

- uptime checks;
- API health checks;
- form endpoint checks.

## Action tools

### `send_notification`

Sends a message to Telegram, Discord, Slack, or a generic webhook.

### `call_webhook`

Calls an HTTPS webhook with a JSON payload.

Use cases:

- trigger Make, Zapier, or n8n;
- notify a custom backend;
- fan out an event after LLM interpretation.

## Factory tools

### `create_child_worker_from_template`

Deploys a child Worker from a safe predefined template.

Current template:

- `webhook-forwarder`: a small Worker that forwards POST, PUT, and PATCH requests to a configured HTTPS endpoint.

This is optional and requires Cloudflare API credentials. It does not expose arbitrary code execution.

## Recommended workflow shape

```text
LLM scheduled run
  -> fetch/check data through OneAIWorkers
  -> compare with LLM memory
  -> decide what matters
  -> notify or call webhook through OneAIWorkers
  -> update LLM memory
```
