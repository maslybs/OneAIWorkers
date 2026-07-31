# Підключення ChatGPT, Claude та інших MCP-клієнтів

[English version](CLIENTS.md)

Усі сумісні клієнти використовують ту саму адресу OneAIWorkers:

```text
https://ВАШ-WORKER.ВАШ-ПІДДОМЕН.workers.dev/mcp
```

Рекомендований спосіб авторизації — OAuth. Коли відкриється сторінка входу OneAIWorkers, введіть секрет доступу, який показав встановлювач.

## ChatGPT

1. Відкрийте налаштування застосунків або підключень у ChatGPT.
2. Додайте власний MCP-застосунок.
3. Вставте адресу `/mcp`.
4. Виберіть OAuth і підключіться.
5. Коли система попросить, введіть секрет доступу OneAIWorkers.

## Claude

Найпростіший спосіб — сторінка віддалених конекторів:

1. Відкрийте **Customize → Connectors**.
2. Виберіть **Add custom connector**.
3. Вставте адресу `/mcp`.
4. Не заповнюйте необов’язкові поля Client ID та Client Secret.
5. Підключіться та введіть секрет доступу OneAIWorkers, коли система попросить.

Claude підтримує віддалені конектори через обліковий запис користувача. Доступність і дозволи організації залежать від плану Claude. Дивіться [офіційну інструкцію Claude](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

### Файл налаштувань Claude Desktop

Якщо ви використовуєте місцеві MCP-налаштування Claude Desktop, додайте цей запис до `mcpServers` у файлі `claude_desktop_config.json`:

```json
"oneaiworkers": {
  "command": "npx",
  "args": [
    "-y",
    "mcp-remote@latest",
    "https://ВАШ-WORKER.ВАШ-ПІДДОМЕН.workers.dev/mcp",
    "--transport",
    "http-only"
  ]
}
```

Повністю закрийте й знову відкрийте Claude Desktop. `mcp-remote` має відкрити сторінку OAuth у браузері. Так `MCP_SHARED_SECRET` не зберігатиметься у файлі налаштувань. Докладніше: [mcp-remote](https://github.com/geelen/mcp-remote).

## Інші MCP-клієнти

OneAIWorkers працює з клієнтами, які підтримують віддалений MCP через Streamable HTTP і один із таких способів авторизації:

- OAuth з автоматичною реєстрацією клієнта та PKCE;
- `Authorization: Bearer <секрет-доступу>`;
- `x-oneaiworkers-token: <секрет-доступу>`.

Якщо клієнт підтримує лише місцеві сервери `stdio`, використайте міст, наприклад `mcp-remote`.

Ніколи не додавайте секрет доступу до адреси.

## Після додавання або зміни конектора

Конектор одразу доступний через `list_connectors` і `call_connector_tool`. Оновлення або перепідключення необов’язкове й лише додає короткі окремі команди, наприклад `n8n_list_workflows`.
