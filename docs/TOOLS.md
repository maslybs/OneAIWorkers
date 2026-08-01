# MCP commands

[Ukrainian version](TOOLS.uk.md)

OneAIWorkers exposes the same six commands to ChatGPT, Claude, and every other supported MCP client.

## `w_search`

Finds allowed actions in installed plugins and approved executable skills. It combines exact matching, D1 full-text search, and Workers AI meaning search. The result is compact and does not contain full schemas.

Use an empty query to get a short overview. When a needed plugin is not installed, the result may include the exact browser link to the marketplace flow.

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

Starts an approved agent or agent team with step and budget limits. Agents use the same plugin permissions and cannot approve their own risky actions.

## Recommended flow

```text
w_search
  -> w_describe
  -> ask the user for confirmation when required
  -> w_call or w_present
  -> w_result_read only when the result is large
```

Installing, updating, disabling, or removing a plugin does not change this command list. Reconnecting the MCP client is not required.
