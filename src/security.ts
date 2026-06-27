import { biInline } from "./i18n";

const PRIVATE_HOSTS = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

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
  return safe.toString();
}
