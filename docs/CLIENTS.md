# Connect ChatGPT, Claude, and other MCP clients

[Українська версія](CLIENTS.uk.md)

Every compatible client uses the same OneAIWorkers address:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

The recommended authentication method is OAuth. When the OneAIWorkers sign-in page opens, enter the access secret shown by the installer.

## ChatGPT

1. Open the apps or connections settings in ChatGPT.
2. Add a custom MCP app.
3. Paste the `/mcp` address.
4. Select OAuth and connect.
5. Enter the OneAIWorkers access secret when asked.

## Claude

The simplest method is Claude's remote MCP screen:

1. Open **Customize**.
2. Choose the option for adding a custom remote MCP server.
3. Paste the `/mcp` address.
4. Leave optional Client ID and Client Secret fields empty.
5. Connect and enter the OneAIWorkers access secret when asked.

Claude supports remote MCP servers through its account. Availability and organization permissions depend on the Claude plan.

### Claude Desktop configuration file

If you use local MCP configuration in Claude Desktop, add this entry to `mcpServers` in `claude_desktop_config.json`:

```json
"oneaiworkers": {
  "command": "npx",
  "args": [
    "-y",
    "mcp-remote@latest",
    "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp",
    "--transport",
    "http-only"
  ]
}
```

Restart Claude Desktop. `mcp-remote` should open the OAuth page in a browser. This keeps `MCP_SHARED_SECRET` out of the configuration file. See the [mcp-remote documentation](https://github.com/geelen/mcp-remote).

## Other MCP clients

OneAIWorkers works with clients that support remote MCP over Streamable HTTP and one of these authentication methods:

- OAuth with dynamic client registration and PKCE;
- `Authorization: Bearer <access-secret>`;
- `x-oneaiworkers-token: <access-secret>`.

If a client supports only local `stdio` servers, use a bridge such as `mcp-remote`.

Never place the access secret in the URL.

## After adding or changing a plugin

The plugin is available immediately through `w_search`. The public command list never changes, so refreshing or reconnecting is not required.
