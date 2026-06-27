# OneAIWorkers

[English version](README.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers)

OneAIWorkers дає вашому AI-помічнику безпечні “руки”.

AI-помічник може читати, думати, памʼятати, планувати й вирішувати. OneAIWorkers дає йому безпечний спосіб робити реальні дії: перевірити сайт, прочитати RSS, надіслати повідомлення в Telegram, викликати webhook, підключитися до API або створити окремий Worker для спеціальної задачі.

Ви підключаєте один MCP URL до ChatGPT або іншого MCP-клієнта. За цим одним URL OneAIWorkers може показувати багато інструментів і конекторів.

```text
AI-помічник → OneAIWorkers MCP → ваші інструменти, API, webhooks і child Workers
```

## Коли це корисно

OneAIWorkers корисний, коли ви хочете, щоб AI-помічник робив невеликі реальні задачі, але без прямого доступу до всього підряд.

Приклади:

```text
Перевіряй мій сайт щоранку і напиши в Telegram, якщо він не працює.
```

```text
Читай цю RSS-стрічку і надсилай мені тільки важливі новини.
```

```text
Коли я попрошу, створи ліда в моїй CRM через її API.
```

```text
Надішли webhook у Make, Zapier або n8n, коли клієнт заповнить форму.
```

```text
Створи невеликий Worker, який парсить сторінку і повертає чисті дані.
```

```text
Створи простого бота або API-міст як окремий child Worker.
```

Ідея не в тому, щоб замінити AI-помічника. Ідея в тому, щоб дати йому безпечний шар для дій.

## Як це працює

OneAIWorkers має два режими.

### 1. Базовий режим

Це основний режим. Він працює після встановлення через кнопку.

Основний Worker зберігає налаштування конекторів у D1 і сам виконує API-запити.

Використовуйте це для:

```text
REST API
CRM
платіжних систем
webhooks
повідомлень у Telegram, Discord, Slack
простих внутрішніх інструментів
Make, Zapier, n8n
```

AI не має знати ваші справжні API-ключі. Він знає тільки назву secret.

Приклад:

```text
Назва secret: CRM_API_TOKEN
Справжнє значення: сховане в Cloudflare Secrets
```

Конектор може мати таке налаштування:

```json
{
  "auth": {
    "type": "bearer_secret",
    "secret_name": "CRM_API_TOKEN"
  }
}
```

OneAIWorkers читає справжній secret тільки тоді, коли робить API-запит.

### 2. Розширений режим: Worker Builder

Цей режим потрібен для спеціальних випадків.

Основний Worker може створити окремий child Worker через Cloudflare API. Це корисно, якщо конектору потрібен власний код, власний публічний endpoint, логіка бота, парсер або нестандартна поведінка.

Використовуйте це для:

```text
кастомних ботів
кастомних парсерів
окремих webhook-приймачів
API-мостів зі складною логікою
інструментів, які краще ізолювати від основного Worker
```

Для цього режиму потрібні:

```text
CF_ACCOUNT_ID
CF_API_TOKEN
CF_WORKERS_DEV_SUBDOMAIN опційно
```

Вони не потрібні для першого запуску. Додавайте їх тільки тоді, коли хочете, щоб OneAIWorkers створював додаткові Workers.

Кастомний код треба переглянути перед розгортанням. OneAIWorkers блокує деякі небезпечні JavaScript-патерни, але це не повна перевірка безпеки. Worker Builder — це розширена можливість.

## Що створюється під час встановлення

Кнопка розгортає основний Worker.

Cloudflare також може створити D1 базу з `wrangler.toml`.

D1 база використовується для:

```text
OAuth-клієнтів
OAuth-токенів
реєстру конекторів
дій конекторів
записів аудиту
```

Вона не використовується як памʼять AI. Памʼять і розклад тримає ваш AI-помічник. OneAIWorkers зберігає тільки налаштування, потрібні для роботи.

## Швидкий старт

### Крок 1. Розгорніть

Натисніть кнопку:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers)

Cloudflare попросить підключити ваш обліковий запис і розгорнути Worker.

Під час розгортання ви можете побачити опційні поля. Їх можна залишити порожніми і додати пізніше.

Рекомендоване поле:

```text
MCP_SHARED_SECRET
```

Опційні поля:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
DISCORD_WEBHOOK_URL
SLACK_WEBHOOK_URL
DEFAULT_WEBHOOK_URL
CF_ACCOUNT_ID
CF_API_TOKEN
CF_WORKERS_DEV_SUBDOMAIN
PUBLIC_BASE_URL
```

### Крок 2. Додайте спільний секрет

Це рекомендовано.

`MCP_SHARED_SECRET` — це приватний пароль. OneAIWorkers просить його під час OAuth-підключення. Його також можна використати для ручного доступу через `?key=`.

Використовуйте довге випадкове значення.

Його можна додати під час розгортання або пізніше в Cloudflare:

```text
Cloudflare dashboard
→ Workers & Pages
→ ваш OneAIWorkers Worker
→ Settings
→ Variables and Secrets
→ Add Secret
```

### Крок 3. Підключіть ChatGPT

У ChatGPT Developer Mode додайте custom MCP app.

Використовуйте:

```text
Authentication: OAuth
Server URL: https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

Не додавайте `?key=`, якщо використовуєте OAuth.

Коли ChatGPT відкриє сторінку підключення, введіть `MCP_SHARED_SECRET`, якщо ви його задали.

### Крок 4. Перевірте стан

Після підключення напишіть:

```text
Show OneAIWorkers status.
```

AI має викликати `hub_info` і показати, що вже налаштовано.

## Вбудовані інструменти

OneAIWorkers має такі інструменти:

```text
hub_info
fetch_url
fetch_many_urls
fetch_rss
check_url_status
send_notification
call_webhook
save_connector
list_connectors
test_connector
call_connector_tool
delete_connector
create_child_worker_from_template
deploy_custom_child_worker
```

## Приклад базового конектора

Уявімо, що у вас є CRM API.

Документація CRM каже:

```text
POST https://api.example-crm.com/v1/leads
Authorization: Bearer YOUR_API_TOKEN
Body: { "name": "...", "email": "..." }
```

Спочатку додайте справжній API token у Cloudflare Secrets:

```text
CRM_API_TOKEN = справжній token з CRM
```

Потім скажіть AI-помічнику:

```text
Створи OneAIWorkers конектор crm.
У ньому має бути дія create_lead.
Використай POST https://api.example-crm.com/v1/leads.
Авторизація: bearer_secret з secret_name CRM_API_TOKEN.
Поля body: name і email.
```

AI може створити цей конектор через `save_connector`.

Після цього можна сказати:

```text
Створи CRM ліда Anna Smith, anna@example.com.
```

AI викличе:

```text
call_connector_tool
connector_id: crm
action_name: create_lead
input: { name: "Anna Smith", email: "anna@example.com" }
```

OneAIWorkers надішле запит у CRM. Справжній API token залишиться схованим у Cloudflare Secrets.

## Приклад child Worker

Використовуйте child Workers тільки тоді, коли простого API-конектора недостатньо.

Приклади задач:

```text
Зроби невеликий парсер, який читає сторінку і повертає чисті дані про товари.
```

```text
Зроби webhook-приймач, який перевіряє підпис і потім викликає інший API.
```

```text
Зроби простий endpoint для бота з кастомною логікою.
```

Щоб увімкнути цей режим, додайте до основного Worker:

```text
CF_ACCOUNT_ID
CF_API_TOKEN
CF_WORKERS_DEV_SUBDOMAIN опційно
```

Потім скажіть AI:

```text
Створи child Worker для цього парсера.
Покажи мені код і поясни, що він робить, перед розгортанням.
```

Після перевірки AI може викликати `deploy_custom_child_worker`.

Child Worker має такі адреси:

```text
/health
/tools/list
/tools/call
```

Потім збережіть його як конектор через `save_connector` з такими полями:

```text
mode: child_worker
child_worker_url: https://child-worker.your-subdomain.workers.dev
child_worker_token_secret: CHILD_WORKER_TOKEN
```

Child token показується один раз після розгортання. Збережіть його як Cloudflare Secret, наприклад:

```text
CHILD_WORKER_TOKEN
```

Після цього основний Worker зможе передавати виклики в child Worker.

## Повідомлення

Telegram потребує:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

Discord потребує:

```text
DISCORD_WEBHOOK_URL
```

Slack потребує:

```text
SLACK_WEBHOOK_URL
```

Generic webhook потребує:

```text
DEFAULT_WEBHOOK_URL
```

Ці значення можна додати під час розгортання або пізніше в Cloudflare settings.

## Модель безпеки

OneAIWorkers дотримується простих правил:

```text
Secrets залишаються в Cloudflare Secrets.
AI бачить назви secrets, а не їхні значення.
Дозволені тільки HTTPS URL.
Локальні й приватні мережеві адреси заблоковані.
Дії конекторів зберігаються в D1.
OAuth-токени зберігаються в D1.
Child Workers опційні.
Кастомний код child Worker треба переглянути перед розгортанням.
```

Для простого API використовуйте базові конектори.

Для нестандартної логіки використовуйте child Workers.

## Локальна розробка

```bash
npm install
npm run dev
```

Для локальних secrets скопіюйте:

```bash
cp .dev.vars.example .dev.vars
```

Потім заповніть тільки потрібні значення.

Перевірка типів:

```bash
npm run typecheck
```

Ручне розгортання:

```bash
npm run deploy
```

## Рекомендоване перше налаштування

Почніть з цього:

```text
MCP_SHARED_SECRET
```

Потім підключіть ChatGPT через OAuth.

Додавайте інтеграції тільки тоді, коли вони потрібні:

```text
Telegram повідомлення → TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
Discord повідомлення → DISCORD_WEBHOOK_URL
Slack повідомлення → SLACK_WEBHOOK_URL
Make/Zapier/n8n → DEFAULT_WEBHOOK_URL або збережений конектор
Кастомний API → додайте API secret, потім створіть конектор
Кастомний код → увімкніть Worker Builder
```

## Ліцензія

MIT
