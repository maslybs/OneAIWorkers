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

Administrative registry commands are isolated on `/mcp/admin` and require administrator access.

## Search flow

`w_search` applies endpoint, tenant, user, target, connection, read/write, and enabled-state rules before retrieval. It then merges:

1. exact references and names;
2. D1 FTS5 candidates;
3. Workers AI query embeddings compared with a limited set of vectors stored in D1;
4. availability and historical success.

The response contains compact metadata and never contains full schemas or vectors. `w_describe` reads stored schemas for up to ten selected immutable references.

## Calling an action

`w_call` accepts only an installed immutable reference:

```text
<plugin_id>:<capability_id>/<method>@<version>
```

It validates the stored schema, permissions, account connection, required scopes, one-time confirmation, and repeat-protection key before using the shared runtime router. It does not accept arbitrary addresses or request methods.

Results larger than 24,000 characters are stored in D1 or R2. The response contains a preview and `result_id`; `w_result_read` reads only an authorized part for the same tenant, user, endpoint, and session.

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
