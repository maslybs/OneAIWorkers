# OneAIWorkers updates

Every installed OneAIWorkers instance has its own update page:

```text
https://YOUR-WORKER/update
```

When the official update manifest contains a newer version, OneAIWorkers appends the current version, latest version, critical flag, and the installed Worker's `/update` link to MCP tool results. This lets ChatGPT or another MCP client tell the user that an update is available during normal use.

MCP cannot show a notification while the client is not using the Worker. The check runs during a tool call or when `/update` is opened.

The update link never contains keys, tokens, or secrets. The `/update` page runs on the user's Worker. Cloudflare authorization begins only after the user presses the update button.

The bundled service in [`installer/`](../installer/) verifies ownership for `workers.dev` addresses and requires the `OAUTH_DB` and `MCP_SHARED_SECRET` bindings. Cloudflare inherits all existing bindings during the code upload, so secret values are neither read nor sent to the installer.

See [UPDATES.uk.md](UPDATES.uk.md) for configuration and security details.
