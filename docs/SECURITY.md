# Security notes

[Ukrainian version](SECURITY.uk.md)

OneAIWorkers gives an LLM tools that can fetch public URLs and trigger external notifications or webhooks. Treat it as real automation infrastructure.

## Default design choices

- No arbitrary JavaScript deployment tool is exposed.
- Child Workers can only be deployed from predefined templates.
- Outbound fetches block local, private, and loopback hosts.
- Raw IPv6 hosts are blocked by default to reduce SSRF risk.
- No KV, D1, or database storage is included by default.
- Secrets are expected to be stored as Cloudflare Worker secrets.
- Tool results redact sensitive URL query parameters like `token`, `key`, `secret`, `password`, `auth`, and `signature`.

## MCP access

For personal use, you can set `MCP_SHARED_SECRET`. The Worker accepts the secret in:

- `Authorization: Bearer <secret>`;
- `x-oneaiworkers-token: <secret>`;
- `?key=<secret>` or `?access_token=<secret>`.

The query-string mode is convenient for clients that cannot set custom headers. It is not ideal for high-security production because URLs can appear in logs or browser history.

For public apps, prefer a real OAuth flow or Cloudflare Access.

## Cloudflare API token

Only configure `CF_API_TOKEN` if you need child Worker creation.

Use a scoped API token with minimum permissions. Do not use your global Cloudflare API key.

The token should only be available as a Worker secret and should never be returned in tool results, logs, or notifications.

## Child Worker template warning

The first child Worker template, `webhook-forwarder`, embeds its target URL in the generated Worker source. Do not use it with highly sensitive URLs until you add a stronger secret rotation model.

## Webhooks and notifications

Notification tools have side effects. ChatGPT and other MCP clients may ask for confirmation depending on the client's permission settings and tool metadata, but you should still design prompts carefully.

Recommended pattern:

1. Fetch, check, or read data.
2. Let the LLM interpret it.
3. Notify or call a webhook only when the condition is clear.
4. Let the LLM keep memory of what happened.

## Not recommended for the first version

Avoid these until you add proper approvals and policies:

- payments or refunds;
- deleting production data;
- sending emails to customers automatically;
- posting publicly to social media without human review;
- executing arbitrary LLM-generated code.
