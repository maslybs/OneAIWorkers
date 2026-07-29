import type { CloudflareAccount } from "./types";

export function landingHtml(name: string, message?: string): string {
  return page(
    name,
    `<main class="card">
      <span class="eyebrow">Просте встановлення</span>
      <h1>${escapeHtml(name)}</h1>
      <p class="lead">Власний захищений воркер у вашому Cloudflare без GitHub і без ручного створення бази.</p>
      ${message ? `<p class="notice">${escapeHtml(message)}</p>` : ""}
      <ol>
        <li>Увійдіть у Cloudflare.</li>
        <li>Виберіть свій обліковий запис.</li>
        <li>Натисніть «Встановити».</li>
      </ol>
      <a class="button" href="/oauth/start">Увійти через Cloudflare</a>
      <p class="small">Встановлювач отримає доступ лише для створення OneAIWorkers. Доступ буде відкликано після завершення.</p>
    </main>`,
  );
}

export function installHtml(name: string, accounts: CloudflareAccount[], csrf: string, error?: string): string {
  const options = accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join("");
  return page(
    `Встановлення ${name}`,
    `<main class="card">
      <span class="eyebrow">Крок 2 з 2</span>
      <h1>Куди встановити?</h1>
      <p class="lead">База D1 і секрет доступу будуть створені автоматично.</p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <form method="post" action="/install">
        <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
        <label>Обліковий запис Cloudflare
          <select name="account_id" required>${options}</select>
        </label>
        <label>Назва воркера
          <input name="script_name" value="oneaiworkers" minlength="3" maxlength="63" pattern="[a-z0-9][a-z0-9-]*[a-z0-9]" required>
        </label>
        <button class="button" type="submit">Встановити</button>
      </form>
      <p class="small">Якщо така назва вже зайнята, встановлювач нічого не перезапише.</p>
      <form method="post" action="/logout"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="link" type="submit">Скасувати й відкликати доступ</button></form>
    </main>`,
  );
}

export function successHtml(name: string, mcpUrl: string, sharedSecret: string): string {
  return page(
    `${name} встановлено`,
    `<main class="card success">
      <span class="eyebrow">Готово</span>
      <h1>${escapeHtml(name)} встановлено</h1>
      <p class="lead">Збережіть ці два значення зараз. Секрет більше не буде показано.</p>
      <label>Адреса для підключення<input readonly value="${escapeHtml(mcpUrl)}"></label>
      <label>Спільний секрет<input readonly value="${escapeHtml(sharedSecret)}"></label>
      <p class="notice">Під час підключення ChatGPT відкриє сторінку авторизації. Введіть там цей спільний секрет.</p>
      <a class="button secondary" href="${escapeHtml(mcpUrl.replace(/\/mcp$/u, ""))}">Відкрити свій воркер</a>
    </main>`,
  );
}

export function updateHtml(name: string, accounts: CloudflareAccount[], csrf: string, workerUrl: string, error?: string): string {
  const options = accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join("");
  return page(
    `Оновлення ${name}`,
    `<main class="card">
      <span class="eyebrow">Безпечне оновлення</span>
      <h1>Оновити свій воркер?</h1>
      <p class="lead">База D1, конектори та всі секрети залишаться без змін. Буде замінено лише код OneAIWorkers.</p>
      <p class="notice">${escapeHtml(workerUrl)}</p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <form method="post" action="/update">
        <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
        <label>Обліковий запис Cloudflare
          <select name="account_id" required>${options}</select>
        </label>
        <button class="button" type="submit">Оновити зараз</button>
      </form>
      <form method="post" action="/logout"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="link" type="submit">Скасувати й відкликати доступ</button></form>
    </main>`,
  );
}

export function updateSuccessHtml(name: string, workerUrl: string, version: string): string {
  return page(
    `${name} оновлено`,
    `<main class="card success">
      <span class="eyebrow">Готово</span>
      <h1>Оновлено до ${escapeHtml(version)}</h1>
      <p class="lead">Код замінено. База D1, конектори та секрети збережені.</p>
      <a class="button secondary" href="${escapeHtml(workerUrl)}/update">Повернутися до свого воркера</a>
    </main>`,
  );
}

export function errorHtml(name: string, message: string, retry = true): string {
  return page(
    `Помилка — ${name}`,
    `<main class="card"><span class="eyebrow">Не вдалося завершити</span><h1>Потрібна увага</h1><p class="error">${escapeHtml(message)}</p>${retry ? '<a class="button" href="/">Спробувати ще раз</a>' : ""}</main>`,
  );
}

function page(title: string, content: string): string {
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
  :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:#f4f5f1;color:#17211b}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px;background:radial-gradient(circle at top,#e4f4e9,transparent 48%),#f4f5f1}.card{width:min(620px,100%);background:#fff;border:1px solid #dce4dd;border-radius:24px;padding:clamp(24px,5vw,48px);box-shadow:0 20px 60px #1d3b2620}.eyebrow{font-size:.78rem;font-weight:750;letter-spacing:.09em;text-transform:uppercase;color:#237444}h1{font-size:clamp(2rem,7vw,3.4rem);line-height:1.02;margin:.55rem 0 1rem;letter-spacing:-.045em}.lead{font-size:1.12rem;line-height:1.55;color:#425148}ol{padding-left:1.35rem;line-height:1.8;margin:1.4rem 0}.button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:12px;background:#176b3a;color:white;text-decoration:none;font:inherit;font-weight:750;padding:.9rem 1.2rem;cursor:pointer;width:100%}.button:hover{background:#10542d}.secondary{margin-top:1rem;background:#24332a}.small{font-size:.86rem;line-height:1.45;color:#68766d;margin-top:1.1rem}.notice,.error{padding:.9rem 1rem;border-radius:12px;line-height:1.5}.notice{background:#eff8f1;color:#275937}.error{background:#fff0ef;color:#8b2823}form{display:grid;gap:1rem}label{display:grid;gap:.45rem;font-size:.9rem;font-weight:700}input,select{width:100%;border:1px solid #bdc9c0;border-radius:10px;padding:.8rem;background:white;color:#17211b;font:inherit}.link{border:0;background:none;color:#526259;text-decoration:underline;cursor:pointer;font:inherit;margin:.2rem auto}.success input{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.83rem}
  </style></head><body>${content}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
