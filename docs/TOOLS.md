# MCP commands

[Ukrainian version](TOOLS.uk.md)

OneAIWorkers exposes the same nine commands to ChatGPT, Claude, and every other supported MCP client.

## `w_search`

Finds allowed actions in installed plugins and approved executable skills. Exact and D1 text search handle small catalogs; Workers AI meaning search is added only when the visible catalog is large and simpler search is not confident. The result is compact and does not contain full schemas.

Use an empty query to get the system summary, installed plugins, the current live marketplace, exact installation links, and available updates. When an ordinary search has no installed result, OneAIWorkers also checks the live marketplace.

## `w_describe`

Loads stored input and output schemas for up to ten exact action references. Use it after `w_search` and before `w_call`.

## `w_call`

Runs one installed immutable action. It accepts an action reference and arguments, never an arbitrary address or request method.

Before execution OneAIWorkers checks permissions, account connection, schema, scopes, one-time confirmation, and repeat protection. A risky action returns a protected browser link. It cannot run until the user opens that link and approves it; an agent cannot approve itself.

## `w_present`

Runs an action whose natural result is visual, such as an image, preview, screenshot, render, or diagram. Normal JSON, lists, logs, and source code use `w_call`.

## `w_result_read`

Reads a bounded part of a large result stored by OneAIWorkers. The same tenant, user, endpoint, and session must own the result.

## `w_agent_run`

Starts an approved bounded agent team with step and budget limits. New adaptive teams select only useful subagents, may use optional TypeSafe Jev for routing/review decisions, and return compact evidence intended to save primary-model context.

Adaptive scouts can use only read-only W Gateway operations under the same tenant/user/endpoint permissions as the original request. They cannot execute external writes or bypass confirmation; write suggestions are returned to the primary client as proposed actions. Existing saved teams continue to work in legacy mode.

## Recommended flow

```text
w_search
  -> w_describe
  -> ask the user for confirmation when required
  -> w_call or w_present
  -> w_result_read only when the result is large
```

Installing, updating, disabling, or removing a plugin does not change this command list. Reconnecting the MCP client is not required.
