import type { Env } from "./types";
import { APP_VERSION } from "./update";

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
  <p class="muted">A private MCP gateway with installable plugins for ChatGPT, Claude, and other MCP-compatible clients.</p>
  <p class="muted">Version ${escapeHtml(APP_VERSION)}</p>

  <div class="grid">
    <section class="card">
      <h2>English</h2>
      <p><strong>OneAIWorkers</strong> gives your AI client one private place to use installed plugins.</p>
      <p>It finds the needed action, checks access, asks for confirmation when needed, and keeps service keys out of chat.</p>
    </section>
    <section class="card">
      <h2>Українською</h2>
      <p><strong>OneAIWorkers</strong> дає вашому ШІ-клієнту одне приватне місце для роботи зі встановленими плагінами.</p>
      <p>Він знаходить потрібну дію, перевіряє доступ, просить підтвердження за потреби та не передає ключі сервісів у чат.</p>
    </section>
  </div>

  <section class="card">
    <h2>MCP endpoint</h2>
    <pre>${escapeHtml(mcpUrl)}</pre>
    <p><span class="ok">Recommended:</span> connect ChatGPT, Claude, or another compatible client with OAuth.</p>
    <p class="muted">Compatible with remote MCP clients that support Streamable HTTP and OAuth or Bearer authentication.</p>
    <p class="muted"><code>MCP_SHARED_SECRET</code> protects the OAuth approval page and manual API access. Do not put secrets in the URL.</p>
  </section>

  <section class="card">
    <h2>Plugin registry</h2>
    <ul>
      <li>Installed plugins, versions, permissions, schemas, and search data are stored in D1.</li>
      <li>The client always sees the same six gateway commands.</li>
      <li>Installing or updating a plugin does not require a new MCP tool list.</li>
      <li>Service keys are encrypted before D1 storage.</li>
      <li>Large results are saved temporarily and read only in needed parts.</li>
    </ul>
  </section>

  <section class="card">
    <h2>First MCP command</h2>
    <pre>w_search { "query": "inspect n8n workflow failures" }</pre>
    <p class="muted">Use an empty query for a short overview. The client loads full schemas only after it chooses an exact versioned action.</p>
  </section>

  <section class="card">
    <h2>Оновлення / Updates</h2>
    <p>Перевірити встановлену версію та наявність оновлень можна на сторінці вашого Worker.</p>
    <p><a href="${escapeHtml(baseUrl)}/update">Відкрити сторінку оновлення</a></p>
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
