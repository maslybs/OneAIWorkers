# Child Workers and gateway routing

OneAIWorkers is designed to expose a single MCP endpoint to ChatGPT:

```text
ChatGPT -> OneAIWorkers /mcp -> generated top-level tool -> internal connector or child Worker -> external API
```

ChatGPT should not need to call child Workers directly. After a connector is saved, its actions are exposed as first-class OneAIWorkers tools, for example:

```text
tg_getme
tg_send_message
n8n_list_workflows
crm_create_lead
```

The generic `call_connector_tool` remains available for debugging and advanced use, but normal ChatGPT usage should prefer the generated top-level tools.

## Child Worker routing modes

### 1. Private production mode: Service Binding

Use a Cloudflare Service Binding when the child Worker should not have a public endpoint.

`wrangler.toml` example:

```toml
[[services]]
binding = "TELEGRAM_CHILD"
service = "telegram-child-connector"
```

Connector example:

```json
{
  "connector_id": "tg",
  "name": "Telegram",
  "mode": "child_worker",
  "child_worker_binding": "TELEGRAM_CHILD",
  "actions": [
    {
      "name": "getme",
      "description": "Read-only. Returns Telegram bot profile. Does not send messages.",
      "method": "GET",
      "url": "https://child.local/tools/call",
      "auth": { "type": "none" },
      "input_schema": { "type": "object", "properties": {}, "additionalProperties": false }
    }
  ]
}
```

ChatGPT will see `tg_getme`; OneAIWorkers will call `env.TELEGRAM_CHILD.fetch(...)` internally.

### 2. Dynamic/fallback mode: protected child URL

Use a protected URL when the child Worker is created dynamically or when Service Binding is not configured.

```json
{
  "connector_id": "tg",
  "name": "Telegram",
  "mode": "child_worker",
  "child_worker_url": "https://telegram-child-connector.example.workers.dev",
  "child_worker_token_secret": "TELEGRAM_CHILD_CONNECTOR_TOKEN",
  "actions": []
}
```

The token value must be stored as a Cloudflare Secret on the main Worker. The child Worker must check the `x-oneaiworkers-child-token` header.

If the `workers.dev` domain is disabled, or no route/custom domain is attached to the child Worker, protected URL mode will not work. Use a Service Binding for private production routing or enable/attach a domain for that child Worker.

## Direct child access

Direct child Worker access is optional and should be treated as a plain API endpoint, not as a separate MCP server. If a user explicitly wants direct access, keep it protected with a separate token and document the endpoint as an API, not as a ChatGPT connector.

## Security defaults

- Main MCP endpoint is the only ChatGPT-facing gateway.
- Child Workers are internal execution backends by default.
- Child Workers must require `x-oneaiworkers-child-token` when accessed by URL.
- Use Service Bindings for private production child Workers.
- Store all tokens and API keys as Cloudflare Secrets on the main Worker.
