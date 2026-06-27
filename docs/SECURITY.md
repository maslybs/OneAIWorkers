# Security notes / Нотатки з безпеки

## English

OneAIWorkers gives an LLM tools that can fetch public URLs and trigger external notifications/webhooks. Treat it as real automation infrastructure.

## Українською

OneAIWorkers дає LLM tools, які можуть отримувати публічні URL і запускати зовнішні notifications/webhooks. Ставтесь до цього як до реальної automation infrastructure.

---

## Default design choices / Базові дизайн-рішення

- No arbitrary JavaScript deployment tool is exposed. / Tool для деплою довільного JavaScript не відкритий.
- Child Workers can only be deployed from predefined templates. / Дочірні Workers можуть деплоїтись тільки з predefined templates.
- Outbound fetches block local/private/loopback hosts. / Outbound fetches блокують local/private/loopback hosts.
- Raw IPv6 hosts are blocked by default to reduce SSRF risk. / Raw IPv6 hosts заблоковані за замовчуванням, щоб зменшити SSRF-ризик.
- No KV/D1/database storage is included by default. / KV/D1/database storage за замовчуванням не включені.
- Secrets are expected to be stored as Cloudflare Worker secrets. / Secrets мають зберігатися як Cloudflare Worker secrets.
- Tool results redact sensitive URL query parameters like `token`, `key`, `secret`, `password`, `auth`, and `signature`. / Tool results маскують чутливі query parameters в URL: `token`, `key`, `secret`, `password`, `auth`, `signature`.

## MCP access / Доступ до MCP

For personal use you can set `MCP_SHARED_SECRET`. The Worker accepts the secret in:

Для персонального використання можна задати `MCP_SHARED_SECRET`. Worker приймає secret через:

- `Authorization: Bearer <secret>`;
- `x-oneaiworkers-token: <secret>`;
- `?key=<secret>` or / або `?access_token=<secret>`.

The query-string mode is convenient for clients that cannot set custom headers. It is not ideal for high-security production because URLs can appear in logs or browser history.

Query-string режим зручний для клієнтів, які не можуть задавати custom headers. Він не ідеальний для high-security production, бо URL можуть потрапляти в logs або browser history.

For public apps, prefer a real OAuth flow or Cloudflare Access.

Для публічних додатків краще використовувати справжній OAuth flow або Cloudflare Access.

## Cloudflare API token / Cloudflare API token

Only configure `CF_API_TOKEN` if you need child Worker creation.

Налаштовуйте `CF_API_TOKEN` тільки якщо потрібне створення дочірніх Workers.

Use a scoped API token with minimum permissions. Do not use your global Cloudflare API key.

Використовуйте scoped API token з мінімальними permissions. Не використовуйте global Cloudflare API key.

The token should only be available as a Worker secret and should never be returned in tool results, logs, or notifications.

Token має бути доступний тільки як Worker secret і не має повертатися в tool results, logs або notifications.

## Child Worker template warning / Попередження про template дочірнього Worker

The first child Worker template, `webhook-forwarder`, embeds its target URL in the generated Worker source. Do not use it with highly sensitive URLs until you add a stronger secret rotation model.

Перший template дочірнього Worker, `webhook-forwarder`, вбудовує target URL у source згенерованого Worker. Не використовуйте його з дуже чутливими URL, поки не додасте сильнішу модель rotation secrets.

## Webhooks and notifications / Webhooks і notifications

Notification tools have side effects. ChatGPT and other MCP clients may ask for confirmation depending on the client's permission settings and tool metadata, but you should still design prompts carefully.

Notification tools мають side effects. ChatGPT та інші MCP-клієнти можуть просити підтвердження залежно від permission settings і tool metadata, але prompts все одно треба формувати обережно.

Recommended pattern / Рекомендований pattern:

1. Fetch/check/read data. / Отримати/перевірити/прочитати дані.
2. Let the LLM interpret it. / Дати LLM це інтерпретувати.
3. Notify or call a webhook only when the condition is clear. / Надсилати notification або викликати webhook тільки коли умова зрозуміла.
4. Let the LLM keep memory of what happened. / Дати LLM зберегти памʼять про те, що сталося.

## Not recommended for the first version / Не рекомендовано для першої версії

Avoid these until you add proper approvals and policies:

Уникайте цього, поки не додасте нормальні approvals і policies:

- payments/refunds; / payments/refunds;
- deleting production data; / видалення production data;
- sending emails to customers automatically; / автоматична відправка emails клієнтам;
- posting publicly to social media without human review; / публікація в соцмережі без human review;
- executing arbitrary LLM-generated code. / виконання довільного LLM-generated code.
