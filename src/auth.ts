import { biInline } from "./i18n";
import { isOAuthEnabled, isValidOAuthAccessToken, oauthUnauthorizedHeaders } from "./oauth";
import { constantTimeEqual } from "./security";
import type { Env } from "./types";

export function getRequestToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();

  const headerToken = request.headers.get("x-oneaiworkers-token");
  if (headerToken) return headerToken.trim();

  return null;
}

export async function isMcpAuthorized(request: Request, env: Env): Promise<boolean> {
  const token = getRequestToken(request);

  if (token && env.MCP_SHARED_SECRET && await constantTimeEqual(token, env.MCP_SHARED_SECRET)) return true;
  if (token && isOAuthEnabled(env)) {
    const resource = `${buildBaseUrl(request, env)}/mcp`;
    if (await isValidOAuthAccessToken(token, env, resource)) return true;
  }

  if (!env.MCP_SHARED_SECRET && !isOAuthEnabled(env)) return true;
  return false;
}

export function unauthorized(request: Request, env: Env): Response {
  const body = env.MCP_SHARED_SECRET || isOAuthEnabled(env)
    ? biInline(
        "Unauthorized. Use OAuth, Authorization: Bearer <token>, or x-oneaiworkers-token.",
        "Немає доступу. Використайте OAuth, Authorization: Bearer <token> або x-oneaiworkers-token.",
      )
    : biInline("Unauthorized.", "Немає доступу.");

  return new Response(body, {
    status: 401,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...oauthUnauthorizedHeaders(request, env),
    },
  });
}

export function buildBaseUrl(request: Request, env: Env): string {
  return (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
}
