# OneAIWorkers updates

[Українська версія](UPDATES.uk.md)

Every installed OneAIWorkers has its own update page:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/update
```

## What the user sees

OneAIWorkers checks for updates while an MCP tool is being used. If a newer version is available, the response shows the direct update link before the normal tool result.

Open this link in a normal browser. Do not call it through `fetch_url` or another server-side tool. A server-side request may fail even when the page works correctly in the user's browser.

MCP cannot show a notification while the client is not using the Worker. A successful update check may be cached for up to six hours.

## How to update

1. Open the `/update` link in a normal browser.
2. Sign in to Cloudflare.
3. Select the account that owns the Worker.
4. Confirm the update.
5. Refresh or reconnect the MCP app after the update so it reloads the tool list.

The update service verifies through Cloudflare that the Worker belongs to the selected account. It replaces only the Worker code. Existing D1 data, connector settings, bindings, and Cloudflare Secrets are preserved.

The update link contains no keys, tokens, or secrets.

## Official update source

By default, the Worker checks:

```text
https://raw.githubusercontent.com/maslybs/OneAIWorkers/main/update-manifest.json
```

If this file cannot be reached, the normal MCP tools continue to work. Project owners can change the source with `UPDATE_MANIFEST_URL` or disable checks with `UPDATE_CHECK_ENABLED=false`.
