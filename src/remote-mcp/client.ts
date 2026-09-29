import { assertSafeOutboundUrl } from "../security";

export interface RemoteMcpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface RemoteMcpConnectionOptions {
  serverUrl: string;
  accessToken?: string | null;
}

export interface RemoteMcpToolCatalog {
  protocolVersion: string;
  tools: RemoteMcpTool[];
  ttlMs?: number;
  cacheScope?: "public" | "private";
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface McpSession {
  endpoint: URL;
  sessionId: string | null;
  protocolVersion: string;
  mode: "modern" | "legacy";
  initialized: boolean;
  accessToken: string | null;
  nextId: number;
}

const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
const MAX_RPC_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TOOL_CATALOG_CHARS = 5_000_000;
const CLIENT_INFO = { name: "OneAIWorkers", version: "remote-mcp" } as const;

export async function listRemoteMcpTools(options: RemoteMcpConnectionOptions): Promise<RemoteMcpToolCatalog> {
  const session = await openSession(options);
  const tools: RemoteMcpTool[] = [];
  let catalogChars = 0;
  let cursor: string | undefined;
  let ttlMs: number | undefined;
  let cacheScope: "public" | "private" | undefined;
  do {
    const result = await rpc(session, "tools/list", cursor ? { cursor } : {});
    const record = asRecord(result);
    const page = Array.isArray(record.tools) ? record.tools : [];
    for (const item of page) {
      const tool = normalizeTool(item);
      if (!tool) continue;
      catalogChars += JSON.stringify(tool).length;
      if (catalogChars > MAX_TOOL_CATALOG_CHARS) throw new Error("Remote MCP tool catalog exceeds the safety size limit.");
      tools.push(tool);
    }
    const pageTtl = finiteNonNegativeNumber(record.ttlMs);
    if (pageTtl !== null) ttlMs = ttlMs === undefined ? pageTtl : Math.min(ttlMs, pageTtl);
    if (record.cacheScope === "private") cacheScope = "private";
    else if (!cacheScope && record.cacheScope === "public") cacheScope = "public";
    cursor = typeof record.nextCursor === "string" && record.nextCursor ? record.nextCursor : undefined;
  } while (cursor);
  return {
    protocolVersion: session.protocolVersion,
    tools,
    ...(ttlMs !== undefined ? { ttlMs } : {}),
    ...(cacheScope ? { cacheScope } : {}),
  };
}

export async function callRemoteMcpTool(
  options: RemoteMcpConnectionOptions,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const session = await openSession(options);
  const result = await rpc(session, "tools/call", { name: toolName, arguments: args || {} });
  return normalizeCallToolResult(result);
}

async function openSession(options: RemoteMcpConnectionOptions): Promise<McpSession> {
  const endpoint = assertSafeOutboundUrl(options.serverUrl);
  const accessToken = options.accessToken?.trim() || null;

  const modern: McpSession = {
    endpoint,
    sessionId: null,
    protocolVersion: MODERN_PROTOCOL_VERSION,
    mode: "modern",
    initialized: true,
    accessToken,
    nextId: 1,
  };
  try {
    const discovered = asRecord(await rpc(modern, "server/discover", {}));
    const supported = Array.isArray(discovered.supportedVersions)
      ? discovered.supportedVersions.filter((value): value is string => typeof value === "string" && Boolean(value))
      : [];
    if (!supported.length || supported.includes(MODERN_PROTOCOL_VERSION)) return modern;
    const advertisedLegacy = LEGACY_PROTOCOL_VERSIONS.filter((version) => supported.includes(version));
    if (advertisedLegacy.length) return openLegacySession(endpoint, accessToken, advertisedLegacy);
    throw new Error(`Remote MCP does not support a compatible protocol version: ${supported.join(", ") || "unknown"}.`);
  } catch (error) {
    if (!shouldFallbackFromModern(error)) throw error;
  }

  return openLegacySession(endpoint, accessToken, LEGACY_PROTOCOL_VERSIONS);
}

async function openLegacySession(
  endpoint: URL,
  accessToken: string | null,
  versions: readonly string[],
): Promise<McpSession> {
  let lastError: unknown = null;
  for (const protocolVersion of versions) {
    const session: McpSession = {
      endpoint,
      sessionId: null,
      protocolVersion,
      mode: "legacy",
      initialized: false,
      accessToken,
      nextId: 1,
    };
    try {
      const initialized = await rpc(session, "initialize", {
        protocolVersion,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      });
      const negotiated = asRecord(initialized).protocolVersion;
      if (typeof negotiated === "string" && negotiated) session.protocolVersion = negotiated;
      session.initialized = true;
      await notify(session, "notifications/initialized", {});
      return session;
    } catch (error) {
      lastError = error;
      if (!looksLikeProtocolVersionError(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Remote MCP initialization failed.");
}

async function rpc(session: McpSession, method: string, params: unknown): Promise<unknown> {
  const id = session.nextId++;
  const finalParams = session.mode === "modern" ? withModernMeta(session, params) : params;
  const response = await postRpc(session, { jsonrpc: "2.0", id, method, params: finalParams });
  const envelope = await parseRpcEnvelope(response, id);
  if (envelope.error) {
    const code = envelope.error.code;
    const message = envelope.error.message || `Remote MCP RPC error ${String(code ?? "unknown")}`;
    throw new Error(`${code !== undefined ? `[${code}] ` : ""}${message}`);
  }
  return envelope.result;
}

async function notify(session: McpSession, method: string, params: unknown): Promise<void> {
  const finalParams = session.mode === "modern" ? withModernMeta(session, params) : params;
  const response = await postRpc(session, { jsonrpc: "2.0", method, params: finalParams });
  if (response.status === 202 || response.status === 204) return;
  const text = await readResponseText(response);
  if (!text.trim()) return;
  const envelope = parseRpcText(text, response.headers.get("content-type") || "");
  if (envelope?.error) throw new Error(envelope.error.message || "Remote MCP notification failed.");
}

function withModernMeta(session: McpSession, params: unknown): Record<string, unknown> {
  const input = isRecord(params) ? params : {};
  const existingMeta = isRecord(input._meta) ? input._meta : {};
  return {
    ...input,
    _meta: {
      ...existingMeta,
      "io.modelcontextprotocol/protocolVersion": session.protocolVersion,
      "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  };
}

async function postRpc(session: McpSession, payload: unknown): Promise<Response> {
  const request = asRecord(payload);
  const method = typeof request.method === "string" ? request.method : "";
  const params = asRecord(request.params);
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json; charset=utf-8",
  });
  if (session.accessToken) headers.set("authorization", `Bearer ${session.accessToken}`);
  if (method) headers.set("mcp-method", safeHeaderValue(method));
  const name = typeof params.name === "string" ? params.name : typeof params.uri === "string" ? params.uri : "";
  if (name && ["tools/call", "resources/read", "prompts/get"].includes(method)) {
    headers.set("mcp-name", safeHeaderValue(name));
  }
  if (session.mode === "legacy" && session.sessionId) headers.set("mcp-session-id", session.sessionId);
  if (session.mode === "modern" || (session.mode === "legacy" && session.initialized)) {
    headers.set("mcp-protocol-version", session.protocolVersion);
  }

  const response = await fetch(session.endpoint.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    redirect: "manual",
  });

  if (session.mode === "legacy") {
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) session.sessionId = sessionId;
  }

  if (!response.ok) {
    const text = (await readResponseText(response, 64 * 1024)).slice(0, 2_000);
    const auth = response.headers.get("www-authenticate");
    const detail = text.trim() || response.statusText || `HTTP ${response.status}`;
    const suffix = auth ? `; WWW-Authenticate: ${auth}` : "";
    throw new Error(`Remote MCP HTTP ${response.status}: ${detail}${suffix}`);
  }
  return response;
}

async function parseRpcEnvelope(response: Response, expectedId: string | number): Promise<JsonRpcResponse> {
  const text = await readResponseText(response);
  if (!text.trim()) throw new Error("Remote MCP returned an empty RPC response.");
  const parsed = parseRpcText(text, response.headers.get("content-type") || "", expectedId);
  if (!parsed) throw new Error("Remote MCP returned an invalid JSON-RPC response.");
  return parsed;
}

async function readResponseText(response: Response, maxBytes = MAX_RPC_RESPONSE_BYTES): Promise<string> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Remote MCP response exceeds the safety size limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Remote MCP response exceeds the safety size limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function parseRpcText(text: string, contentType: string, expectedId?: string | number): JsonRpcResponse | null {
  if (contentType.toLowerCase().includes("text/event-stream") || /^\s*(event:|data:)/m.test(text)) {
    const messages: JsonRpcResponse[] = [];
    for (const block of text.split(/\r?\n\r?\n/u)) {
      const data = block
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n")
        .trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as JsonRpcResponse;
        if (parsed && typeof parsed === "object") messages.push(parsed);
      } catch {
        // Ignore non-JSON SSE events and keep looking for the JSON-RPC message.
      }
    }
    if (expectedId !== undefined) {
      return messages.find((message) => message.id === expectedId) || messages.at(-1) || null;
    }
    return messages.at(-1) || null;
  }
  try {
    const parsed = JSON.parse(text) as JsonRpcResponse | JsonRpcResponse[];
    if (Array.isArray(parsed)) {
      if (expectedId !== undefined) return parsed.find((message) => message.id === expectedId) || parsed.at(-1) || null;
      return parsed.at(-1) || null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function normalizeTool(value: unknown): RemoteMcpTool | null {
  const record = asRecord(value);
  if (typeof record.name !== "string" || !record.name.trim()) return null;
  const inputSchema = asJsonSchema(record.inputSchema);
  const outputSchema = asJsonSchema(record.outputSchema);
  return {
    name: record.name,
    ...(typeof record.title === "string" ? { title: record.title } : {}),
    ...(typeof record.description === "string" ? { description: record.description } : {}),
    ...(inputSchema ? { inputSchema } : {}),
    ...(outputSchema ? { outputSchema } : {}),
    ...(isRecord(record.annotations) ? { annotations: record.annotations as Record<string, unknown> } : {}),
    ...(isRecord(record._meta) ? { _meta: record._meta as Record<string, unknown> } : {}),
  };
}

function normalizeCallToolResult(value: unknown): unknown {
  const result = asRecord(value);
  if (result.isError === true) {
    const message = extractTextContent(result.content) || "Remote MCP tool returned an error.";
    throw new Error(message);
  }
  if (result.structuredContent !== undefined) return normalizeStructuredContent(result.structuredContent);
  const content = Array.isArray(result.content) ? result.content : [];
  const textItems = content
    .map((item) => asRecord(item))
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => String(item.text));
  if (textItems.length === 1) return parseMaybeJson(textItems[0]);
  if (textItems.length > 1) return textItems.map(parseMaybeJson);
  if (content.length) return { content };
  return value;
}

function normalizeStructuredContent(value: unknown): unknown {
  if (typeof value === "string") return parseMaybeJson(value);
  return value;
}

function parseMaybeJson(value: string): unknown {
  const text = value.trim();
  if (!text) return "";
  try { return JSON.parse(text); } catch { return value; }
}

function extractTextContent(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => asRecord(item))
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => String(item.text))
    .join("\n")
    .trim();
}

function shouldFallbackFromModern(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/remote mcp http (401|403|429|5\d\d)/u.test(message)) return false;
  return message.includes("server/discover") ||
    message.includes("method not found") ||
    message.includes("-32601") ||
    message.includes("protocol") ||
    message.includes("version") ||
    /remote mcp http (400|404|405|415)/u.test(message);
}

function looksLikeProtocolVersionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("protocol") && message.includes("version") ||
    /remote mcp http 400/u.test(message);
}

function safeHeaderValue(value: string): string {
  if (/\r|\n/u.test(value)) throw new Error("Remote MCP header value is invalid.");
  return value;
}

function finiteNonNegativeNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function asJsonSchema(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return value as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value as Record<string, unknown> : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
