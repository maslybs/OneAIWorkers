# Plugin Workers and gateway routing

OneAIWorkers exposes one stable MCP endpoint:

```text
ChatGPT or Claude -> OneAIWorkers /mcp -> W Gateway -> plugin Worker -> external service
```

The MCP client never calls a plugin Worker directly. It searches actions through `w_search`, loads a selected schema through `w_describe`, and runs it through `w_call` or `w_present`.

## Routing modes

### Private Service Binding

Use a Cloudflare Service Binding when the plugin Worker has no public address. This is the preferred mode for a manually deployed private plugin.

### Protected Worker address

The marketplace installer may deploy a plugin Worker with a protected address. It creates a separate random token, stores it encrypted in the main Worker's D1, and registers only the reviewed actions from the signed package.

The plugin Worker must check `x-oneaiworkers-child-token` on every call. Knowing its address is not enough to use it.

## Registry behavior

- Plugin versions are immutable.
- Every action has a versioned reference: `<plugin_id>:<capability_id>/<method>@<version>`.
- Installation and updates go through the browser and require the user's Cloudflare approval.
- The main Worker checks the marketplace checksum and signed registration receipt.
- Adding or updating a plugin does not change `tools/list`.
- Permissions and confirmations are checked in the main W Gateway before any plugin call.

## Direct access

Direct plugin Worker access is optional and should be treated as a separate protected API, not as another MCP server. It must use a different access policy and must never bypass the main gateway by accident.
