# Security notes

[Ukrainian version](SECURITY.uk.md)

OneAIWorkers lets an AI assistant read public pages and call external services. Treat it as real automation.

## Safe defaults

- It does not run arbitrary code from AI.
- Child Workers can only use predefined templates.
- Public URL tools block local and private hosts.
- Manually created connectors reference Cloudflare Worker Secrets by name.
- Marketplace connector credentials are encrypted with AES-GCM before they are stored in D1.
- Tool results hide sensitive URL fields such as `token`, `key`, `secret`, `password`, `auth`, and `signature`.
- D1 is used for OAuth, the connector registry, encrypted connector credentials, connector actions, and audit records. It is not used for AI memory.

## Marketplace connector credentials

The installer creates `CREDENTIALS_MASTER_KEY` as a Cloudflare Secret. The value is never written to Git, the marketplace, or the connector package.

Users enter service keys only on a short-lived settings page hosted by their own OneAIWorkers. The Worker encrypts the values with AES-GCM and context binding before writing them to D1. The marketplace and central installer never receive these service keys.

Connector packages are checked against the catalog checksum. The main Worker accepts an installed child Worker only when the registration receipt has a valid ECDSA signature, matches its own address, has not expired, and has not been used before.

## MCP access

The normal installer creates `MCP_SHARED_SECRET` automatically. If you install manually, create it yourself before connecting an MCP client.

Knowing only the Worker URL does not grant access to `/mcp`. A new OAuth connection must pass the shared-secret check. Public service pages may expose metadata or update information, but they do not expose saved connector data or secret values.

The Worker accepts it in one of these ways:

- `Authorization: Bearer <secret>`;
- `x-oneaiworkers-token: <secret>`;

Secrets and OAuth access tokens are deliberately rejected in URL query parameters because URLs can appear in logs and browser history.

For a deliberately public app, design a separate access policy instead of removing protection by accident.

OAuth requires PKCE with `S256`. Access tokens expire after one hour. Clients can request the `offline_access` scope to receive a rotating refresh token. OAuth tokens can be revoked through `/oauth/revoke`.

## Cloudflare access

The browser installer uses a short-lived Cloudflare OAuth token to create or update Workers. It revokes the token after the operation.

The installed OneAIWorkers does not keep this OAuth token. Marketplace connector installation does not require a permanent `CF_API_TOKEN`.

## Child Worker warning

Marketplace child Workers use their own random access token. The main Worker keeps that token encrypted and calls the child through HTTPS. Knowing only the child Worker address is not enough to call its tools.

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
