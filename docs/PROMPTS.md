# Example prompts

[Ukrainian version](PROMPTS.uk.md)

These examples assume your AI assistant can run on a schedule, remember past results, and use OneAIWorkers tools.

## Watch competitor prices

```text
Every weekday at 09:00, use OneAIWorkers to read these pricing pages: ...
Compare them with what you remember from the previous run.
If a price or offer changed, send me a short message.
Then remember the new result for next time.
```

## Watch a jobs page

```text
Every 6 hours, read this jobs page.
If there are new roles about React, AI, automation, or Cloudflare Workers, send me a short summary and links.
Remember what you already showed me.
```

## Check if my website works

```text
Every 30 minutes, check my homepage and /api/health.
If either one fails twice in a row, send me a message with the status code and response time.
```

## Daily research summary

```text
Every morning, read these RSS feeds and pages.
Send me only new and important items.
Remember what you already sent.
```

## Run a webhook every week

```text
Every Monday at 09:00, call this Make webhook with this message: "Prepare weekly client follow-ups".
If it fails, send me a message.
```
