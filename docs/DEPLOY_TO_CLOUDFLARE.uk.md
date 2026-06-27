# Встановлення через Deploy to Cloudflare

[Англійська версія](DEPLOY_TO_CLOUDFLARE.md)

Найпростіший спосіб для нетехнічних користувачів встановити OneAIWorkers — кнопка **Deploy to Cloudflare** в README.

Cloudflare Deploy button працює з публічним GitHub або GitLab репозиторієм. Він імпортує проєкт, налаштовує Workers Builds і деплоїть Worker у власний Cloudflare account користувача.

## Кнопка деплою

Публічний репозиторій:

```text
https://github.com/maslybs/OneAIWorkers
```

Кнопка в README використовує цей URL:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers)
```

## Flow для користувача

1. Натиснути **Deploy to Cloudflare**.
2. Увійти в Cloudflare.
3. Авторизувати GitHub або GitLab, якщо Cloudflare попросить.
4. Дати Cloudflare створити або імпортувати проєкт.
5. Дочекатися build і deploy Worker.
6. Відкрити URL задеплоєного Worker.
7. Скопіювати MCP endpoint.

MCP endpoint виглядає так:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

## Опційний приватний доступ

За замовчуванням Worker можна задеплоїти без secrets. Це зручно для першого тесту, але для приватного використання варто задати `MCP_SHARED_SECRET`.

У Cloudflare dashboard:

1. Відкрити задеплоєний Worker.
2. Перейти в **Settings**.
3. Відкрити **Variables and Secrets**.
4. Додати secret з назвою `MCP_SHARED_SECRET`.
5. Зробити redeploy, якщо Cloudflare попросить.

Після цього підключайтесь до:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

## Опційні повідомлення

Notification tools працюють тільки після того, як користувач налаштує відповідні secrets.

### Telegram

Потрібні secrets:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

### Discord

Потрібний secret:

```text
DISCORD_WEBHOOK_URL
```

### Slack

Потрібний secret:

```text
SLACK_WEBHOOK_URL
```

### Generic webhook

Потрібний secret:

```text
DEFAULT_WEBHOOK_URL
```

Ці secrets опційні. Користувачі також можуть передати явний `webhook_url` у `send_notification` або напряму використовувати `call_webhook`, якщо MCP-клієнт це дозволяє.

## Чого ця кнопка ще не вирішує

Кнопка деплоїть Worker. Вона не підключає автоматично ChatGPT, Telegram, Slack, Discord або CRM account.

Після деплою користувачам ще потрібно:

- скопіювати `/mcp` URL у MCP-клієнт;
- додати optional secrets, якщо потрібен приватний доступ або повідомлення;
- налаштувати CRM/API integrations, коли вони будуть додані.
