import type { Env } from "./types";

export function homeHtml(env: Env, baseUrl: string): string {
  const title = env.HUB_NAME || "OneAIWorkers";
  const mcpUrl = `${baseUrl}/mcp`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; max-width: 980px; margin: 48px auto; padding: 0 20px; color: #172033; }
    code, pre { background: #f4f6f8; border-radius: 8px; }
    code { padding: 2px 5px; }
    pre { padding: 14px; overflow: auto; }
    .card { border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px; margin: 18px 0; }
    .muted { color: #64748b; }
    .ok { color: #057a55; font-weight: 700; }
    .warn { color: #b45309; font-weight: 700; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    ul { padding-left: 22px; }
    @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="muted">Secure remote MCP gateway for connecting ChatGPT to user-owned HTTP APIs through saved connector manifests.</p>

  <div class="grid">
    <section class="card">
      <h2>English</h2>
      <p><strong>OneAIWorkers</strong> is a Cloudflare Worker MCP server for API automation.</p>
      <p>The LLM plans and decides. The Worker validates requests, reads Cloudflare Secrets by name, calls external APIs, and returns compact structured results.</p>
    </section>
    <section class="card">
      <h2>Українською</h2>
      <p><strong>OneAIWorkers</strong> — це Cloudflare Worker MCP server для API-автоматизацій.</p>
      <p>LLM планує й приймає рішення. Worker валідує запити, читає Cloudflare Secrets за назвою, викликає зовнішні API і повертає компактні структуровані результати.</p>
    </section>
  </div>

  <section class="card">
    <h2>MCP endpoint</h2>
    <pre>${escapeHtml(mcpUrl)}</pre>
    <p><span class="ok">Recommended:</span> connect from ChatGPT with OAuth.</p>
    <p class="muted"><code>MCP_SHARED_SECRET</code> protects the OAuth approval page and manual API access. Do not put secrets in the URL.</p>
  </section>

  <section class="card">
    <h2>Connector engine</h2>
    <ul>
      <li>Saved connectors and actions are stored in D1.</li>
      <li>Supports GET, POST, PUT, PATCH, DELETE.</li>
      <li>Supports path/query/body templates such as <code>/workflows/{{id}}</code>.</li>
      <li>Supports API key, Bearer, Basic, OAuth refresh-token, OAuth client-credentials, and Google refresh-token style auth.</li>
      <li>Secrets are referenced by name and should be stored in Cloudflare Secrets.</li>
    </ul>
  </section>

  <section class="card">
    <h2>First MCP commands</h2>
    <pre>connector_setup_status
list_connectors { "include_actions": true }
test_connector { "connector_id": "n8n", "action_name": "list_workflows" }</pre>
    <p class="muted">Run setup status first. It shows D1 readiness, saved connectors, required secrets, and missing secrets without exposing values.</p>
  </section>

  <section class="card">
    <h2>Metadata</h2>
    <ul>
      <li><a href="${escapeHtml(baseUrl)}/.well-known/oneaiworkers">OneAIWorkers manifest</a></li>
      <li><a href="${escapeHtml(baseUrl)}/.well-known/oauth-protected-resource">OAuth protected resource metadata</a></li>
      <li><a href="${escapeHtml(baseUrl)}/.well-known/oauth-authorization-server">OAuth authorization server metadata</a></li>
    </ul>
  </section>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
