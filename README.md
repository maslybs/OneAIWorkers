# OneAIWorkers

[Українська версія](README.uk.md)

## Choose how to install

<table>
  <tr>
    <td align="center" width="50%">
      <h3>Simple installation</h3>
      <p>No GitHub or command line. Sign in to Cloudflare and install.</p>
      <a href="https://workers.bgdn.dev">
        <img alt="Install OneAIWorkers — Recommended" src="https://img.shields.io/badge/INSTALL_OneAIWorkers-RECOMMENDED-2563EB?style=for-the-badge&amp;logo=cloudflare&amp;logoColor=white">
      </a>
    </td>
    <td align="center" width="50%">
      <h3>Developer installation</h3>
      <p>Create a GitHub or GitLab repository and deploy every push automatically.</p>
      <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers">
        <img alt="Deploy with Git — For developers" src="https://img.shields.io/badge/DEPLOY_WITH_GIT-FOR_DEVELOPERS-F97316?style=for-the-badge&amp;logo=github&amp;logoColor=white">
      </a>
    </td>
  </tr>
</table>

Both methods install OneAIWorkers in the user's own Cloudflare account. The simple installer is easier; the Git method gives developers direct control over the repository and deployment history.

OneAIWorkers lets ChatGPT, Claude, and other MCP-compatible clients use your APIs and tools while the access keys stay in your own Cloudflare account.

You install one Worker, connect one `/mcp` address, and then add the connectors you need. A connector can read data from an API, send a webhook, call n8n, work with a CRM, or perform another approved action.

```text
ChatGPT / Claude / another MCP client → your OneAIWorkers → your connectors and APIs
```

## Why use it

- No GitHub account is needed for the simple installation.
- The Worker and its D1 database belong to the user.
- The installer creates a private access secret automatically.
- API keys stay in Cloudflare Secrets and are not saved in connector settings.
- Connector actions appear in ChatGPT, Claude, and other MCP clients as normal tools, such as `n8n_list_workflows`.
- Updates keep the existing database, connectors, and secrets.

## Install

1. Open [workers.bgdn.dev](https://workers.bgdn.dev).
2. Sign in to Cloudflare.
3. Select the Cloudflare account where the Worker should be installed.
4. Choose a name and click **Install OneAIWorkers**.
5. Save the `/mcp` address and access secret shown on the final page.

The secret is shown only once. Keep it in a password manager or another private place.

The installer automatically creates:

- the OneAIWorkers Worker;
- a D1 database for OAuth and connector settings;
- a native Workers AI binding;
- a SQLite-backed Durable Object namespace for agents, teams, runs, budgets, and cancellation state;
- `MCP_SHARED_SECRET` for private access.

## Connect an MCP client

All compatible clients use the same protected address:

```text
Authentication: OAuth
Server URL: https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

### ChatGPT

Add a custom MCP app, paste the `/mcp` address, and select OAuth. When the OneAIWorkers sign-in page opens, enter the access secret saved during installation.

### Claude

Open **Customize → Connectors → Add custom connector**, paste the `/mcp` address, and connect. Leave optional Client ID and Client Secret fields empty. OneAIWorkers registers the OAuth client automatically.

Claude Desktop can also connect through `claude_desktop_config.json` and `mcp-remote` when the account connector screen is not available.

### Other MCP clients

Use the `/mcp` address as a remote MCP server with Streamable HTTP and OAuth. Clients without OAuth can send the access secret through an `Authorization: Bearer` header. Never put the secret in the URL.

After connecting, ask your AI client:

```text
Check my OneAIWorkers connector setup.
```

The client should use `connector_setup_status`. It reports the database, saved connectors, generated tools, and missing secret names without showing secret values.

See [Client setup](docs/CLIENTS.md) for complete ChatGPT, Claude Desktop, and generic MCP examples.

## Create a connector

A connector stores an API address, available actions, and the **name** of the required Cloudflare secret. It does not store the secret value.

For example, to connect n8n:

1. Add the real n8n key to your Worker as a Cloudflare secret named `N8N_API_KEY`.
2. Ask your AI client to create a read-only n8n connector for your n8n address.
3. Ask it to test the connector with a dry run before making a real request.
4. Refresh or reconnect the MCP app so the new connector actions appear in the tool list.

The AI client saves the connector through `save_connector`. OneAIWorkers stores it in D1. The real API key remains in Cloudflare Secrets.

Example request:

```text
Create a read-only n8n connector for https://example.com/api/v1.
Use the X-N8N-API-KEY header and the Cloudflare secret named N8N_API_KEY.
Add actions for listing workflows and executions.
Test it with a dry run first.
```

For detailed connector fields and supported authentication types, see [Tools](docs/TOOLS.md).

## Access protection

Knowing only the Worker address is not enough to use its MCP tools.

The normal installer protects access with OAuth and `MCP_SHARED_SECRET`. A person without the secret cannot connect to `/mcp` or call saved connectors. Some public service pages, such as update information or OAuth metadata, may still open, but they do not reveal secrets or grant connector access.

Keep these rules:

- never put a secret in a URL;
- never save a real API key inside a connector manifest;
- store keys only as Cloudflare Secrets;
- replace the access secret if it may have leaked.

See [Security notes](docs/SECURITY.md) for more details.

## Updates

When an update is available, the MCP response puts the direct update link first:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/update
```

Open this link in a normal browser. Do not test the update page with `fetch_url` or another server-side tool.

The update process asks you to sign in to Cloudflare, verifies that the Worker belongs to your account, and replaces only the Worker code. Existing D1 data, connector settings, and Cloudflare Secrets are preserved.

See [Updates](docs/UPDATES.md) for details.

## Main tools

```text
hub_info
connector_setup_status
save_connector
list_connectors
test_connector
call_connector_tool
delete_connector
fetch_url
fetch_many_urls
fetch_rss
check_url_status
ai_models_list
ai_recommend_model
ai_chat
agent_team_propose
agent_team_create
agent_team_start
agent_run_status
agent_run_cancel
send_notification
call_webhook
```

Saved connector actions are also exposed as their own tools. For normal use, prefer those generated tools over `call_connector_tool`.

## Advanced use

OneAIWorkers can also create protected child Workers for tasks that need custom code or unusual logic. This is optional and requires additional Cloudflare permissions. Most API connections should use normal connectors.

See:

- [Agents and agent teams](docs/AGENTS.md)
- [Child Workers](docs/CHILD_WORKERS.md)
- [Manual installation](docs/INSTALL.md)
- [Developer deployment through Git](docs/DEPLOY_TO_CLOUDFLARE.md)
- [Prompts](docs/PROMPTS.md)
- [ChatGPT, Claude, and other MCP clients](docs/CLIENTS.md)

## License

MIT
