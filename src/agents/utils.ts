import { MAX_AGENTS } from "./constants";
import type { RunOutput } from "./types";

export function validateTeamMembers(coordinatorId: string, memberIds: string[]): void {
  if (memberIds.length < 2 || memberIds.length > MAX_AGENTS) {
    throw new Error(`A team must contain 2-${MAX_AGENTS} agents.`);
  }
  if (new Set(memberIds).size !== memberIds.length) throw new Error("Team member IDs must be unique.");
  if (!memberIds.includes(coordinatorId)) throw new Error("The coordinator must be included in member_agent_ids.");
}

export function requireConfirmation(confirmed: boolean, action: string): void {
  if (!confirmed) {
    throw new Error(`Explicit user confirmation is required to ${action}. Retry with confirmed=true after the user approves.`);
  }
}

export function extractAiText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const value = result as Record<string, unknown>;
    if (typeof value.response === "string") return value.response;
    if (typeof value.text === "string") return value.text;
    if (value.result && typeof value.result === "object") {
      const nested = value.result as Record<string, unknown>;
      if (typeof nested.response === "string") return nested.response;
      if (typeof nested.text === "string") return nested.text;
    }
  }
  return JSON.stringify(result, null, 2);
}

export function compactOutputs(outputs: RunOutput[]): string {
  return truncate(outputs.map((item) => `## ${item.agent_name} — round ${item.round}\n${item.output}`).join("\n\n"), 70_000);
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n[truncated]`;
}

export async function requestJson<T>(request: Request): Promise<T> {
  return request.json<T>();
}

export function responseJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
