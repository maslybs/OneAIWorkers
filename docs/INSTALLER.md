# Installer without GitHub

[Ukrainian version](INSTALLER.uk.md)

This repository includes a separate central installer. The OneAIWorkers owner configures it once. End users then do not need GitHub, do not create D1 manually, and do not generate a shared secret themselves.

## User flow

1. Open the installer page.
2. Sign in with Cloudflare.
3. Approve limited permissions.
4. Select an account and click **Install**.
5. Save the `/mcp` URL and shared secret.

The installer creates D1, generates `MCP_SHARED_SECRET`, uploads the current OneAIWorkers build, enables `workers.dev`, and revokes its temporary Cloudflare access after success.

The same service handles later updates. It verifies that the `workers.dev` address belongs to the selected account and that the Worker has the required OneAIWorkers bindings. Cloudflare then replaces code while inheriting D1, connector data, and secrets without revealing their values.

It refuses to overwrite an existing Worker. If installation fails, it attempts to remove only the D1 database and Worker created during that attempt.

## One-time maintainer setup

Use a stable URL on a domain you control, such as:

```text
https://install.example.com
```

Create a server-side Cloudflare OAuth client with:

```text
Response type: code
Grant type: authorization_code
Token authentication: client_secret_basic
Redirect URL: https://install.example.com/oauth/callback
```

Select only these permissions:

```text
Account Settings Read
Workers Scripts Read
Workers Scripts Write
D1 Write
```

The client must be public for Cloudflare users outside the owner account. Cloudflare requires domain ownership verification before a client can become public.

Set the URL and custom domain in [`wrangler.installer.toml`](../wrangler.installer.toml):

```toml
PUBLIC_BASE_URL = "https://install.example.com"
routes = [{ pattern = "install.example.com", custom_domain = true }]
```

Deploy once so Cloudflare creates the installer:

```bash
npm run deploy:installer
```

Then store these as Cloudflare secrets, never in Git:

```bash
npx wrangler secret put CF_OAUTH_CLIENT_ID --config wrangler.installer.toml
npx wrangler secret put CF_OAUTH_CLIENT_SECRET --config wrangler.installer.toml
npx wrangler secret put INSTALLER_SESSION_SECRET --config wrangler.installer.toml
```

`INSTALLER_SESSION_SECRET` must be a random value at least 32 characters long. Deploy once more after adding the secrets:

Build and deploy:

```bash
npm run deploy:installer
```

Then use the installer URL as the primary README or website button. Keep the old Deploy to Cloudflare button only as an advanced option because it requires GitHub or GitLab.

For previously installed Workers, add the service URL to [`update-manifest.json`](../update-manifest.json) in the next release:

```json
"update_service_url": "https://install.example.com/update/start"
```

Workers created by the installer receive this URL automatically.

## Data handling

The installer has no user database. Its Cloudflare access token exists only inside an encrypted `HttpOnly` session cookie for at most 15 minutes. On success, the token is revoked and the cookie is cleared.

The generated shared secret is shown once. It is not added to source code, URLs, or installer logs.
