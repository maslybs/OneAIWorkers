import { biInline } from "../../i18n";
import { assertSafeOutboundUrl } from "../../security";
import type { JsonObject } from "./types";

const MAX_TEMPLATE_DEPTH = 20;

const TEMPLATE_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
const SENSITIVE_QUERY_RE = /([?&][^=]*(?:token|key|secret|password|auth|signature)[^=]*=)([^&]+)/gi;

export function renderUrlString(template: string, input: JsonObject): string {
  return renderString(template, input);
}

export function validateTemplatedUrl(template: string): void {
  assertSafeOutboundUrl(templateUrlForValidation(template));
}

export function assertUrlTemplateInput(template: string, input: JsonObject): void {
  const missing = templateKeys(template).filter((key) => {
    const value = getPath(input, key);
    return value === undefined || value === null || value === "";
  });
  if (missing.length) {
    throw new Error(`${biInline("Missing input values for URL template", "Бракує input значень для URL template")}: ${missing.join(", ")}`);
  }
}

export function redactTemplatedUrl(template: string): string {
  return template.replace(SENSITIVE_QUERY_RE, "$1[redacted]");
}

export function renderTemplate(value: unknown, input: JsonObject, depth = 0): unknown {
  if (depth > MAX_TEMPLATE_DEPTH) throw new Error(biInline("Template is too deep.", "Шаблон занадто глибокий."));
  if (typeof value === "string") return renderString(value, input);
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, input, depth + 1));
  if (value && typeof value === "object") {
    const out: JsonObject = {};
    for (const [key, child] of Object.entries(value as JsonObject)) out[key] = renderTemplate(child, input, depth + 1);
    return out;
  }
  return value;
}

export function renderScalar(value: unknown, input: JsonObject): string {
  if (typeof value === "string") return renderString(value, input);
  if (value === null || value === undefined) return "";
  return String(value);
}

export function renderString(template: string, input: JsonObject): string {
  return template.replace(TEMPLATE_RE, (_match, path: string) => {
    const value = getPath(input, path);
    if (value === undefined || value === null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

export function getPath(input: JsonObject, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && !Array.isArray(current)) return (current as JsonObject)[part];
    return undefined;
  }, input);
}

export function parseJsonObject(value: string): JsonObject {
  return parseJson<JsonObject>(value, {});
}

export function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value;
}

function templateKeys(template: string): string[] {
  return Array.from(template.matchAll(TEMPLATE_RE)).map((match) => match[1]);
}

function templateUrlForValidation(template: string): string {
  return template.replace(TEMPLATE_RE, (_match, path: string) => {
    const lower = path.toLowerCase();
    if (lower.includes("token") || lower.includes("secret") || lower.includes("password") || lower.includes("key")) return "REDACTED";
    return "example";
  });
}
