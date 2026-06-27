import type { JsonObject } from "./types";
import { truncate } from "./templates";

const MAX_RESPONSE_PREVIEW_TEXT = 4_000;
const MAX_JSON_DEPTH = 6;
const MAX_JSON_ARRAY_ITEMS = 12;
const MAX_JSON_OBJECT_KEYS = 30;

export function buildConnectorResponse(response: Response, text: string) {
  const contentType = response.headers.get("content-type");
  const parsedJson = parseJsonMaybe(text);
  const bodyKind = parsedJson.ok ? "json" : "text";
  return {
    status: response.status,
    status_text: response.statusText,
    ok: response.ok,
    content_type: contentType,
    body_kind: bodyKind,
    summary: parsedJson.ok ? summarizeJson(parsedJson.value) : null,
    json_preview: parsedJson.ok ? compactJson(parsedJson.value) : null,
    text_preview: parsedJson.ok ? null : truncate(text, MAX_RESPONSE_PREVIEW_TEXT),
    raw_text_preview: truncate(text, MAX_RESPONSE_PREVIEW_TEXT),
    truncated: text.length > MAX_RESPONSE_PREVIEW_TEXT,
  };
}

function parseJsonMaybe(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function summarizeJson(value: unknown): JsonObject {
  if (Array.isArray(value)) {
    return {
      root_type: "array",
      item_count: value.length,
      first_item_keys: firstObjectKeys(value[0]),
    };
  }
  if (value && typeof value === "object") {
    const objectValue = value as JsonObject;
    const keys = Object.keys(objectValue);
    const array_fields: JsonObject = {};
    for (const key of keys) {
      const child = objectValue[key];
      if (Array.isArray(child)) array_fields[key] = { item_count: child.length, first_item_keys: firstObjectKeys(child[0]) };
    }
    return {
      root_type: "object",
      top_level_keys: keys.slice(0, 50),
      array_fields,
    };
  }
  return { root_type: value === null ? "null" : typeof value };
}

function compactJson(value: unknown, depth = 0): unknown {
  if (depth > MAX_JSON_DEPTH) return "[max depth reached]";
  if (typeof value === "string") return truncate(value, 2_000);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_JSON_ARRAY_ITEMS).map((item) => compactJson(item, depth + 1));
    if (value.length > MAX_JSON_ARRAY_ITEMS) items.push(`[...${value.length - MAX_JSON_ARRAY_ITEMS} more items]`);
    return items;
  }
  if (value && typeof value === "object") {
    const out: JsonObject = {};
    const entries = Object.entries(value as JsonObject);
    for (const [key, child] of entries.slice(0, MAX_JSON_OBJECT_KEYS)) out[key] = compactJson(child, depth + 1);
    if (entries.length > MAX_JSON_OBJECT_KEYS) out.__truncated_keys = entries.length - MAX_JSON_OBJECT_KEYS;
    return out;
  }
  return String(value);
}

function firstObjectKeys(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value as JsonObject).slice(0, 30) : [];
}
