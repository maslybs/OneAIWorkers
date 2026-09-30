import type { Env } from "../types";
import { MODEL_PROFILES, aiChat, type ChatProfile } from "../tools/ai";
import { resolveTokenUsage } from "../tools/neuron-meter";
import type { AgentCallResult, AgentRecord } from "./types";
import { estimateSingleCallCost, estimateSingleCallNeurons } from "./pricing";
import { estimateTokens, extractAiText, truncate } from "./utils";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function agentModel(agent: Pick<AgentRecord, "profile" | "model">): string {
  return agent.model || MODEL_PROFILES[agent.profile as ChatProfile];
}

export async function runAgentInference(
  env: Env,
  runId: string,
  agent: AgentRecord,
  messages: ChatMessage[],
): Promise<AgentCallResult> {
  const model = agentModel(agent);
  if (model.startsWith("@cf/")) {
    const result = await aiChat(env, {
      profile: agent.profile as ChatProfile,
      model: agent.model || undefined,
      allow_unlisted_model: Boolean(agent.model),
      messages,
      max_tokens: agent.max_output_tokens,
      temperature: agent.temperature,
      top_p: undefined,
      seed: undefined,
    }, { run_id: runId, agent_id: agent.id });
    const text = truncate(extractAiText(result.result), 80_000);
    const fallbackInput = estimateTokens(messages.map((message) => message.content).join("\n"));
    const fallbackOutput = estimateTokens(text);
    const inputTokens = result.billing.prompt_tokens ?? fallbackInput;
    const outputTokens = result.billing.completion_tokens ?? fallbackOutput;
    return {
      text,
      model: result.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: result.billing.estimated_cost_usd
        ?? estimateSingleCallCost(result.model, inputTokens, outputTokens),
      estimated_neurons: result.billing.estimated_neurons
        ?? estimateSingleCallNeurons(result.model, inputTokens, outputTokens),
      token_source: result.billing.source,
      billing_type: "workers_ai_neurons",
      gateway_log_id: env.AI?.aiGatewayLogId || null,
    };
  }

  if (!env.AI) throw new Error("AI binding is not configured.");
  if (!env.AI_GATEWAY_ID) {
    throw new Error("AI_GATEWAY_ID is required for third-party provider/model agent IDs.");
  }
  const input = {
    messages,
    stream: false,
    max_tokens: agent.max_output_tokens,
    temperature: agent.temperature,
  };
  const result = await env.AI.run(model, input, {
    gateway: {
      id: env.AI_GATEWAY_ID,
      collectLog: true,
      metadata: {
        oneaiworkers_feature: "agent",
        run_id: runId,
        agent_id: agent.id,
        agent_kind: agent.kind,
      },
    },
  });
  const text = truncate(extractAiText(result), 80_000);
  const usage = resolveTokenUsage(input, result);
  return {
    text,
    model,
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
    estimated_cost_usd: null,
    estimated_neurons: null,
    token_source: usage.source,
    billing_type: "ai_gateway_unified",
    gateway_log_id: env.AI.aiGatewayLogId || null,
  };
}
