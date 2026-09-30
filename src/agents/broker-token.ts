import { base64UrlDecode, base64UrlEncode } from "../crypto";
import type { Env } from "../types";
import type { WRequestContext } from "../w-gateway/types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

interface AgentBrokerTokenPayload {
  version: 1;
  expires_at: number;
  context: WRequestContext;
}

export async function createAgentBrokerToken(env: Env, context: WRequestContext): Promise<string> {
  const payload: AgentBrokerTokenPayload = {
    version: 1,
    expires_at: Date.now() + TOKEN_TTL_MS,
    context: {
      tenantId: context.tenantId,
      userId: context.userId,
      endpointId: context.endpointId,
      sessionId: context.sessionId,
      exposureMode: context.exposureMode,
      baseUrl: context.baseUrl,
    },
  };
  const encoded = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await sign(env, encoded);
  return `${encoded}.${signature}`;
}

export async function verifyAgentBrokerToken(env: Env, token: string): Promise<WRequestContext | null> {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = await sign(env, encoded);
  if (!constantTimeEqual(expected, signature)) return null;
  let payload: AgentBrokerTokenPayload;
  try {
    payload = JSON.parse(decoder.decode(base64UrlDecode(encoded))) as AgentBrokerTokenPayload;
  } catch {
    return null;
  }
  if (payload.version !== 1 || !payload.context || payload.expires_at < Date.now()) return null;
  return payload.context;
}

function brokerSecret(env: Env): string {
  const secret = env.CREDENTIALS_MASTER_KEY || env.MCP_SHARED_SECRET;
  if (!secret || secret.length < 24) {
    throw new Error("Agent tool broker requires CREDENTIALS_MASTER_KEY or MCP_SHARED_SECRET.");
  }
  return secret;
}

async function sign(env: Env, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(brokerSecret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}
