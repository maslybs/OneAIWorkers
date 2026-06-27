# Deploy to Cloudflare / Встановлення через Deploy to Cloudflare

## English

The easiest way for non-technical users to install OneAIWorkers is the **Deploy to Cloudflare** button in the README.

Cloudflare's Deploy button works with a public GitHub/GitLab repository. It creates a copy of the project for the user, configures Workers Builds, and deploys the Worker to the user's own Cloudflare account.

## Українською

Найпростіший спосіб для нетехнічних користувачів встановити OneAIWorkers — кнопка **Deploy to Cloudflare** в README.

Cloudflare Deploy button працює з public GitHub/GitLab репозиторієм. Він створює копію проєкту для користувача, налаштовує Workers Builds і деплоїть Worker у власний Cloudflare account користувача.

---

## Deploy button / Кнопка деплою

The public repository is:

```text
https://github.com/maslybs/OneAIWorkers
```

Публічний репозиторій:

```text
https://github.com/maslybs/OneAIWorkers
```

The README button uses this URL:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers)
```

## User flow / Flow для користувача

1. Click **Deploy to Cloudflare**. / Натиснути **Deploy to Cloudflare**.
2. Sign in to Cloudflare. / Увійти в Cloudflare.
3. Authorize GitHub or GitLab if Cloudflare asks. / Авторизувати GitHub або GitLab, якщо Cloudflare попросить.
4. Let Cloudflare create/import the project. / Дати Cloudflare створити/import проєкт.
5. Wait for the Worker build and deploy. / Дочекатися build і deploy Worker.
6. Open the deployed Worker URL. / Відкрити URL задеплоєного Worker.
7. Copy the MCP endpoint. / Скопіювати MCP endpoint.

The MCP endpoint is:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

MCP endpoint виглядає так:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

## Optional private access / Опційний приватний доступ

By default, the Worker can be deployed without secrets. That is useful for a first test, but for personal/private usage users should set `MCP_SHARED_SECRET`.

За замовчуванням Worker можна задеплоїти без secrets. Це зручно для першого тесту, але для приватного використання варто задати `MCP_SHARED_SECRET`.

In Cloudflare dashboard:

1. Open the deployed Worker. / Відкрити задеплоєний Worker.
2. Go to **Settings**. / Перейти в **Settings**.
3. Open **Variables and Secrets**. / Відкрити **Variables and Secrets**.
4. Add a secret named `MCP_SHARED_SECRET`. / Додати secret з назвою `MCP_SHARED_SECRET`.
5. Redeploy if Cloudflare asks. / Redeploy, якщо Cloudflare попросить.

Then connect to:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

Після цього підключайтесь до:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

## Optional notifications / Опційні повідомлення

Notification tools work only after the user configures the relevant secrets.

Notification tools працюють тільки після того, як користувач налаштує відповідні secrets.

### Telegram

Required secrets / Потрібні secrets:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

### Discord

Required secret / Потрібний secret:

```text
DISCORD_WEBHOOK_URL
```

### Slack

Required secret / Потрібний secret:

```text
SLACK_WEBHOOK_URL
```

### Generic webhook

Required secret / Потрібний secret:

```text
DEFAULT_WEBHOOK_URL
```

These secrets are optional. Users can also pass an explicit `webhook_url` to `send_notification` or use `call_webhook` directly when their MCP client allows it.

Ці secrets опційні. Користувачі також можуть передати явний `webhook_url` у `send_notification` або напряму використовувати `call_webhook`, якщо MCP-клієнт це дозволяє.

## What this button does not solve yet / Чого ця кнопка ще не вирішує

The button deploys the Worker. It does not automatically connect ChatGPT, Telegram, Slack, Discord, or a CRM account.

Кнопка деплоїть Worker. Вона не підключає автоматично ChatGPT, Telegram, Slack, Discord або CRM account.

After deploy, users still need to:

- copy the `/mcp` URL into their MCP client;
- add optional secrets if they want private access or notifications;
- configure CRM/API integrations when those are added.

Після деплою користувачам ще потрібно:

- скопіювати `/mcp` URL у MCP-клієнт;
- додати optional secrets, якщо потрібен приватний доступ або повідомлення;
- налаштувати CRM/API integrations, коли вони будуть додані.
