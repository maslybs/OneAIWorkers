import type { CredentialField } from "./vault";
import type { InstalledPackageRow, MarketplaceItem, MarketplaceTarget } from "./marketplace";
import type { Env } from "./types";

type Language = "en" | "uk";

export function connectorInstallPageHtml(
  env: Env,
  baseUrl: string,
  item: MarketplaceItem,
  target: MarketplaceTarget,
  language: Language,
): string {
  const copy = language === "uk"
    ? {
        eyebrow: "Конектор з каталогу",
        title: `Підключити ${localized(item, language).name}`,
        description: localized(item, language).description,
        body: "Конектор буде встановлено у ваш Cloudflare та автоматично зʼявиться у цьому OneAIWorkers.",
        action: "Увійти в Cloudflare і встановити",
        safety: "Ваші ключі до сервісу вводяться пізніше на сторінці цього Worker. Каталог їх не отримує.",
      }
    : {
        eyebrow: "Marketplace connector",
        title: `Connect ${localized(item, language).name}`,
        description: localized(item, language).description,
        body: "The connector will be installed in your Cloudflare account and registered with this OneAIWorkers automatically.",
        action: "Sign in to Cloudflare and install",
        safety: "You will enter service credentials later on this Worker. The marketplace never receives them.",
      };
  const installerUrl = buildInstallerUrl(env, "install", baseUrl, item.id, language);
  return pageShell(language, copy.title, `
    <p class="eyebrow">${escapeHtml(copy.eyebrow)}</p>
    <h1>${escapeHtml(copy.title)}</h1>
    <p class="lead">${escapeHtml(copy.description)}</p>
    <p>${escapeHtml(copy.body)}</p>
    <div class="meta"><span>${escapeHtml(target.version)}</span>${(target.permissions || []).map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>
    <a class="button" href="${escapeHtml(installerUrl)}">${escapeHtml(copy.action)}</a>
    <p class="safe">${escapeHtml(copy.safety)}</p>
  `);
}

export function connectorUpdatePageHtml(
  env: Env,
  baseUrl: string,
  item: MarketplaceItem,
  target: MarketplaceTarget,
  installed: InstalledPackageRow,
  language: Language,
): string {
  const current = installed.installed_version;
  const copy = language === "uk"
    ? {
        eyebrow: "Оновлення конектора",
        title: `Оновити ${localized(item, language).name}`,
        body: `Встановлено ${current}. Доступно ${target.version}. Налаштування та ключі буде збережено.`,
        action: "Увійти в Cloudflare і оновити",
      }
    : {
        eyebrow: "Connector update",
        title: `Update ${localized(item, language).name}`,
        body: `Installed ${current}. Version ${target.version} is available. Your settings and credentials will be preserved.`,
        action: "Sign in to Cloudflare and update",
      };
  const installerUrl = buildInstallerUrl(env, "update", baseUrl, item.id, language);
  return pageShell(language, copy.title, `
    <p class="eyebrow">${escapeHtml(copy.eyebrow)}</p>
    <h1>${escapeHtml(copy.title)}</h1>
    <p class="lead">${escapeHtml(copy.body)}</p>
    <a class="button" href="${escapeHtml(installerUrl)}">${escapeHtml(copy.action)}</a>
  `);
}

export function connectorSetupPageHtml(
  connectorName: string,
  fields: CredentialField[],
  values: Record<string, string>,
  language: Language,
  error?: string,
  saved = false,
): string {
  const copy = language === "uk"
    ? {
        eyebrow: saved ? "Збережено" : "Безпечне налаштування",
        title: saved ? `${connectorName} готовий` : `Налаштувати ${connectorName}`,
        body: saved
          ? "Поверніться до ChatGPT, Claude або іншого MCP-клієнта. Конектор уже доступний через OneAIWorkers."
          : "Ці дані надсилаються лише вашому Worker і зберігаються у D1 у зашифрованому вигляді.",
        save: "Зберегти й перевірити",
        secretSaved: "Значення вже збережене. Залиште поле порожнім, щоб не змінювати його.",
        next: "У чаті попросіть показати встановлені конектори або одразу виконайте потрібну дію.",
      }
    : {
        eyebrow: saved ? "Saved" : "Secure setup",
        title: saved ? `${connectorName} is ready` : `Set up ${connectorName}`,
        body: saved
          ? "Return to ChatGPT, Claude, or another MCP client. The connector is now available through OneAIWorkers."
          : "These values are sent only to your Worker and stored encrypted in D1.",
        save: "Save and continue",
        secretSaved: "A value is already saved. Leave this empty to keep it.",
        next: "In your chat, ask to list installed connectors or continue with the task you wanted to complete.",
      };
  if (saved) {
    return pageShell(language, copy.title, `
      <p class="eyebrow">${escapeHtml(copy.eyebrow)}</p>
      <h1>${escapeHtml(copy.title)}</h1>
      <p class="lead">${escapeHtml(copy.body)}</p>
      <p class="safe">${escapeHtml(copy.next)}</p>
    `);
  }
  const controls = fields.map((field) => {
    const label = language === "uk" ? field.label_uk || field.label : field.label;
    const help = language === "uk" ? field.help_uk || field.help : field.help;
    const current = values[field.id] || "";
    const value = field.type === "secret" ? "" : current;
    const placeholder = field.type === "secret" && current ? copy.secretSaved : field.placeholder || "";
    return `<label>
      <span>${escapeHtml(label)}${field.required ? " *" : ""}</span>
      <input name="${escapeHtml(field.id)}" type="${field.type === "secret" ? "password" : field.type === "url" ? "url" : "text"}"
        value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${field.required && !current ? "required" : ""} autocomplete="off" />
      ${help ? `<small>${escapeHtml(help)}</small>` : ""}
    </label>`;
  }).join("");
  return pageShell(language, copy.title, `
    <p class="eyebrow">${escapeHtml(copy.eyebrow)}</p>
    <h1>${escapeHtml(copy.title)}</h1>
    <p class="lead">${escapeHtml(copy.body)}</p>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <form method="post">
      <input type="hidden" name="lang" value="${language}" />
      ${controls || `<p class="safe">${language === "uk" ? "Цей конектор не потребує додаткових ключів." : "This connector needs no additional credentials."}</p>`}
      <button class="button" type="submit">${escapeHtml(copy.save)}</button>
    </form>
  `);
}

export function connectorPageHeaders(): HeadersInit {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

export function pageLanguage(url: URL, request?: Request): Language {
  const query = url.searchParams.get("lang");
  if (query === "uk" || query === "en") return query;
  const cookie = request?.headers.get("cookie") || "";
  return /(?:^|;\s*)oneaiworkers_lang=uk(?:;|$)/.test(cookie) ? "uk" : "en";
}

function buildInstallerUrl(env: Env, operation: "install" | "update", baseUrl: string, packageId: string, language: Language): string {
  const installerBase = String(env.CONNECTOR_INSTALLER_URL || env.UPDATE_SERVICE_URL || "https://workers.bgdn.dev").replace(/\/+$/g, "");
  const url = new URL(`${installerBase}/connector/start`);
  url.searchParams.set("operation", operation);
  url.searchParams.set("target", baseUrl);
  url.searchParams.set("package", packageId);
  url.searchParams.set("lang", language);
  return url.toString();
}

function localized(item: MarketplaceItem, language: Language): { name: string; description: string } {
  return {
    name: item.locales?.[language]?.name || item.name,
    description: item.locales?.[language]?.description || item.description,
  };
}

function pageShell(language: Language, title: string, content: string): string {
  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f3f6fb; color: #111318; }
    main { width: min(720px, 100%); background: #fff; border: 1px solid #dce3ee; border-radius: 24px; padding: clamp(28px, 6vw, 56px); box-shadow: 0 24px 80px rgba(31, 43, 65, .08); }
    h1 { margin: 8px 0 20px; font-size: clamp(38px, 7vw, 68px); line-height: .98; letter-spacing: -.055em; }
    p { line-height: 1.6; }
    .eyebrow { color: #1767dc; font-size: 13px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
    .lead { color: #5c6678; font-size: 19px; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0; }
    .meta span { border-radius: 999px; background: #eef4ff; color: #244d88; padding: 7px 11px; font-size: 13px; }
    .button { width: 100%; display: block; border: 0; border-radius: 13px; padding: 16px 20px; margin-top: 24px; color: #fff; background: #1767dc; text-align: center; text-decoration: none; font: inherit; font-weight: 800; cursor: pointer; }
    .safe { margin-top: 24px; padding: 16px; border-radius: 14px; background: #edf9f2; color: #155c38; }
    .error { padding: 14px; border-radius: 12px; background: #fff0f0; color: #922d25; }
    form { display: grid; gap: 18px; margin-top: 28px; }
    label { display: grid; gap: 8px; font-weight: 750; }
    input { width: 100%; border: 1px solid #bdc8d8; border-radius: 12px; padding: 14px; font: inherit; }
    small { color: #687386; font-weight: 450; line-height: 1.45; }
  </style>
</head>
<body><main>${content}</main></body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
