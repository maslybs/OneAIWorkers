# Google Workspace cloud plugin

This plugin connects Google Drive, Docs, and Sheets to OneAIWorkers. It runs in the user's Cloudflare account and is reachable only through the protected parent OneAIWorkers.

## Authorization

1. Enable Google Drive API, Google Docs API, and Google Sheets API in Google Cloud.
2. Create an OAuth client of type **Web application**.
3. Install the plugin and open its protected settings page.
4. Copy the exact redirect URI shown there into the Google OAuth client.
5. Save the Client ID and Client Secret, then approve access on Google.

OneAIWorkers stores the refresh token in encrypted D1. The plugin keeps only a short-lived access token in memory, refreshes it automatically, and retries once after an HTTP 401 response. If Google revokes or expires the refresh token, the plugin returns `reauthorization_required` and the user reconnects Google from the protected settings page.

For an external Google OAuth app, set its publishing status to **In production**. In **Testing**, Google refresh tokens for Drive, Docs, and Sheets normally expire after seven days.

---

# Хмарний плагін Google Workspace

Плагін підключає Google Drive, Docs і Sheets до OneAIWorkers. Він працює у Cloudflare користувача, а прямий доступ до нього має лише захищений основний OneAIWorkers.

## Авторизація

1. Увімкніть Google Drive API, Google Docs API і Google Sheets API у Google Cloud.
2. Створіть OAuth-клієнт типу **Web application**.
3. Встановіть плагін і відкрийте його захищену сторінку налаштувань.
4. Скопіюйте звідти точну адресу повернення у налаштування OAuth-клієнта Google.
5. Збережіть Client ID і Client Secret, а потім підтвердьте доступ на сайті Google.

OneAIWorkers зберігає довготривалий ключ у зашифрованій D1. Плагін тримає короткий ключ лише в пам'яті, автоматично його оновлює та один раз повторює запит після помилки 401. Якщо Google відкликав або завершив довготривалий ключ, плагін повертає `reauthorization_required`, після чого користувач повторно підключає Google через захищену сторінку.

Для зовнішнього застосунку Google переведіть екран дозволів у стан **In production**. У стані **Testing** довготривалі ключі для Drive, Docs і Sheets зазвичай завершуються через сім днів.
