# Security notes

[Ukrainian version](SECURITY.uk.md)

OneAIWorkers lets an AI assistant read public pages and call external services. Treat it as real automation.

## Safe defaults

- It does not run arbitrary code from AI.
- Child Workers can only use predefined templates.
- Public URL tools block local and private hosts.
- Secrets should be stored as Cloudflare Worker secrets.
- Tool results hide sensitive URL fields such as `token`, `key`, `secret`, `password`, `auth`, and `signature`.
- The project does not include a database by default.

## MCP access

For personal use, set `MCP_SHARED_SECRET`.

The Worker accepts it in one of these ways:

- `Authorization: Bearer <secret>`;
- `x-oneaiworkers-token: <secret>`;
- `?key=<secret>` or `?access_token=<secret>`.

The `?key=` option is easy to use, but less safe because URLs can appear in logs or browser history.

For public apps, use OAuth or Cloudflare Access.

## Cloudflare API token

Only add `CF_API_TOKEN` if you need child Worker creation.

Use a limited API token. Do not use your global Cloudflare API key.

The token must be stored as a Worker secret.

## Child Worker warning

The first child Worker template is `webhook-forwarder`.

It stores the target webhook URL inside the generated Worker code. Do not use very sensitive webhook URLs with it until stronger secret handling is added.

## Notifications and webhooks

Notification tools can send real messages and call real services.

Recommended pattern:

1. Read or check data.
2. Let the AI assistant decide if it matters.
3. Send a message or call a webhook only when the rule is clear.
4. Let the AI assistant remember what happened.

## Avoid in the first version

Do not use this first version for:

- payments or refunds;
- deleting production data;
- sending customer emails automatically;
- posting to public social media without review;
- running arbitrary AI-generated code.
