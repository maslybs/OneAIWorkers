import { z } from "zod";
import { biInline } from "../i18n";
import type { Env } from "../types";
import {
  agentCreateSchema,
  agentDeleteSchema,
  agentGetSchema,
  agentListSchema,
  agentRunCancelSchema,
  agentRunListSchema,
  agentRunStatusSchema,
  agentTeamCreateSchema,
  agentTeamDeleteSchema,
  agentTeamGetSchema,
  agentTeamListSchema,
  agentTeamStartSchema,
  agentTeamUpdateSchema,
  agentUpdateSchema,
} from "./schemas";
import { requireConfirmation } from "./utils";

export async function agentCreate(env: Env, args: z.infer<z.ZodObject<typeof agentCreateSchema>>) {
  requireConfirmation(args.confirmed, "create the agent");
  const { confirmed: _confirmed, ...agent } = args;
  return managerRequest(env, "/agents", "POST", agent);
}

export async function agentList(env: Env, args: z.infer<z.ZodObject<typeof agentListSchema>>) {
  return managerRequest(env, `/agents?include_disabled=${args.include_disabled ? "1" : "0"}`);
}

export async function agentGet(env: Env, args: z.infer<z.ZodObject<typeof agentGetSchema>>) {
  return managerRequest(env, `/agents/${args.agent_id}`);
}

export async function agentUpdate(env: Env, args: z.infer<z.ZodObject<typeof agentUpdateSchema>>) {
  requireConfirmation(args.confirmed, "update the agent");
  const { agent_id, confirmed: _confirmed, ...patch } = args;
  return managerRequest(env, `/agents/${agent_id}`, "PATCH", patch);
}

export async function agentDelete(env: Env, args: z.infer<z.ZodObject<typeof agentDeleteSchema>>) {
  requireConfirmation(args.confirmed, "delete the agent");
  return managerRequest(env, `/agents/${args.agent_id}`, "DELETE");
}

export async function agentTeamCreate(env: Env, args: z.infer<z.ZodObject<typeof agentTeamCreateSchema>>) {
  requireConfirmation(args.confirmed, "create the proposed agent team");
  const { confirmed: _confirmed, ...team } = args;
  if (team.coordinator_index >= team.agents.length) {
    throw new Error("coordinator_index must point to one of the supplied agents.");
  }
  return managerRequest(env, "/teams", "POST", team);
}

export async function agentTeamList(env: Env, args: z.infer<z.ZodObject<typeof agentTeamListSchema>>) {
  return managerRequest(env, `/teams?include_disabled=${args.include_disabled ? "1" : "0"}`);
}

export async function agentTeamGet(env: Env, args: z.infer<z.ZodObject<typeof agentTeamGetSchema>>) {
  return managerRequest(env, `/teams/${args.team_id}`);
}

export async function agentTeamUpdate(env: Env, args: z.infer<z.ZodObject<typeof agentTeamUpdateSchema>>) {
  requireConfirmation(args.confirmed, "update the agent team");
  const { team_id, confirmed: _confirmed, ...patch } = args;
  return managerRequest(env, `/teams/${team_id}`, "PATCH", patch);
}

export async function agentTeamDelete(env: Env, args: z.infer<z.ZodObject<typeof agentTeamDeleteSchema>>) {
  requireConfirmation(args.confirmed, "delete the agent team");
  return managerRequest(
    env,
    `/teams/${args.team_id}?delete_agents=${args.delete_agents ? "1" : "0"}`,
    "DELETE",
  );
}

export async function agentTeamStart(env: Env, args: z.infer<z.ZodObject<typeof agentTeamStartSchema>>) {
  requireConfirmation(args.confirmed, "start the agent team and incur Workers AI usage");
  const { confirmed: _confirmed, ...body } = args;
  return managerRequest(env, "/runs", "POST", body);
}

export async function agentRunStatus(env: Env, args: z.infer<z.ZodObject<typeof agentRunStatusSchema>>) {
  return managerRequest(env, `/runs/${args.run_id}`);
}

export async function agentRunList(env: Env, args: z.infer<z.ZodObject<typeof agentRunListSchema>>) {
  const query = new URLSearchParams({ limit: String(args.limit) });
  if (args.team_id) query.set("team_id", args.team_id);
  return managerRequest(env, `/runs?${query.toString()}`);
}

export async function agentRunCancel(env: Env, args: z.infer<z.ZodObject<typeof agentRunCancelSchema>>) {
  requireConfirmation(args.confirmed, "cancel the agent run");
  return managerRequest(env, `/runs/${args.run_id}/cancel`, "POST", {});
}

async function managerRequest(env: Env, path: string, method = "GET", body?: unknown): Promise<unknown> {
  if (!env.AGENT_MANAGER) {
    throw new Error(biInline(
      "AgentManager Durable Object binding is not configured.",
      "Durable Object binding AgentManager не налаштований.",
    ));
  }

  const id = env.AGENT_MANAGER.idFromName("default");
  const stub = env.AGENT_MANAGER.get(id);
  const response = await stub.fetch(new Request(`https://agent-manager.internal${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const payload = await response.json<{ ok: boolean; data?: unknown; error?: string }>();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `AgentManager returned HTTP ${response.status}.`);
  }
  return payload.data;
}
