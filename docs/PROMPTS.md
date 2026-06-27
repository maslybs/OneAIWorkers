# Example prompts for scheduled LLMs

[Ukrainian version](PROMPTS.uk.md)

These prompts assume your LLM can run on a schedule, keep memory between runs, and call the OneAIWorkers MCP tools.

## Competitor watcher

```text
Every weekday at 09:00, use OneAIWorkers to fetch these pricing pages: ...
Compare them with the snapshot you remember from the previous run.
If there is a meaningful pricing, positioning, or offer change, notify me.
Then remember the new snapshot for next time.
```

## Job/project watcher

```text
Every 6 hours, fetch this jobs page. Compare with your previous memory. If there are new roles related to React, AI, automation, or Cloudflare Workers, notify me with a short summary and the links.
```

## Website health check

```text
Every 30 minutes, check my homepage and /api/health. If either fails twice in a row based on your memory, send me a notification with the status code, response time, and likely next step.
```

## Daily research digest

```text
Every morning, fetch these RSS feeds and URLs. Remember which items you already showed me. Send me a concise digest with only new and important items.
```

## No-code scheduled webhook

```text
Every Monday at 09:00, call this Make webhook with a JSON payload containing the week number and this message: "Prepare weekly client follow-ups". If the webhook fails, notify me.
```
