import { buildBaseUrl, getRequestToken } from "../auth";
import { sha256Base64Url } from "../crypto";
import { oauthAccessTokenIdentity } from "../oauth";
import type { Env } from "../types";
import type { ExposureMode, WRequestContext } from "./types";

export async function createWRequestContext(
  request: Request,
  env: Env,
  exposureMode: ExposureMode,
): Promise<WRequestContext> {
  const token = getRequestToken(request);
  const oauthClientId = token
    ? await oauthAccessTokenIdentity(token, env, `${buildBaseUrl(request, env)}/mcp`)
    : null;
  const identity = oauthClientId ? `oauth:${oauthClientId}` : token || "anonymous";
  const tokenHash = identity === "anonymous" ? "anonymous" : await sha256Base64Url(identity);
  const suppliedSession = safeSessionId(request.headers.get("mcp-session-id"));
  return {
    tenantId: "default",
    userId: token ? `user_${tokenHash.slice(0, 24)}` : "anonymous",
    endpointId: endpointIdFor(request, exposureMode),
    sessionId: suppliedSession || `session_${tokenHash.slice(0, 24)}`,
    exposureMode,
    baseUrl: buildBaseUrl(request, env),
  };
}

function endpointIdFor(request: Request, mode: ExposureMode): string {
  const path = new URL(request.url).pathname.replace(/[^a-z0-9/_-]+/giu, "").slice(0, 120);
  return `${mode}:${path || "/mcp"}`;
}

function safeSessionId(value: string | null): string | null {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9._:-]{8,160}$/u.test(normalized) ? normalized : null;
}
