# OneAIWorkers

[Українська версія](README.uk.md)

OneAIWorkers is a private MCP gateway for ChatGPT, Claude, and other MCP-compatible clients. It runs in your Cloudflare account, keeps service keys encrypted in your own D1 database, and extends through installable plugins.

```text
ChatGPT / Claude / another MCP client → OneAIWorkers → installed plugins and services
```

## Install

<table>
  <tr>
    <td align="center" width="50%">
      <h3>Simple installation</h3>
      <p>No GitHub or command line.</p>
      <a href="https://workers.bgdn.dev">
        <img alt="Install OneAIWorkers" src="https://img.shields.io/badge/INSTALL-RECOMMENDED-2563EB?style=for-the-badge&amp;logo=cloudflare&amp;logoColor=white">
      </a>
    </td>
    <td align="center" width="50%">
      <h3>For developers</h3>
      <p>Deploy from your own Git repository.</p>
      <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers">
        <img alt="Deploy with Git" src="https://img.shields.io/badge/DEPLOY_WITH_GIT-DEVELOPERS-F97316?style=for-the-badge&amp;logo=github&amp;logoColor=white">
      </a>
    </td>
  </tr>
</table>

The simple installer creates the Worker, D1 database, Workers AI binding, agent storage, private access secret, and credential encryption key. The final page shows the protected `/mcp` address and access secret. Save the secret immediately; it is shown once.

## Connect a client

Use the same server with every supported client:

```text
Authentication: OAuth
Server URL: https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

- In ChatGPT, add a custom MCP app and choose OAuth.
- In Claude, add a custom remote MCP server. Optional Client ID and Client Secret fields stay empty.
- Other clients can use Streamable HTTP with OAuth. A client without OAuth may send the access secret in the `Authorization: Bearer` header.

When the OneAIWorkers sign-in page opens, enter the access secret. Never place it in the URL.

See [client setup](docs/CLIENTS.md) for examples.

## How it works

The public MCP surface always contains exactly six commands:

```text
w_search
w_describe
w_call
w_present
w_result_read
w_agent_run
```

Installing or updating a plugin does not change this list, so MCP clients do not keep stale action lists.

When a client connects, OneAIWorkers instructs it to start with an empty `w_search`. This replaces the old `hub_info` entry point without restoring a large, unstable tool list. The result includes system capabilities, installed plugins, the current live marketplace, exact installation links, and available plugin updates.

1. `w_search` explains what is available and finds allowed actions. Small catalogs use exact names and D1 text search; meaning search is only added when it is useful.
2. `w_describe` loads the exact stored schemas only for selected actions.
3. `w_call` validates and runs one immutable action.
4. `w_present` is reserved for visual results.
5. `w_result_read` reads a small part of a large stored result.
6. `w_agent_run` starts an approved agent or team with limits.

Permissions are applied before search and checked again before execution. For a risky action, the protected browser page offers two choices: run only that exact action, or remember automatic permission for that one plugin. Remembered permission is limited to the same user and MCP endpoint, can be revoked, and resets when the plugin is updated. The browser runs the approved action itself, so the client must not repeat `w_call`.

## Add a plugin

Ask the MCP client for the service or result you need:

```text
Find a plugin that can inspect my n8n workflows and failed runs.
```

OneAIWorkers checks the live marketplace from inside your Worker. When a compatible cloud plugin exists, the reply starts with an exact browser installation link. The client does not need to know a plugin name in advance: it can search by the result the user wants.

1. Open the link in a normal browser.
2. Approve installation in Cloudflare.
3. Enter the service address and key only on your own OneAIWorkers settings page. The page saves the values and verifies the connection before reporting success.
4. Return to the chat. `w_search` can find the new plugin immediately; reconnecting the MCP client is not required.

The service key is not sent to the marketplace or central installer. It is encrypted with `CREDENTIALS_MASTER_KEY` before D1 storage.

## Plugin packages

The primary package format is `oneai.plugin.v1`. One package may contain cloud operations, executable skills, agents, prompts, resources, user interface parts, settings, permissions, and runtime artifacts.

Every callable action has an immutable reference:

```text
<plugin_id>:<capability_id>/<method>@<version>
```

Executable skills require a formal `oneai.skill-api.v1` contract with an entry point, methods, schemas, permissions, and side-effect annotations. A plain `SKILL.md` remains instructional and cannot run code.

See [W Gateway and plugin packages](docs/W_GATEWAY.md).

## Security

- Knowing only the Worker URL does not grant MCP access.
- OAuth and `MCP_SHARED_SECRET` protect `/mcp`.
- Service credentials are encrypted and never enter search text, embeddings, logs, or result previews.
- The gateway never accepts an arbitrary URL or HTTP method through `w_call`.
- Large results stay in D1 or R2 and are read in small authorized parts.
- Administrative publication commands exist only on `/mcp/admin` and require administrator access.

See [security](docs/SECURITY.md).

## Updates

When an update is available, open this page in a normal browser:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/update
```

The updater replaces Worker code while preserving D1 data, installed plugins, settings, and Cloudflare Secrets. See [updates](docs/UPDATES.md).

## More documentation

- [W Gateway and plugin packages](docs/W_GATEWAY.md)
- [Client setup](docs/CLIENTS.md)
- [Installation](docs/INSTALL.md)
- [Cloudflare deployment](docs/DEPLOY_TO_CLOUDFLARE.md)
- [Agents](docs/AGENTS.md)
- [Plugin Workers](docs/CHILD_WORKERS.md)
- [Workers AI usage](docs/NEURON_METER.md)

## License

MIT
