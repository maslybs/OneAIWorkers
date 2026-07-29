# Встановлювач без GitHub

[Англійська версія](INSTALLER.md)

Цей проєкт містить окремий центральний встановлювач. Його один раз налаштовує власник OneAIWorkers. Звичайний користувач після цього не бачить GitHub, не створює базу D1 і не вводить секрет вручну.

## Що бачить користувач

1. Відкриває вашу сторінку встановлення.
2. Натискає **Увійти через Cloudflare**.
3. Підтверджує обмежені дозволи.
4. Вибирає обліковий запис і натискає **Встановити**.
5. Отримує адресу `/mcp` і спільний секрет.

Встановлювач автоматично:

- створює окрему базу D1;
- створює довгий випадковий `MCP_SHARED_SECRET`;
- завантажує поточну версію OneAIWorkers;
- вмикає адресу `workers.dev`;
- відкликає тимчасовий доступ Cloudflare після завершення.

Той самий встановлювач обробляє майбутні оновлення. Він перевіряє, що адреса `workers.dev` належить вибраному обліковому запису і що воркер має обовʼязкові привʼязки OneAIWorkers. Під час оновлення замінюється лише код; база D1, конектори та секрети успадковуються Cloudflare без розкриття їхніх значень.

Якщо воркер із вибраною назвою вже існує, встановлювач його не перезаписує. Якщо встановлення обривається, він намагається прибрати тільки базу і воркер, які щойно створив сам.

## Одноразове налаштування власником проєкту

Для публічного встановлювача потрібна стабільна адреса на вашому домені. Наприклад:

```text
https://install.example.com
```

У Cloudflare створіть серверний OAuth-клієнт:

```text
Response type: code
Grant type: authorization_code
Token authentication: client_secret_basic
Redirect URL: https://install.example.com/oauth/callback
```

Додайте тільки потрібні дозволи:

```text
Account Settings Read
Workers Scripts Read
Workers Scripts Write
D1 Write
```

Щоб ним могли користуватись інші облікові записи Cloudflare, клієнт має бути публічним. Cloudflare попросить підтвердити право на домен сторінки встановлення.

У [`wrangler.installer.toml`](../wrangler.installer.toml) задайте адресу і власний домен:

```toml
PUBLIC_BASE_URL = "https://install.example.com"
routes = [{ pattern = "install.example.com", custom_domain = true }]
```

Спочатку розгорніть встановлювач, щоб Cloudflare створив його:

```bash
npm run deploy:installer
```

Потім додайте три секрети. Не записуйте їх у Git:

```bash
npx wrangler secret put CF_OAUTH_CLIENT_ID --config wrangler.installer.toml
npx wrangler secret put CF_OAUTH_CLIENT_SECRET --config wrangler.installer.toml
npx wrangler secret put INSTALLER_SESSION_SECRET --config wrangler.installer.toml
```

`INSTALLER_SESSION_SECRET` має бути випадковим значенням щонайменше з 32 знаків.

Після додавання секретів перевірте остаточне розгортання:

```bash
npm run deploy:installer
```

Після цього поставте адресу встановлювача головною кнопкою у README або на вашому сайті. Стара кнопка **Deploy to Cloudflare** може залишитися лише як додатковий спосіб для технічних користувачів, бо вона вимагає GitHub або GitLab.

Для оновлення раніше встановлених воркерів додайте адресу до [`update-manifest.json`](../update-manifest.json) під час наступного випуску:

```json
"update_service_url": "https://install.example.com/update/start"
```

Нові воркери, створені встановлювачем, уже отримують цю адресу автоматично.

## Що не зберігається

Встановлювач не має власної бази користувачів. Тимчасовий доступ Cloudflare лежить лише в зашифрованому `HttpOnly` файлі сеансу до 15 хвилин. Після успішного встановлення він відкликається, а файл сеансу видаляється.

Спільний секрет показується користувачу один раз. У код, адресу та журнал встановлювача він не потрапляє.

## Місцева перевірка

Спочатку створіть зібраний код клієнського воркера:

```bash
npm run build:installer
```

Потім запустіть:

```bash
npm run dev:installer
```

Для повної перевірки входу адреса з налаштувань OAuth-клієнта має точно збігатися з `PUBLIC_BASE_URL`.
