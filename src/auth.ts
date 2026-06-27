import { biInline } from "./i18n";
import type { Env } from "./types";

export function getRequestToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();

  const headerToken = request.headers.get("x-action-hub-token");
  if (headerToken) return headerToken.trim();

  const url = new URL(request.url);
  return url.searchParams.get("key") ?? url.searchParams.get("access_token");
}

export function isMcpAuthorized(request: Request, env: Env): boolean {
  if (!env.MCP_SHARED_SECRET) return true;
  return getRequestToken(request) === env.MCP_SHARED_SECRET;
}

export function unauthorized(env: Env): Response {
  const body = env.MCP_SHARED_SECRET
    ? biInline(
        "Unauthorized. Provide Authorization: Bearer <token>, x-action-hub-token, or ?key=...",
        "Немає доступу. Передайте Authorization: Bearer <token>, x-action-hub-token або ?key=...",
      )
    : biInline("Unauthorized.", "Немає доступу.");
  return new Response(body, {
    status: 401,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "www-authenticate": "Bearer",
    },
  });
}

export function buildBaseUrl(request: Request, env: Env): string {
  return (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
}
