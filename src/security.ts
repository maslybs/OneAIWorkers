import { biInline } from "./i18n";

const PRIVATE_HOSTS = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);
const SENSITIVE_KEY_RE = /(?:^|[_-])(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password|passwd|authorization|proxy[_-]?authorization|api[_-]?key|client[_-]?secret|private[_-]?key|credential|cookie|set[_-]?cookie|signature|webhook[_-]?url)(?:$|[_-])|accessToken|refreshToken|idToken|apiKey|clientSecret|privateKey|setCookie|webhookUrl/i;
const SENSITIVE_QUERY_RE = /([?&][^=&#\s]*(?:token|key|secret|password|auth|signature)[^=&#\s]*=)([^&#\s"']+)/gi;
const TELEGRAM_TOKEN_RE = /\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const PREFIXED_TOKEN_RE = /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g;
const AUTH_VALUE_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const TEXT_FIELD_SECRET_RE = /((?:"|')?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password|passwd|authorization|api[_-]?key|client[_-]?secret|private[_-]?key|credential|cookie|signature|webhook[_-]?url)(?:"|')?\s*[:=]\s*(?:"|')?)([^"',}\s&]+)/gi;
const MAX_REDACTION_DEPTH = 20;

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function looksLikeIPv6(hostname: string): boolean {
  return hostname.includes(":") || hostname.startsWith("[") || hostname.endsWith("]");
}

export function assertSafeOutboundUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(biInline("Invalid URL.", "Некоректний URL."));
  }

  if (url.protocol !== "https:") {
    throw new Error(biInline("Only HTTPS URLs are allowed.", "Дозволені тільки HTTPS URL."));
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (PRIVATE_HOSTS.has(hostname) || hostname.endsWith(".local") || isPrivateIPv4(hostname) || looksLikeIPv6(hostname)) {
    throw new Error(biInline("Private, local, loopback, and raw IPv6 hosts are blocked.", "Приватні, локальні, loopback та raw IPv6 hosts заблоковані."));
  }

  if (url.username || url.password) {
    throw new Error(biInline("URLs with embedded credentials are not allowed.", "URL із вбудованими credentials не дозволені."));
  }

  return url;
}

export async function fetchWithSafeRedirects(rawUrl: string | URL, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let currentUrl = assertSafeOutboundUrl(rawUrl.toString());
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetch(currentUrl, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (redirectCount === maxRedirects) {
      throw new Error(biInline("Too many redirects.", "Забагато перенаправлень."));
    }
    currentUrl = assertSafeOutboundUrl(new URL(location, currentUrl).toString());
  }
  throw new Error(biInline("Too many redirects.", "Забагато перенаправлень."));
}

export function safeKey(input: string): string {
  const value = input.trim().toLowerCase().replace(/[^a-z0-9:_-]/g, "-").replace(/-+/g, "-");
  if (!value || value.length > 120) {
    throw new Error(biInline("Invalid name. Use 1-120 letters, numbers, ':', '_' or '-'.", "Некоректна назва. Використовуйте 1-120 літер, цифр, ':', '_' або '-'."));
  }
  return value;
}

export function redactUrlForOutput(url: URL): string {
  const safe = new URL(url.toString());
  for (const key of [...safe.searchParams.keys()]) {
    if (/token|key|secret|password|auth|signature/i.test(key)) safe.searchParams.set(key, "[redacted]");
  }
  safe.pathname = safe.pathname
    .replace(/(\/(?:webhook(?:-test)?|hooks?)\/).+/i, "$1[redacted]")
    .replace(/(\/api\/webhooks\/).+/i, "$1[redacted]")
    .replace(/(\/services\/).+/i, "$1[redacted]");
  return redactSensitiveText(safe.toString());
}

export function redactSensitiveText(input: string, protectedValues: string[] = []): string {
  let output = input;
  for (const protectedValue of protectedValues) {
    if (protectedValue.length >= 6) output = output.split(protectedValue).join("[redacted]");
  }
  return output
    .replace(/(https:\/\/api\.telegram\.org\/bot)\d{6,12}:[A-Za-z0-9_-]{20,}/gi, "$1[redacted]")
    .replace(TELEGRAM_TOKEN_RE, "[redacted]")
    .replace(JWT_RE, "[redacted]")
    .replace(PREFIXED_TOKEN_RE, "[redacted]")
    .replace(AUTH_VALUE_RE, "$1 [redacted]")
    .replace(SENSITIVE_QUERY_RE, "$1[redacted]")
    .replace(TEXT_FIELD_SECRET_RE, "$1[redacted]");
}

export function redactSensitiveValue(value: unknown, depth = 0, protectedValues: string[] = []): unknown {
  if (depth > MAX_REDACTION_DEPTH) return "[redacted:depth-limit]";
  if (typeof value === "string") return redactSensitiveText(value, protectedValues);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item, depth + 1, protectedValues));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_RE.test(key) && !isSafeSecretReference(key, child)
        ? "[redacted]"
        : redactSensitiveValue(child, depth + 1, protectedValues);
    }
    return out;
  }
  return String(value);
}

function isSafeSecretReference(key: string, value: unknown): boolean {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{1,80}$/.test(value)) return false;
  return /(?:^|_)(?:secret_name|token_secret)$/.test(key);
}

export async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0 && left.length === right.length;
}
