# Security notes

[Ukrainian version](SECURITY.uk.md)

OneAIWorkers lets an AI assistant read public pages and call external services. Treat it as real automation.

## Safe defaults

- It does not run arbitrary code from AI.
- Child Workers can only use predefined templates.
- Public URL tools block local and private hosts.
- Secrets should be stored as Cloudflare Worker secrets.
- Tool results hide sensitive URL fields such as `token`, `key`, `secret`, `password`, `auth`, and `signature`.
- D1 is used for OAuth, connector registry, connector actions, and audit records. It is not used for AI memory.

## MCP access

The normal installer creates `MCP_SHARED_SECRET` automatically. If you install manually, create it yourself before connecting an MCP client.

Knowing only the Worker URL does not grant access to `/mcp`. A new OAuth connection must pass the shared-secret check. Public service pages may expose metadata or update information, but they do not expose saved connector data or secret values.

The Worker accepts it in one of these ways:

- `Authorization: Bearer <secret>`;
- `x-oneaiworkers-token: <secret>`;

Secrets and OAuth access tokens are deliberately rejected in URL query parameters because URLs can appear in logs and browser history.

For a deliberately public app, design a separate access policy instead of removing protection by accident.

OAuth requires PKCE with `S256`. Access tokens expire after one hour. Clients can request the `offline_access` scope to receive a rotating refresh token. OAuth tokens can be revoked through `/oauth/revoke`.

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
