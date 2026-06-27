# Розгортання в Cloudflare

[Англійська версія](DEPLOY_TO_CLOUDFLARE.md)

Найпростіший спосіб встановити OneAIWorkers — кнопка **Розгорнути в Cloudflare** в README.

Вона працює з цим публічним репозиторієм GitHub:

```text
https://github.com/maslybs/OneAIWorkers
```

## Що робить кнопка

Коли користувач натискає кнопку, Cloudflare може:

1. скопіювати проєкт;
2. налаштувати збірку Worker;
3. створити потрібну D1 базу для OAuth;
4. розгорнути Worker в обліковому записі Cloudflare користувача.

## Код кнопки

```md
[![Розгорнути в Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maslybs/OneAIWorkers)
```

## Кроки для користувача

1. Натиснути **Розгорнути в Cloudflare**.
2. Увійти в Cloudflare.
3. Дозволити Cloudflare доступ до GitHub або GitLab, якщо він попросить.
4. Дочекатися розгортання Worker.
5. Відкрити посилання на Worker.
6. Скопіювати MCP-посилання.

MCP-посилання виглядає так:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp
```

## Приватний доступ

Worker підтримує OAuth для ChatGPT. OAuth, конектори, дії конекторів і записи аудиту зберігаються в D1 базі, яку Cloudflare створює під час розгортання.

Worker може працювати без секретів. Для першого тесту цього достатньо, але будь-хто, хто зможе пройти OAuth, зможе підключитися.

Для особистого використання додайте `MCP_SHARED_SECRET` у Cloudflare. Під час OAuth-підключення OneAIWorkers попросить ввести цей секрет один раз:

1. Відкрийте розгорнутий Worker.
2. Відкрийте **Settings**.
3. Відкрийте **Variables and Secrets**.
4. Додайте секрет з назвою `MCP_SHARED_SECRET`.
5. Зробіть повторне розгортання, якщо Cloudflare попросить.

Після цього підключайтесь до:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp?key=YOUR_SECRET
```

## Додаткові повідомлення

Повідомлення працюють тільки після того, як ви додасте потрібні секрети.

### Telegram

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

### Discord

```text
DISCORD_WEBHOOK_URL
```

### Slack

```text
SLACK_WEBHOOK_URL
```

### Звичайний webhook

```text
DEFAULT_WEBHOOK_URL
```

Ці поля можна залишити порожніми під час розгортання. Для першого тесту вони не потрібні.

Щоб додати їх пізніше:

1. Відкрийте Cloudflare dashboard.
2. Перейдіть у **Workers & Pages**.
3. Відкрийте ваш OneAIWorkers Worker.
4. Відкрийте **Settings**.
5. Відкрийте **Variables and Secrets**.
6. Додайте потрібне значення як **Secret**.
7. Зробіть повторне розгортання, якщо Cloudflare попросить.

## Чого кнопка не робить

Кнопка тільки розгортає Worker.

Вона не підключає автоматично ChatGPT, Telegram, Slack, Discord або вашу CRM.

Після розгортання користувачу ще потрібно:

- скопіювати `/mcp` посилання в MCP-клієнт;
- додати додаткові секрети для приватного доступу або повідомлень;
- додати налаштування CRM або API, коли такі інтеграції зʼявляться.
