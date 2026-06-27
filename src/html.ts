import type { Env } from "./types";

export function homeHtml(env: Env, baseUrl: string): string {
  const title = env.HUB_NAME || "OneAIWorkers";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; max-width: 920px; margin: 48px auto; padding: 0 20px; color: #172033; }
    code, pre { background: #f4f6f8; border-radius: 8px; }
    code { padding: 2px 5px; }
    pre { padding: 14px; overflow: auto; }
    .card { border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px; margin: 18px 0; }
    .muted { color: #64748b; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="grid">
    <section class="card">
      <h2>English</h2>
      <p>This Cloudflare Worker exposes a personal remote MCP server for LLM-triggered automations.</p>
      <p>The LLM owns memory, scheduling, and decisions. This Worker only executes controlled actions.</p>
    </section>
    <section class="card">
      <h2>Українською</h2>
      <p>Цей Cloudflare Worker надає персональний remote MCP server для LLM-автоматизацій.</p>
      <p>LLM відповідає за памʼять, розклад і рішення. Цей Worker лише виконує контрольовані дії.</p>
    </section>
  </div>
  <div class="card">
    <h2>MCP endpoint</h2>
    <pre>${escapeHtml(baseUrl)}/mcp</pre>
    <p class="muted">If you configured <code>MCP_SHARED_SECRET</code>, append <code>?key=YOUR_SECRET</code> or use a Bearer token. / Якщо ви налаштували <code>MCP_SHARED_SECRET</code>, додайте <code>?key=YOUR_SECRET</code> або використовуйте Bearer token.</p>
  </div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
