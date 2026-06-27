# AI Action Hub Worker

## English

A small Cloudflare Worker that exposes a remote MCP server for LLM-triggered automations.

The model is intentionally simple:

```text
LLM = memory + schedule + reasoning
Worker = safe action executor
```

You deploy one Worker, connect its `/mcp` URL to ChatGPT or another MCP client, and let your scheduled LLM call a small set of useful actions.

This project does **not** promise that AI can safely automate everything. It gives your AI controlled tools for simple, practical workflows.

## Українською

Невеликий Cloudflare Worker, який надає remote MCP server для LLM-автоматизацій.

Модель спеціально проста:

```text
LLM = памʼять + розклад + reasoning
Worker = безпечний executor дій
```

Ви деплоїте один Worker, підключаєте його `/mcp` URL до ChatGPT або іншого MCP-клієнта, і ваша scheduled LLM викликає невеликий набір корисних дій.

Цей проєкт **не обіцяє**, що AI може безпечно автоматизувати все. Він дає вашому AI контрольовані tools для простих практичних workflow.

---

## What it can do / Що він вміє

### Observe / Спостерігати

- Fetch a public web page and return clean text. / Отримати публічну web page і повернути чистий текст.
- Fetch several public URLs in one call. / Отримати кілька публічних URL за один виклик.
- Read RSS/Atom feeds. / Читати RSS/Atom feeds.
- Check whether a public website/API is reachable. / Перевіряти, чи доступний публічний сайт/API.

### Act / Діяти

- Send notifications to Telegram, Discord, Slack, or a generic webhook. / Надсилати повідомлення в Telegram, Discord, Slack або generic webhook.
- Call Make, Zapier, n8n, Discord, Slack, or custom HTTPS webhooks. / Викликати Make, Zapier, n8n, Discord, Slack або власні HTTPS webhooks.

### Optional Worker factory / Опційна Worker factory

- Deploy a child Cloudflare Worker from a safe template. / Деплоїти дочірній Cloudflare Worker з безпечного template.
- Current template: `webhook-forwarder`. / Поточний template: `webhook-forwarder`.
- Arbitrary JavaScript deployment is intentionally not exposed as an MCP tool. / Деплой довільного JavaScript навмисно не доступний як MCP tool.

## What it does not do / Чого він не робить

- It does not store memory for the LLM. / Він не зберігає памʼять для LLM.
- It does not include KV, D1, queues, or workflow storage. / Він не містить KV, D1, queues або workflow storage.
- It does not accept arbitrary AI-generated JavaScript for deployment. / Він не приймає довільний AI-generated JavaScript для деплою.
- It does not provide OAuth or multi-user SaaS security out of the box. / Він не надає OAuth або multi-user SaaS security з коробки.

## MCP tools / MCP tools

```text
hub_info
fetch_url
fetch_many_urls
fetch_rss
check_url_status
send_notification
call_webhook
create_child_worker_from_template
```

## Good first automations / Хороші перші автоматизації

```text
Every morning at 9:00, use AI Action Hub to fetch these competitor pricing pages. Keep the previous snapshot in your own memory and notify me if something important changed.

Щоранку о 9:00 використовуй AI Action Hub, щоб отримати ці pricing pages конкурентів. Тримай попередній snapshot у своїй памʼяті й повідомляй мене, якщо змінилось щось важливе.
```

```text
Every 30 minutes, check my website and contact form endpoint. If either fails twice in a row, notify me.

Кожні 30 хвилин перевіряй мій сайт і endpoint контактної форми. Якщо щось падає двічі підряд, повідом мене.
```

```text
Every Monday at 09:00, call this Make/Zapier/n8n webhook with this JSON payload. If it fails, notify me.

Щопонеділка о 09:00 викликай цей Make/Zapier/n8n webhook з цим JSON payload. Якщо виклик не вдався, повідом мене.
```

## Files / Файли

```text
src/index.ts              Worker entrypoint and HTTP routes / entrypoint Worker і HTTP routes
src/server.ts             MCP tool registration / реєстрація MCP tools
src/tools/observe.ts      fetch_url, fetch_rss, check_url_status
src/tools/notify.ts       notifications and generic webhooks / notifications і generic webhooks
src/tools/factory.ts      safe child Worker factory / безпечна factory дочірніх Workers
src/security.ts           URL and key safety helpers / helpers для безпеки URL і ключів
docs/INSTALL.md           setup guide / інструкція встановлення
docs/SECURITY.md          security notes / нотатки з безпеки
docs/TOOLS.md             tool reference / довідник tools
examples/prompts.md       prompts for scheduled LLM usage / prompts для scheduled LLM
```

## MCP endpoint / MCP endpoint

After deployment your MCP endpoint will be: / Після деплою ваш MCP endpoint буде:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

If you configure `MCP_SHARED_SECRET`, use: / Якщо ви налаштували `MCP_SHARED_SECRET`, використовуйте:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

Some MCP clients can send `Authorization: Bearer YOUR_SECRET`; some cannot. The query-string mode exists for easier personal setup, but OAuth or Cloudflare Access is a better long-term option for public usage.

Деякі MCP-клієнти можуть надсилати `Authorization: Bearer YOUR_SECRET`, а деякі — ні. Query-string режим існує для простішого персонального setup, але OAuth або Cloudflare Access краще підходять для публічного використання.

## License / Ліцензія

MIT
