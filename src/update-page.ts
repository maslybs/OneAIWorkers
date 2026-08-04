import type { UpdateState } from "./update";

export function updatePageHtml(state: UpdateState, baseUrl: string): string {
  const startUrl = `${baseUrl}/update/start`;
  const copy = pageCopy(state);
  const isCurrent = state.status === "current";
  const action = state.status === "available" && state.update_service_url
    ? `<a class="button" href="${escapeHtml(startUrl)}">Увійти в Cloudflare та оновити</a>`
    : "";
  const notes = state.release_notes_url
    ? `<p><a href="${escapeHtml(state.release_notes_url)}" rel="noreferrer">Переглянути опис змін</a></p>`
    : "";

  return `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Оновлення OneAIWorkers</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f8fb; color: #172033; }
    main { max-width: 680px; margin: 64px auto; padding: 0 20px; }
    .card { background: white; border: 1px solid #e2e8f0; border-radius: 18px; padding: 28px; box-shadow: 0 16px 50px rgba(15, 23, 42, .08); }
    .versions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin: 22px 0; }
    .version { background: #f1f5f9; border-radius: 10px; padding: 10px 13px; font-weight: 700; }
    .current-version { margin: 0; color: #64748b; font-size: 1.1rem; }
    .button { display: inline-block; margin-top: 12px; padding: 12px 18px; border-radius: 10px; color: white; background: #f38020; text-decoration: none; font-weight: 750; }
    .muted { color: #64748b; }
    .safe { margin-top: 24px; padding: 14px; border-radius: 12px; background: #ecfdf5; color: #065f46; }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <h1>${escapeHtml(copy.title)}</h1>
      ${isCurrent
        ? `<p class="current-version">OneAIWorkers ${escapeHtml(state.current_version)}</p>`
        : `<p>${escapeHtml(copy.body)}</p>
          <div class="versions">
            <span class="version">Встановлено: ${escapeHtml(state.current_version)}</span>
            ${state.latest_version ? `<span aria-hidden="true">→</span><span class="version">Доступно: ${escapeHtml(state.latest_version)}</span>` : ""}
          </div>
          ${action}
          ${notes}
          <p class="safe">Секрети та ключі не передаються в посиланні. Перед зміною Worker Cloudflare попросить увійти й підтвердити дозвіл.</p>
          <p class="muted">Ця сторінка належить вашому встановленому OneAIWorkers: ${escapeHtml(baseUrl)}</p>`}
    </section>
  </main>
</body>
</html>`;
}

function pageCopy(state: UpdateState): { title: string; body: string } {
  if (state.status === "available" && state.update_service_url) {
    return {
      title: state.critical ? "Потрібне важливе оновлення" : "Доступне оновлення",
      body: state.message?.uk || "Можна встановити новішу версію OneAIWorkers.",
    };
  }
  if (state.status === "available") {
    return {
      title: "Оновлення знайдено",
      body: "Нова версія вже доступна, але служба безпечного оновлення ще не налаштована.",
    };
  }
  if (state.status === "current") {
    return { title: "У вас остання версія", body: "" };
  }
  if (state.status === "disabled") {
    return { title: "Перевірку вимкнено", body: "Цей Worker не перевіряє наявність нових версій." };
  }
  return { title: "Не вдалося перевірити версію", body: "Спробуйте відкрити цю сторінку трохи пізніше." };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
