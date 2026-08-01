import type { Env } from "../types";
import { aiChat, type ChatProfile } from "../tools/ai";
import { MAX_RESULT_CHARS } from "./constants";
import {
  addUsage,
  buildAgentNeuronPreflight,
  estimateSingleCallCost,
  estimateSingleCallNeurons,
  estimateTeamCost,
} from "./pricing";
import { AgentRepository } from "./repository";
import type { AgentCallResult, AgentRecord, RunRecord } from "./types";
import {
  compactOutputs,
  errorText,
  estimateTokens,
  extractAiText,
  truncate,
} from "./utils";

export class AgentOrchestrator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    private readonly repository: AgentRepository,
  ) {}

  async startRun(teamId: string, task: string, budgetOverride?: number, maxSteps?: number): Promise<RunRecord> {
    if (!this.env.AI) throw new Error("Workers AI binding is not configured.");
    const team = this.repository.requireTeam(teamId);
    if (!team.enabled) throw new Error("The agent team is disabled.");

    const agents = team.member_agent_ids.map((id) => this.repository.requireAgent(id));
    if (agents.some((agent) => !agent.enabled)) {
      throw new Error("One or more agents in the team are disabled.");
    }

    const plannedSteps = 1 + team.max_rounds * agents.length;
    const effectiveMaxSteps = maxSteps ?? plannedSteps;
    if (plannedSteps > effectiveMaxSteps) {
      throw new Error(`This agent team needs ${plannedSteps} steps, which exceeds the requested limit of ${effectiveMaxSteps}.`);
    }

    const estimate = estimateTeamCost(team, agents);
    estimate.neuron_preflight = await buildAgentNeuronPreflight(this.env, team, agents);
    const effectiveBudget = budgetOverride ?? team.max_budget_usd;
    if (
      effectiveBudget !== null
      && effectiveBudget !== undefined
      && estimate.estimated_cost_usd !== null
      && estimate.estimated_cost_usd > effectiveBudget
    ) {
      throw new Error(
        `Estimated cost $${estimate.estimated_cost_usd.toFixed(6)} exceeds the maximum budget $${effectiveBudget.toFixed(6)}.`,
      );
    }

    const now = new Date().toISOString();
    const run: RunRecord = {
      id: crypto.randomUUID(),
      team_id: team.id,
      task,
      status: "queued",
      stage: "planning",
      state: {
        round: 1,
        member_index: 0,
        max_steps: effectiveMaxSteps,
        steps_completed: 0,
        outputs: [],
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost_usd: 0,
          estimated_neurons: 0,
          reported_token_calls: 0,
          estimated_token_calls: 0,
        },
      },
      estimate,
      final_result: null,
      error: null,
      cancellation_requested: false,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };

    this.repository.insertRun(run);
    await this.state.storage.setAlarm(Date.now() + 50);
    return run;
  }

  async processNextRunStep(): Promise<void> {
    let run = this.repository.nextPendingRun();
    if (!run) return;
    if (run.cancellation_requested) {
      this.repository.finishRun(run.id, "cancelled", null, "Cancelled by user.");
      return;
    }

    const team = this.repository.requireTeam(run.team_id);
    const agents = team.member_agent_ids.map((id) => this.repository.requireAgent(id));
    const coordinator = agents.find((agent) => agent.id === team.coordinator_agent_id);
    if (!coordinator) throw new Error("Coordinator agent is missing from the team.");
    const members = agents.filter((agent) => agent.id !== coordinator.id);
    this.repository.markRunRunning(run.id);

    try {
      if (run.stage === "planning") {
        ensureStepAvailable(run);
        const prompt = [
          `Task: ${run.task}`,
          `Team members: ${members.map((agent) => `${agent.name} — ${agent.role}`).join("; ")}`,
          "Create a concise delegation plan. Assign one concrete deliverable to each specialist and define the final acceptance criteria.",
        ].join("\n\n");
        const call = await this.callAgent(run.id, coordinator, prompt);
        run.state.steps_completed += 1;
        run.state.coordinator_plan = call.text;
        addUsage(run.state.usage, call);
        run.stage = "members";
        run.state.member_index = 0;
        this.repository.saveRun(run);
        return;
      }

      if (run.stage === "members") {
        if (run.state.member_index < members.length) {
          ensureStepAvailable(run);
          const agent = members[run.state.member_index];
          const previous = run.state.outputs
            .filter((item) => item.agent_id === agent.id)
            .at(-1)?.output;
          const prompt = [
            `Overall task: ${run.task}`,
            `Coordinator plan: ${run.state.coordinator_plan || "No plan available."}`,
            run.state.feedback ? `Coordinator feedback for revision: ${run.state.feedback}` : "",
            previous ? `Your previous-round output: ${truncate(previous, 20_000)}` : "",
            `Your responsibility: ${agent.role}`,
            "Produce your assigned deliverable. Be explicit about assumptions, risks, and unresolved questions.",
          ].filter(Boolean).join("\n\n");
          const call = await this.callAgent(run.id, agent, prompt);
          run.state.steps_completed += 1;
          run.state.outputs.push({
            agent_id: agent.id,
            agent_name: agent.name,
            round: run.state.round,
            model: call.model,
            output: call.text,
          });
          run.state.member_index += 1;
          addUsage(run.state.usage, call);
          this.repository.saveRun(run);
          return;
        }
        run.stage = run.state.round < team.max_rounds ? "feedback" : "synthesis";
        this.repository.saveRun(run);
        return;
      }

      if (run.stage === "feedback") {
        ensureStepAvailable(run);
        const prompt = [
          `Task: ${run.task}`,
          `Round ${run.state.round} specialist outputs:`,
          compactOutputs(run.state.outputs.filter((item) => item.round === run.state.round)),
          "Review the outputs. Identify contradictions, missing evidence, and concrete revision instructions for the next round.",
        ].join("\n\n");
        const call = await this.callAgent(run.id, coordinator, prompt);
        run.state.steps_completed += 1;
        run.state.feedback = call.text;
        run.state.round += 1;
        run.state.member_index = 0;
        run.stage = "members";
        addUsage(run.state.usage, call);
        this.repository.saveRun(run);
        return;
      }

      ensureStepAvailable(run);
      const prompt = [
        `Task: ${run.task}`,
        `Coordinator plan: ${run.state.coordinator_plan || "No plan available."}`,
        "Specialist outputs:",
        compactOutputs(run.state.outputs),
        "Synthesize one final result. Resolve conflicts, separate verified conclusions from assumptions, and finish with recommended next actions.",
      ].join("\n\n");
      const call = await this.callAgent(run.id, coordinator, prompt);
      run.state.steps_completed += 1;
      addUsage(run.state.usage, call);
      run.final_result = call.text;
      run.status = "completed";
      run.completed_at = new Date().toISOString();
      this.repository.saveRun(run);
    } catch (error) {
      this.repository.finishRun(run.id, "failed", null, errorText(error));
    }
  }

  async scheduleIfNeeded(): Promise<void> {
    if (this.repository.pendingRunCount() > 0) {
      await this.state.storage.setAlarm(Date.now() + 100);
    }
  }

  private async callAgent(runId: string, agent: AgentRecord, userPrompt: string): Promise<AgentCallResult> {
    const messages = [
      {
        role: "system" as const,
        content: `${agent.instructions}\n\nYou are ${agent.name}. Your role is ${agent.role}. Stay within this role and do not claim to have used tools or sources that were not provided.`,
      },
      { role: "user" as const, content: truncate(userPrompt, 70_000) },
    ];
    const result = await aiChat(this.env, {
      profile: agent.profile as ChatProfile,
      model: agent.model || undefined,
      allow_unlisted_model: false,
      messages,
      max_tokens: agent.max_output_tokens,
      temperature: agent.temperature,
      top_p: undefined,
      seed: undefined,
    }, {
      run_id: runId,
      agent_id: agent.id,
    });
    const text = truncate(extractAiText(result.result), MAX_RESULT_CHARS);
    const fallbackInputTokens = estimateTokens(messages.map((message) => message.content).join("\n"));
    const fallbackOutputTokens = estimateTokens(text);
    const inputTokens = result.billing.prompt_tokens ?? fallbackInputTokens;
    const outputTokens = result.billing.completion_tokens ?? fallbackOutputTokens;
    return {
      text,
      model: result.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: result.billing.estimated_cost_usd
        ?? estimateSingleCallCost(result.model, inputTokens, outputTokens)
        ?? 0,
      estimated_neurons: result.billing.estimated_neurons
        ?? estimateSingleCallNeurons(result.model, inputTokens, outputTokens)
        ?? 0,
      token_source: result.billing.source,
    };
  }
}

function ensureStepAvailable(run: RunRecord): void {
  if (run.state.steps_completed >= run.state.max_steps) {
    throw new Error(`The agent run reached its ${run.state.max_steps}-step limit.`);
  }
}
