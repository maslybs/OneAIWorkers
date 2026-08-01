# OneAIWorkers updates

[Українська версія](UPDATES.uk.md)

Existing installations keep working when the installer signing key still uses its former Cloudflare secret name. New installations use `PLUGIN_INSTALLER_PUBLIC_KEY`.

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
5. Return to the chat. The stable live gateway works without reconnecting. Refresh only if you want new top-level shortcut tools to appear.

The update service verifies through Cloudflare that the Worker belongs to the selected account. It replaces only the Worker code. Existing D1 data, plugin settings, bindings, and Cloudflare Secrets are preserved.

The update link contains no keys, tokens, or secrets.

## Official update source

By default, the Worker checks:

```text
https://raw.githubusercontent.com/maslybs/OneAIWorkers/main/update-manifest.json
```

If this file cannot be reached, the normal MCP tools continue to work. Project owners can change the source with `UPDATE_MANIFEST_URL` or disable checks with `UPDATE_CHECK_ENABLED=false`.

For every version, GitHub automatically publishes an immutable `oneaiworkers-worker.mjs` release bundle with release metadata and a SHA-256 checksum. The central installer contains no copy of OneAIWorkers. After the user approves an update, it downloads the release that matches `latest_version`, verifies it, and only then uploads the code to the user's Cloudflare account.

Changing OneAIWorkers does not require rebuilding the installer. Increase the version in `package.json`, `APP_VERSION`, and `update-manifest.json`, then push the change to `main`. The GitHub release workflow runs the checks and publishes the matching bundle. An existing version tag is never replaced.
