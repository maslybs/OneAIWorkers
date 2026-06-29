# Child Workers і gateway routing

OneAIWorkers має показувати ChatGPT один MCP endpoint:

```text
ChatGPT -> OneAIWorkers /mcp -> generated top-level tool -> internal connector або child Worker -> external API
```

ChatGPT не має викликати child Workers напряму. Після збереження connector його actions показуються як first-class OneAIWorkers tools, наприклад:

```text
tg_getme
tg_send_message
n8n_list_workflows
crm_create_lead
```

Generic `call_connector_tool` залишається для debug і advanced use, але нормальний ChatGPT UX має використовувати generated top-level tools.

## Режими виклику child Worker

### 1. Private production mode: Service Binding

Використовуйте Cloudflare Service Binding, коли child Worker не має мати public endpoint.

Приклад `wrangler.toml`:

```toml
[[services]]
binding = "TELEGRAM_CHILD"
service = "telegram-child-connector"
```

Приклад connector:

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

ChatGPT бачитиме `tg_getme`, а OneAIWorkers під капотом викличе `env.TELEGRAM_CHILD.fetch(...)`.

### 2. Dynamic/fallback mode: protected child URL

Використовуйте protected URL, коли child Worker створюється динамічно або Service Binding не налаштований.

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

Значення token треба зберегти як Cloudflare Secret в основному Worker. Child Worker має перевіряти header `x-oneaiworkers-child-token`.

Якщо `workers.dev` domain вимкнений або до child Worker не підключений route/custom domain, protected URL mode не працюватиме. Для private production routing використовуйте Service Binding або увімкніть/підключіть domain для цього child Worker.

## Прямий доступ до child Worker

Прямий доступ до child Worker — опційний. Це має бути plain API endpoint, не окремий MCP server. Якщо користувач явно хоче direct access, залишайте його захищеним окремим token і документуйте як API endpoint, а не як ChatGPT connector.

## Security defaults

- Основний MCP endpoint — єдиний gateway для ChatGPT.
- Child Workers за замовчуванням є internal execution backends.
- Child Workers мають вимагати `x-oneaiworkers-child-token`, якщо доступні через URL.
- Для private production child Workers використовуйте Service Bindings.
- Усі tokens і API keys зберігайте як Cloudflare Secrets в основному Worker.
