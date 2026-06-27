# Нотатки з безпеки

[Англійська версія](SECURITY.md)

OneAIWorkers дає LLM tools, які можуть отримувати публічні URL і запускати зовнішні notifications або webhooks. Ставтесь до цього як до реальної automation infrastructure.

## Базові дизайн-рішення

- Tool для деплою довільного JavaScript не відкритий.
- Дочірні Workers можуть деплоїтись тільки з predefined templates.
- Outbound fetches блокують local, private і loopback hosts.
- Raw IPv6 hosts заблоковані за замовчуванням, щоб зменшити SSRF-ризик.
- KV, D1 або database storage за замовчуванням не включені.
- Secrets мають зберігатися як Cloudflare Worker secrets.
- Tool results маскують чутливі query parameters в URL: `token`, `key`, `secret`, `password`, `auth`, `signature`.

## Доступ до MCP

Для персонального використання можна задати `MCP_SHARED_SECRET`. Worker приймає secret через:

- `Authorization: Bearer <secret>`;
- `x-oneaiworkers-token: <secret>`;
- `?key=<secret>` або `?access_token=<secret>`.

Query-string режим зручний для клієнтів, які не можуть задавати custom headers. Він не ідеальний для high-security production, бо URL можуть потрапляти в logs або browser history.

Для публічних додатків краще використовувати справжній OAuth flow або Cloudflare Access.

## Cloudflare API token

Налаштовуйте `CF_API_TOKEN` тільки якщо потрібне створення дочірніх Workers.

Використовуйте scoped API token з мінімальними permissions. Не використовуйте global Cloudflare API key.

Token має бути доступний тільки як Worker secret і не має повертатися в tool results, logs або notifications.

## Попередження про template дочірнього Worker

Перший template дочірнього Worker, `webhook-forwarder`, вбудовує target URL у source згенерованого Worker. Не використовуйте його з дуже чутливими URL, поки не додасте сильнішу модель rotation secrets.

## Webhooks і notifications

Notification tools мають side effects. ChatGPT та інші MCP-клієнти можуть просити підтвердження залежно від permission settings і tool metadata, але prompts все одно треба формувати обережно.

Рекомендований pattern:

1. Отримати, перевірити або прочитати дані.
2. Дати LLM це інтерпретувати.
3. Надсилати notification або викликати webhook тільки коли умова зрозуміла.
4. Дати LLM зберегти памʼять про те, що сталося.

## Не рекомендовано для першої версії

Уникайте цього, поки не додасте нормальні approvals і policies:

- payments або refunds;
- видалення production data;
- автоматична відправка emails клієнтам;
- публікація в соцмережі без human review;
- виконання довільного LLM-generated code.
