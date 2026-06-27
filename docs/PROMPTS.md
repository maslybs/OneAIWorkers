# Example prompts for scheduled LLMs / Приклади prompts для scheduled LLM

## English

These prompts assume your LLM can run on a schedule, keep memory between runs, and call the OneAIWorkers MCP tools.

## Українською

Ці prompts припускають, що ваша LLM може запускатися по розкладу, тримати памʼять між запусками і викликати MCP tools з OneAIWorkers.

---

## Competitor watcher / Моніторинг конкурентів

```text
Every weekday at 09:00, use OneAIWorkers to fetch these pricing pages: ...
Compare them with the snapshot you remember from the previous run.
If there is a meaningful pricing, positioning, or offer change, notify me.
Then remember the new snapshot for next time.

Кожного робочого дня о 09:00 використовуй OneAIWorkers, щоб отримати ці pricing pages: ...
Порівняй їх зі snapshot, який ти памʼятаєш із попереднього запуску.
Якщо є важлива зміна ціни, позиціонування або оферу, повідом мене.
Потім запамʼятай новий snapshot для наступного разу.
```

## Job/project watcher / Моніторинг вакансій або проєктів

```text
Every 6 hours, fetch this jobs page. Compare with your previous memory. If there are new roles related to React, AI, automation, or Cloudflare Workers, notify me with a short summary and the links.

Кожні 6 годин отримуй цю сторінку з вакансіями. Порівнюй зі своєю попередньою памʼяттю. Якщо є нові позиції, повʼязані з React, AI, automation або Cloudflare Workers, повідом мене коротким summary і links.
```

## Website health check / Перевірка здоровʼя сайту

```text
Every 30 minutes, check my homepage and /api/health. If either fails twice in a row based on your memory, send me a notification with the status code, response time, and likely next step.

Кожні 30 хвилин перевіряй homepage і /api/health. Якщо щось падає двічі підряд на основі твоєї памʼяті, надішли мені notification зі status code, response time і ймовірним наступним кроком.
```

## Daily research digest / Щоденний research digest

```text
Every morning, fetch these RSS feeds and URLs. Remember which items you already showed me. Send me a concise digest with only new and important items.

Щоранку отримуй ці RSS feeds і URLs. Памʼятай, які items ти вже показував. Надсилай мені короткий digest тільки з новими й важливими items.
```

## No-code scheduled webhook / No-code webhook по розкладу

```text
Every Monday at 09:00, call this Make webhook with a JSON payload containing the week number and this message: "Prepare weekly client follow-ups". If the webhook fails, notify me.

Щопонеділка о 09:00 викликай цей Make webhook з JSON payload, який містить номер тижня і повідомлення: "Prepare weekly client follow-ups". Якщо webhook не спрацює, повідом мене.
```
