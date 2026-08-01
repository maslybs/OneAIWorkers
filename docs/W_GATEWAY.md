# W Gateway and plugin packages

## Stable MCP surface

The default `/mcp` endpoint uses `meta` mode and publishes only:

```text
w_search
w_describe
w_call
w_present
w_result_read
w_agent_run
```

The list stays unchanged when plugins are installed, updated, disabled, or removed. Disabled legacy endpoints `/mcp/direct` and `/mcp/hybrid` can only be enabled with `W_ENABLE_LEGACY_DIRECT=true` for controlled migration.

The MCP initialization instructions tell the client to call an empty `w_search` at the start of a conversation and whenever the user asks about capabilities, installation, or updates. This overview is the stable replacement for the pre-1.0 `hub_info` tool. It contains the system summary, installed user plugins, live marketplace entries, exact install links, and update links.

Every response from these six commands checks the OneAIWorkers update state. When a newer version exists, the response starts with an update message and the direct browser link. A short cache prevents repeated manifest downloads for every command.

Administrative registry commands are isolated on `/mcp/admin` and require administrator access.

## Search flow

`w_search` applies endpoint, tenant, user, target, connection, read/write, and enabled-state rules before retrieval.

Small catalogs use no Workers AI. They merge:

1. exact references and names;
2. D1 FTS5 candidates;
3. availability and historical success.

Vector search is added only when both conditions are true:

- the user can see at least 20 plugins;
- exact and FTS5 search did not produce a confident result.

An exact name or immutable reference skips Workers AI even in a large catalog. `W_SEMANTIC_PLUGIN_THRESHOLD` can change the threshold; its default is `20`.

`w_search` returns `search_mode: "text"` for the fast path and `search_mode: "hybrid"` when vectors were actually used.

If an ordinary search finds no installed operation, the gateway checks installed-but-unconfigured plugins and then the live marketplace. It returns only real catalog matches and promotes the exact browser action to the top level of the response.

The response contains compact metadata and never contains full schemas or vectors. `w_describe` reads stored schemas for up to ten selected immutable references.

The registry is not rebuilt before every search. OneAIWorkers marks it stale after a plugin install, update, disable, removal, connection change, or OneAIWorkers version change. Synchronization runs only after one of those changes.

## Calling an action

`w_call` accepts only an installed immutable reference:

```text
<plugin_id>:<capability_id>/<method>@<version>
```

It validates the stored schema, permissions, account connection, required scopes, one-time confirmation, and repeat-protection key before using the shared runtime router. It does not accept arbitrary addresses or request methods.

Results larger than 24,000 characters are stored in D1 or R2. The response contains a preview and `result_id`; `w_result_read` reads only an authorized part for the same tenant, user, endpoint, and session.

## Plugin credentials

Encrypted D1 records are the single source of truth for plugin credentials. The protected settings page works for both marketplace plugins and manually added plugins.

After the user saves credentials, OneAIWorkers runs a safe read-only connection check when the plugin provides one. A rejected key is shown immediately and stored as an error state. A plugin with failed verification is not advertised as connected until a later successful check.

When an older internal plugin still uses a Cloudflare secret such as `N8N_PSY_API_KEY`, OneAIWorkers copies the existing value into encrypted D1 storage during registry synchronization. Calls then use the managed D1 value, and the W Gateway reports the plugin as connected. Saving new values marks the registry stale, so the next `w_call` or `w_search` refreshes connection state automatically.

`delete_plugins` removes several selected plugins and their saved settings under one user confirmation. After browser approval, the MCP client must repeat the same `w_call` with unchanged arguments and the returned confirmation token. Listing plugins alone does not execute the approved deletion.

## `oneai.plugin.v1`

Minimal envelope:

```json
{
  "format": "oneai.plugin.v1",
  "id": "example",
  "name": "Example",
  "version": "1.0.0",
  "description": "Example cloud plugin.",
  "targets": ["oneaiworkers-cloudflare"],
  "capabilities": [
    {
      "kind": "plugin",
      "id": "api",
      "target": "oneaiworkers-cloudflare",
      "artifact": "cloud/plugin.json"
    }
  ],
  "permissions": {
    "network": ["configured-service-host"],
    "secrets": ["service_api_key"]
  }
}
```

Published versions are immutable. A changed schema or behavior requires a new version. Rollback changes the current published version without rewriting an older version.

## Executable skills

A plain `SKILL.md` remains instructional. A callable skill also needs `oneai.skill-api.v1`:

```json
{
  "format": "oneai.skill-api.v1",
  "runtime": "javascript",
  "entry": "scripts/runner.js",
  "methods": [
    {
      "name": "request_plan",
      "description": "Create a deterministic plan.",
      "dispatch": { "input.mode": "request_plan" },
      "input_schema": {
        "type": "object",
        "properties": { "task": { "type": "string" } },
        "required": ["task"],
        "additionalProperties": false
      },
      "output_schema": { "type": "object" },
      "annotations": {
        "read_only": true,
        "destructive": false,
        "requires_confirmation": false
      }
    }
  ]
}
```

Cloud publication rejects an executable skill without a supported runtime, explicit entry point, complete method schemas, permissions, and side-effect annotations.

## D1 registry

The normalized registry uses `w_` tables for plugins, versions, capabilities, actions, aliases, examples, embeddings, clusters, jobs, accounts, endpoint permissions, confirmation tokens, repeat protection, result references, search events, and execution events.

D1 is the source of truth. An optional search accelerator may be added later, but it must be rebuildable from D1 and cannot replace the D1 publication record.
