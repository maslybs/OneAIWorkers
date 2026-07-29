type JsonRpcMessage = {
  method?: unknown;
  params?: unknown;
  [key: string]: unknown;
};

export async function normalizeMcpToolCallRequest(request: Request): Promise<Request> {
  if (request.method !== "POST") return request;
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return request;

  try {
    const payload = await request.clone().json();
    let normalized: unknown;
    if (Array.isArray(payload)) {
      const normalizedBatch = payload.map(normalizeJsonRpcMessage);
      if (normalizedBatch.every((item, index) => item === payload[index])) return request;
      normalized = normalizedBatch;
    } else {
      normalized = normalizeJsonRpcMessage(payload);
      if (normalized === payload) return request;
    }
    return new Request(request, { body: JSON.stringify(normalized) });
  } catch {
    return request;
  }
}

export function normalizeQualifiedToolName(value: string): string {
  const separator = value.lastIndexOf(".");
  if (separator <= 0 || separator === value.length - 1) return value;
  const unqualified = value.slice(separator + 1);
  return /^[a-z][a-z0-9_]{1,127}$/u.test(unqualified) ? unqualified : value;
}

function normalizeJsonRpcMessage(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const message = value as JsonRpcMessage;
  if (message.method !== "tools/call" || !message.params || typeof message.params !== "object" || Array.isArray(message.params)) {
    return value;
  }
  const params = message.params as Record<string, unknown>;
  if (typeof params.name !== "string") return value;
  const name = normalizeQualifiedToolName(params.name);
  if (name === params.name) return value;
  return { ...message, params: { ...params, name } };
}
