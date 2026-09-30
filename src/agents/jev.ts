import type { Env } from "../types";
import { truncate } from "./utils";

const DEFAULT_MODEL = "jev-latest";
const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const INPUT_PRICE_PER_MILLION_USD = 0.042;
const REQUEST_TIMEOUT_MS = 12_000;

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export interface JevDecision {
  configured: boolean;
  model?: string;
  answers?: Record<string, unknown>;
  usage?: { input_tokens: number; output_tokens: number; estimated_cost_usd: number };
  error?: string;
}

export function jevConfigured(env: Env): boolean {
  return Boolean(env.TYPESAFE_API_KEY);
}

export async function askJev(
  env: Env,
  state: unknown,
  questions: Record<string, JevQuestion>,
): Promise<JevDecision> {
  if (!env.TYPESAFE_API_KEY) return { configured: false };
  const endpoint = env.TYPESAFE_API_URL || DEFAULT_ENDPOINT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        model: env.TYPESAFE_MODEL || DEFAULT_MODEL,
        state: compactState(state),
        questions,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      return { configured: true, error: `TypeSafe Jev returned HTTP ${response.status}: ${truncate(text, 500)}` };
    }
    const payload = JSON.parse(text) as {
      model?: string;
      answers?: Record<string, unknown>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const inputTokens = Math.max(0, Number(payload.usage?.input_tokens || 0));
    const outputTokens = Math.max(0, Number(payload.usage?.output_tokens || 0));
    return {
      configured: true,
      model: payload.model || env.TYPESAFE_MODEL || DEFAULT_MODEL,
      answers: payload.answers || {},
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: Math.round((inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION_USD * 1e9) / 1e9,
      },
    };
  } catch (error) {
    return { configured: true, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export function noulProbability(answer: unknown): number | null {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  const value = Number((answer as Record<string, unknown>).noul);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function compactState(state: unknown): unknown {
  const serialized = JSON.stringify(state);
  if (serialized.length <= 80_000) return state;
  return truncate(serialized, 80_000);
}
