import type { AgentKind, EvidencePacket } from "./types";
import { truncate } from "./utils";

const MAX_FACTS = 10;
const MAX_EVIDENCE = 10;
const MAX_UNCERTAINTIES = 6;
const MAX_ACTIONS = 6;

export function parseEvidencePacket(
  text: string,
  fallback: { agent_id: string; agent_name: string; kind: AgentKind },
): EvidencePacket {
  const parsed = parseJsonObject(text);
  return {
    agent_id: fallback.agent_id,
    agent_name: fallback.agent_name,
    kind: fallback.kind,
    conclusion: cleanString(parsed?.conclusion, text, 4_000),
    confidence: clampConfidence(parsed?.confidence),
    facts: stringArray(parsed?.facts, MAX_FACTS, 1_000),
    evidence: evidenceArray(parsed?.evidence),
    uncertainties: stringArray(parsed?.uncertainties, MAX_UNCERTAINTIES, 1_000),
    proposed_actions: stringArray(parsed?.proposed_actions, MAX_ACTIONS, 1_000),
    needs_more_work: Boolean(parsed?.needs_more_work),
  };
}

export function compactEvidencePackets(packets: EvidencePacket[], maxChars = 24_000): string {
  return truncate(JSON.stringify(packets.map((packet) => ({
    agent: packet.agent_name,
    kind: packet.kind,
    conclusion: packet.conclusion,
    confidence: packet.confidence,
    facts: packet.facts,
    evidence: packet.evidence,
    uncertainties: packet.uncertainties,
    proposed_actions: packet.proposed_actions,
    needs_more_work: packet.needs_more_work,
  }))), maxChars);
}

export function evidencePrompt(): string {
  return [
    "Return ONLY one JSON object. Do not use markdown.",
    "Schema:",
    '{"conclusion":"concise answer","confidence":0.0,"facts":["verified fact"],"evidence":[{"source":"tool/result/source","detail":"what it proves","tool_ref":"optional"}],"uncertainties":["what is not verified"],"proposed_actions":["next action"],"needs_more_work":false}',
    "Keep the conclusion under 4000 characters, at most 10 facts/evidence items, and separate evidence from assumptions.",
  ].join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/^\`\`\`(?:json)?\s*/iu, "").replace(/\s*\`\`\`$/u, "");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function cleanString(value: unknown, fallback: string, maxChars: number): string {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : fallback.trim();
  return truncate(candidate, maxChars);
}

function stringArray(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .slice(0, maxItems).map((item) => truncate(item.trim(), maxChars));
}

function evidenceArray(value: unknown): EvidencePacket["evidence"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_EVIDENCE).flatMap((item) => {
    if (typeof item === "string") return [{ source: "agent", detail: truncate(item, 1_500) }];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const detail = typeof row.detail === "string" ? row.detail.trim() : "";
    if (!detail) return [];
    return [{
      source: typeof row.source === "string" && row.source.trim() ? truncate(row.source.trim(), 300) : "agent",
      detail: truncate(detail, 1_500),
      ...(typeof row.tool_ref === "string" && row.tool_ref.trim() ? { tool_ref: truncate(row.tool_ref.trim(), 500) } : {}),
    }];
  });
}

function clampConfidence(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.round(Math.max(0, Math.min(1, number)) * 1000) / 1000;
}
