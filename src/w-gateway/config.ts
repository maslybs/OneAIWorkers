import type { Env } from "../types";

export const DEFAULT_SEMANTIC_PLUGIN_THRESHOLD = 20;

export function semanticPluginThreshold(env: Env): number {
  const configured = Number.parseInt(String(env.W_SEMANTIC_PLUGIN_THRESHOLD || ""), 10);
  if (!Number.isFinite(configured)) return DEFAULT_SEMANTIC_PLUGIN_THRESHOLD;
  return Math.max(1, Math.min(1_000, configured));
}
