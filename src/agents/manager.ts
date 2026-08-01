import type { Env } from "../types";
import { agentCapabilities } from "./capabilities";
import { MAX_RUNS_RETURNED } from "./constants";
import { AgentOrchestrator } from "./orchestration";
import { estimateTeamCost } from "./pricing";
import { AgentRepository } from "./repository";
import type { AgentDefinition, TeamCreateInput, TeamRecord } from "./types";
import { errorText, requestJson, responseJson } from "./utils";

export class AgentManager {
  private readonly repository: AgentRepository;
  private readonly orchestrator: AgentOrchestrator;
  private readonly ready: Promise<void>;

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.repository = new AgentRepository(state.storage.sql);
    this.orchestrator = new AgentOrchestrator(state, env, this.repository);
    this.ready = state.blockConcurrencyWhile(async () => this.repository.ensureSchema());
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    try {
      const url = new URL(request.url);
      const segments = url.pathname.split("/").filter(Boolean);

      if (url.pathname === "/capabilities" && request.method === "GET") {
        return responseJson({ ok: true, data: agentCapabilities(this.env) });
      }
      if (segments[0] === "agents") return this.handleAgents(request, url, segments);
      if (segments[0] === "teams") return this.handleTeams(request, url, segments);
      if (segments[0] === "runs") return this.handleRuns(request, url, segments);
      return responseJson({ ok: false, error: "AgentManager route not found." }, 404);
    } catch (error) {
      return responseJson({ ok: false, error: errorText(error) }, 400);
    }
  }

  async alarm(): Promise<void> {
    await this.ready;
    try {
      await this.orchestrator.processNextRunStep();
    } finally {
      await this.orchestrator.scheduleIfNeeded();
    }
  }

  private async handleAgents(request: Request, url: URL, segments: string[]): Promise<Response> {
    if (segments.length === 1 && request.method === "GET") {
      const includeDisabled = url.searchParams.get("include_disabled") !== "0";
      return responseJson({ ok: true, data: { agents: this.repository.listAgents(includeDisabled) } });
    }
    if (segments.length === 1 && request.method === "POST") {
      const agent = this.repository.insertAgent(await requestJson<AgentDefinition>(request));
      return responseJson({ ok: true, data: { agent } }, 201);
    }

    const id = segments[1];
    if (!id) return responseJson({ ok: false, error: "agent_id is required." }, 400);
    if (request.method === "GET") {
      return responseJson({ ok: true, data: { agent: this.repository.requireAgent(id) } });
    }
    if (request.method === "PATCH") {
      const patch = await requestJson<Partial<AgentDefinition> & { model?: string | null }>(request);
      return responseJson({ ok: true, data: { agent: this.repository.updateAgent(id, patch) } });
    }
    if (request.method === "DELETE") {
      this.repository.deleteAgent(id);
      return responseJson({ ok: true, data: { deleted: true, agent_id: id } });
    }
    return responseJson({ ok: false, error: "Unsupported agent operation." }, 405);
  }

  private async handleTeams(request: Request, url: URL, segments: string[]): Promise<Response> {
    if (segments.length === 1 && request.method === "GET") {
      const includeDisabled = url.searchParams.get("include_disabled") !== "0";
      return responseJson({ ok: true, data: { teams: this.repository.listTeams(includeDisabled) } });
    }
    if (segments.length === 1 && request.method === "POST") {
      const body = await requestJson<TeamCreateInput>(request);
      const agents = body.agents.map((agent) => this.repository.insertAgent(agent));
      const team = this.repository.insertTeam({
        name: body.name,
        description: body.description,
        coordinator_agent_id: agents[body.coordinator_index].id,
        member_agent_ids: agents.map((agent) => agent.id),
        enabled: body.enabled,
        max_rounds: body.max_rounds,
        expected_input_tokens_per_call: body.expected_input_tokens_per_call,
        expected_output_tokens_per_call: body.expected_output_tokens_per_call,
        max_budget_usd: body.max_budget_usd ?? null,
      });
      return responseJson({
        ok: true,
        data: { team, agents, estimate: estimateTeamCost(team, agents) },
      }, 201);
    }

    const id = segments[1];
    if (!id) return responseJson({ ok: false, error: "team_id is required." }, 400);
    if (request.method === "GET") return this.teamResponse(id);
    if (request.method === "PATCH") {
      const team = this.repository.updateTeam(id, await requestJson<Partial<TeamRecord>>(request));
      return this.teamResponse(team.id);
    }
    if (request.method === "DELETE") {
      const deleted = this.repository.deleteTeam(id, url.searchParams.get("delete_agents") === "1");
      return responseJson({ ok: true, data: { deleted: true, team_id: id, ...deleted } });
    }
    return responseJson({ ok: false, error: "Unsupported team operation." }, 405);
  }

  private async handleRuns(request: Request, url: URL, segments: string[]): Promise<Response> {
    if (segments.length === 1 && request.method === "GET") {
      const limit = Math.min(
        MAX_RUNS_RETURNED,
        Math.max(1, Number(url.searchParams.get("limit") || 20)),
      );
      return responseJson({
        ok: true,
        data: { runs: this.repository.listRuns(limit, url.searchParams.get("team_id")) },
      });
    }
    if (segments.length === 1 && request.method === "POST") {
      const body = await requestJson<{ team_id: string; task: string; max_budget_usd?: number; max_steps?: number }>(request);
      const run = await this.orchestrator.startRun(body.team_id, body.task, body.max_budget_usd, body.max_steps);
      return responseJson({ ok: true, data: { run } }, 202);
    }

    const id = segments[1];
    if (!id) return responseJson({ ok: false, error: "run_id is required." }, 400);
    if (segments[2] === "cancel" && request.method === "POST") {
      const run = this.repository.requireRun(id);
      if (["completed", "failed", "cancelled"].includes(run.status)) {
        return responseJson({ ok: true, data: { run, already_terminal: true } });
      }
      this.repository.requestRunCancellation(id);
      await this.state.storage.setAlarm(Date.now() + 50);
      return responseJson({ ok: true, data: { run_id: id, cancellation_requested: true } });
    }
    if (request.method === "GET") {
      return responseJson({ ok: true, data: { run: this.repository.requireRun(id) } });
    }
    return responseJson({ ok: false, error: "Unsupported run operation." }, 405);
  }

  private teamResponse(id: string): Response {
    const team = this.repository.requireTeam(id);
    const agents = team.member_agent_ids.map((agentId) => this.repository.requireAgent(agentId));
    return responseJson({ ok: true, data: { team, agents, estimate: estimateTeamCost(team, agents) } });
  }
}
