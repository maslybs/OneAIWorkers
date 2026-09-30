import { truncate } from "./utils";

export interface AgentBrokerCapability {
  token: string;
  base_url: string;
}

export async function brokerSearch(
  capability: AgentBrokerCapability,
  query: string,
  pluginIds: string[],
): Promise<unknown> {
  return brokerRequest(capability, {
    op: "search",
    query: truncate(query, 2_000),
    plugin_ids: pluginIds.slice(0, 20),
    limit: 6,
  });
}

export async function brokerCall(
  capability: AgentBrokerCapability,
  toolRef: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return brokerRequest(capability, { op: "call", tool_ref: toolRef, arguments: args });
}

export function compactObservation(value: unknown, maxChars = 14_000): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return truncate(text, maxChars);
}

async function brokerRequest(capability: AgentBrokerCapability, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${capability.base_url.replace(/\/+$/u, "")}/internal/agent-broker`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${capability.token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json<unknown>();
  if (!response.ok) {
    const record = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    throw new Error(typeof record.error === "string" ? record.error : `Agent broker returned HTTP ${response.status}.`);
  }
  return payload;
}
