import { z } from "zod";
import { biInline } from "../i18n";
import { assertSafeOutboundUrl, redactUrlForOutput } from "../security";
import type { UrlFetchResult } from "../types";

const USER_AGENT = "AI-Action-Hub-Worker/0.1 (+https://workers.cloudflare.com)";
const RAW_READ_MULTIPLIER = 4;

export const fetchUrlSchema = {
  url: z.string().url().describe(biInline("Public HTTPS URL to fetch.", "Публічний HTTPS URL для отримання даних.")),
  max_chars: z.number().int().min(200).max(50000).default(12000).describe(biInline("Maximum returned text characters.", "Максимальна кількість символів у відповіді.")),
  extract_text: z.boolean().default(true).describe(biInline("Strip scripts, styles and HTML tags when the response is HTML.", "Прибирати scripts, styles і HTML-теги, якщо відповідь є HTML.")),
};

export const fetchManyUrlsSchema = {
  urls: z.array(z.string().url()).min(1).max(10).describe(biInline("Public HTTPS URLs to fetch, maximum 10.", "Публічні HTTPS URL для отримання даних, максимум 10.")),
  max_chars_per_url: z.number().int().min(200).max(20000).default(6000).describe(biInline("Maximum returned characters per URL.", "Максимальна кількість символів для кожного URL.")),
  extract_text: z.boolean().default(true).describe(biInline("Strip scripts, styles and HTML tags for HTML responses.", "Прибирати scripts, styles і HTML-теги для HTML-відповідей.")),
};

export const checkUrlStatusSchema = {
  url: z.string().url().describe(biInline("Public HTTPS URL to check.", "Публічний HTTPS URL для перевірки.")),
  expected_status: z.number().int().min(100).max(599).optional().describe(biInline("Optional expected HTTP status code.", "Опційний очікуваний HTTP status code.")),
  timeout_ms: z.number().int().min(1000).max(15000).default(10000).describe(biInline("Timeout in milliseconds, between 1000 and 15000.", "Timeout у мілісекундах, від 1000 до 15000.")),
};

export const fetchRssSchema = {
  url: z.string().url().describe(biInline("Public HTTPS RSS or Atom feed URL.", "Публічний HTTPS RSS або Atom feed URL.")),
  max_items: z.number().int().min(1).max(30).default(10).describe(biInline("Maximum returned feed items.", "Максимальна кількість елементів feed.")),
};

export async function fetchUrl(args: z.infer<z.ZodObject<typeof fetchUrlSchema>>): Promise<UrlFetchResult> {
  const url = assertSafeOutboundUrl(args.url);
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml,text/plain,application/json;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });

  const contentType = response.headers.get("content-type");
  const rawLimit = Math.min(args.max_chars * RAW_READ_MULTIPLIER, 200_000);
  const raw = await readTextWithLimit(response, rawLimit);
  let body = raw.text;
  if (args.extract_text && contentType?.includes("html")) body = htmlToText(body);

  const truncated = raw.truncated || body.length > args.max_chars;
  const outputText = body.length > args.max_chars ? body.slice(0, args.max_chars) : body;

  return {
    url: redactUrlForOutput(url),
    status: response.status,
    ok: response.ok,
    contentType,
    finalUrl: redactUrlForOutput(new URL(response.url)),
    text: outputText,
    truncated,
  };
}

export async function fetchManyUrls(args: z.infer<z.ZodObject<typeof fetchManyUrlsSchema>>) {
  return Promise.all(
    args.urls.map((url) =>
      fetchUrl({ url, max_chars: args.max_chars_per_url, extract_text: args.extract_text }).catch((error) => ({
        url: safeRedactRawUrl(url),
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })),
    ),
  );
}

export async function checkUrlStatus(args: z.infer<z.ZodObject<typeof checkUrlStatusSchema>>) {
  const url = assertSafeOutboundUrl(args.url);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(biInline("Request timed out.", "Час очікування запиту вичерпано.")), args.timeout_ms);
  try {
    const response = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    const elapsedMs = Date.now() - started;
    const expected = args.expected_status;
    return {
      url: redactUrlForOutput(url),
      finalUrl: redactUrlForOutput(new URL(response.url)),
      status: response.status,
      ok: expected ? response.status === expected : response.ok,
      expected_status: expected ?? null,
      elapsed_ms: elapsedMs,
      content_type: response.headers.get("content-type"),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchRss(args: z.infer<z.ZodObject<typeof fetchRssSchema>>) {
  const result = await fetchUrl({ url: args.url, max_chars: 50000, extract_text: false });
  const xml = result.text;
  const itemBlocks = [...xml.matchAll(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  const items = itemBlocks.slice(0, args.max_items).map((block) => ({
    title: decodeXml(tag(block, "title")),
    link: decodeXml(tag(block, "link") || linkHref(block)),
    published: decodeXml(tag(block, "pubDate") || tag(block, "published") || tag(block, "updated")),
    summary: decodeXml(stripTags(tag(block, "description") || tag(block, "summary") || tag(block, "content"))).slice(0, 1200),
  }));
  return { url: result.url, status: result.status, ok: result.ok, items, truncated: result.truncated };
}

async function readTextWithLimit(response: Response, maxChars: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    const text = await response.text();
    return { text: text.slice(0, maxChars), truncated: text.length > maxChars };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let truncated = false;

  try {
    while (text.length <= maxChars) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > maxChars) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  return { text: text.slice(0, maxChars), truncated };
}

function safeRedactRawUrl(rawUrl: string): string {
  try {
    return redactUrlForOutput(new URL(rawUrl));
  } catch {
    return "[invalid-url]";
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match?.[1]?.trim() ?? "";
}

function linkHref(block: string): string {
  return block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1] ?? "";
}

function stripTags(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeXml(value: string): string {
  return stripTags(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}
