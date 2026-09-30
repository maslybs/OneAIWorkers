import type { Env } from "../types";
import { brokerCall, brokerSearch, compactObservation } from "./broker-client";
import { compactEvidencePackets, evidencePrompt, parseEvidencePacket } from "./evidence";
import { runAgentInference } from "./inference";
import { askJev, noulProbability } from "./jev";
import {
  addUsage,
  buildAgentNeuronPreflight,
  estimateTeamCost,
} from "./pricing";
import { AgentRepository } from "./repository";
import type {
  AgentCallResult,
  AgentRecord,
  AgentRunCapability,
  EvidencePacket,
  RunOutput,
  RunRecord,
  TeamRecord,
} from "./types";
import {
  compactOutputs,
  errorText,
  estimateTokens,
  truncate,
} from "./utils";

interface AdaptiveWorkerResult {
  output: RunOutput;
  calls: AgentCallResult[];
  steps: number;
}

export class AgentOrchestrator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    private readonly repository: AgentRepository,
  ) {}

  async startRun(
    teamId: string,
    task: string,
    budgetOverride?: number,
    maxSteps?: number,
    capability?: AgentRunCapability,
  ): Promise<RunRecord> {
    if (!this.env.AI) throw new Error("AI binding is not configured.");
    const team = this.repository.requireTeam(teamId);
    if (!team.enabled) throw new Error("The agent team is disabled.");

    const agents = team.member_agent_ids.map((id) => this.repository.requireAgent(id));
    if (agents.some((agent) => !agent.enabled)) {
      throw new Error("One or more agents in the team are disabled.");
    }

    const legacyPlannedSteps = 1 + team.max_rounds * agents.length;
    const effectiveMaxSteps = maxSteps ?? (team.strategy === "legacy" ? legacyPlannedSteps : 8);
    if (team.strategy === "legacy" && legacyPlannedSteps > effectiveMaxSteps) {
      throw new Error(
        `This agent team needs ${legacyPlannedSteps} steps, which exceeds the requested limit of ${effectiveMaxSteps}.`,
      );
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
          unpriced_calls: 0,
          decision_calls: 0,
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
    if (capability) this.repository.saveRunCapability(run.id, capability);
    await this.state.storage.setAlarm(Date.now() + 50);
    return run;
  }

  async processNextRunStep(): Promise<void> {
    const run = this.repository.nextPendingRun();
    if (!run) return;
    if (run.cancellation_requested) {
      this.repository.finishRun(run.id, "cancelled", null, "Cancelled by user.");
      return;
    }

    const team = this.repository.requireTeam(run.team_id);
    const agents = team.member_agent_ids.map((id) => this.repository.requireAgent(id));
    this.repository.markRunRunning(run.id);

    try {
      if (team.strategy === "adaptive") {
        await this.processAdaptive(run, team, agents);
      } else {
        await this.processLegacy(run, team, agents);
      }
    } catch (error) {
      this.repository.finishRun(run.id, "failed", null, errorText(error));
    }
  }

  async scheduleIfNeeded(): Promise<void> {
    if (this.repository.pendingRunCount() > 0) {
      await this.state.storage.setAlarm(Date.now() + 100);
    }
  }

  private async processAdaptive(run: RunRecord, team: TeamRecord, agents: AgentRecord[]): Promise<void> {
    if (run.stage === "planning") {
      const workers = agents.filter((agent) => agent.kind === "scout" || agent.kind === "specialist");
      const reviewer = agents.find((agent) => agent.kind === "reviewer");
      const fallbackWorkers = workers.length ? workers : agents.filter((agent) => agent.kind !== "reviewer");
      if (!fallbackWorkers.length) throw new Error("Adaptive team has no executable worker.");

      const routing = await this.routeAdaptive(run, fallbackWorkers, reviewer);
      run.state.selected_agent_ids = routing.selectedIds;
      run.state.reviewer_agent_id = reviewer?.id;
      run.state.routing = {
        source: routing.source,
        selected_agent_ids: routing.selectedIds,
        ...(reviewer ? { reviewer_agent_id: reviewer.id } : {}),
        ...(routing.reason ? { reason: routing.reason } : {}),
        ...(routing.jevModel ? { jev_model: routing.jevModel } : {}),
        ...(routing.jevError ? { jev_error: routing.jevError } : {}),
      };
      run.state.member_index = 0;
      run.stage = "members";
      this.repository.saveRun(run);
      return;
    }

    if (run.stage === "members") {
      const selected = (run.state.selected_agent_ids || [])
        .map((id) => agents.find((agent) => agent.id === id))
        .filter((agent): agent is AgentRecord => Boolean(agent));
      if (!selected.length) throw new Error("Adaptive routing selected no available agents.");

      if (run.state.member_index < selected.length) {
        const remainingSteps = run.state.max_steps - run.state.steps_completed;
        if (remainingSteps <= 0) throw new Error(`The agent run reached its ${run.state.max_steps}-step limit.`);
        const remainingAgents = selected.slice(run.state.member_index);
        const batchSize = Math.min(team.max_parallel, remainingAgents.length, remainingSteps);
        const batch = remainingAgents.slice(0, batchSize);
        const base = Math.floor(remainingSteps / batch.length);
        let extra = remainingSteps % batch.length;
        const allocations = batch.map(() => base + (extra-- > 0 ? 1 : 0));

        const results = await Promise.all(batch.map((agent, index) =>
          this.runAdaptiveWorker(run, agent, allocations[index])));
        for (const result of results) {
          run.state.outputs.push(result.output);
          run.state.steps_completed += result.steps;
          for (const call of result.calls) addUsage(run.state.usage, call);
        }
        run.state.member_index += batch.length;
        this.repository.saveRun(run);
        return;
      }

      run.stage = "review";
      this.repository.saveRun(run);
      return;
    }

    if (run.stage === "review") {
      const packets = evidencePackets(run.state.outputs);
      const reviewer = run.state.reviewer_agent_id
        ? agents.find((agent) => agent.id === run.state.reviewer_agent_id)
        : undefined;
      const needsReview = await this.shouldReview(run, team, packets);
      run.state.review_needed = needsReview;

      if (needsReview && reviewer && run.state.steps_completed < run.state.max_steps) {
        const call = await this.callAgent(run.id, reviewer, [
          `Task: ${run.task}`,
          "Review these evidence packets for unsupported claims, contradictions, missing evidence, and unsafe certainty:",
          compactEvidencePackets(packets),
          evidencePrompt(),
        ].join("\n\n"));
        run.state.steps_completed += 1;
        addUsage(run.state.usage, call);
        const packet = parseEvidencePacket(call.text, {
          agent_id: reviewer.id,
          agent_name: reviewer.name,
          kind: reviewer.kind,
        });
        run.state.outputs.push({
          agent_id: reviewer.id,
          agent_name: reviewer.name,
          round: 1,
          model: call.model,
          output: truncate(call.text, 8_000),
          evidence_packet: packet,
          tool_calls: 0,
          model_calls: 1,
          gateway_log_ids: call.gateway_log_id ? [call.gateway_log_id] : [],
        });
      }

      run.stage = "synthesis";
      this.repository.saveRun(run);
      return;
    }

    this.completeAdaptive(run, team);
  }

  private async routeAdaptive(
    run: RunRecord,
    workers: AgentRecord[],
    reviewer?: AgentRecord,
  ): Promise<{
    source: "jev" | "deterministic";
    selectedIds: string[];
    reason?: string;
    jevModel?: string;
    jevError?: string;
  }> {
    const questions = Object.fromEntries(workers.map((agent, index) => [
      `use_${index}`,
      {
        type: "noul" as const,
        instructions: `Would agent "${agent.name}" materially improve this task rather than duplicate work? Role: ${agent.role}`,
        criteria: {
          true: "The role has a distinct useful contribution for the task.",
          false: "The role is unnecessary, redundant, or unlikely to improve the result.",
        },
      },
    ]));
    const decision = await askJev(this.env, {
      task: run.task,
      candidates: workers.map((agent) => ({ name: agent.name, role: agent.role, kind: agent.kind })),
    }, questions);
    this.addJevUsage(run, decision.usage);

    if (decision.answers) {
      const selectedIds = workers
        .filter((_agent, index) => (noulProbability(decision.answers?.[`use_${index}`]) ?? 0) >= 0.55)
        .map((agent) => agent.id);
      if (selectedIds.length) {
        return {
          source: "jev",
          selectedIds,
          reason: "Jev selected only roles expected to add distinct value.",
          jevModel: decision.model,
          jevError: decision.error,
        };
      }
    }

    const selected = deterministicWorkers(run.task, workers);
    return {
      source: "deterministic",
      selectedIds: selected.map((agent) => agent.id),
      reason: "Jev was unavailable or inconclusive; bounded deterministic routing was used.",
      jevModel: decision.model,
      jevError: decision.error,
    };
  }

  private async runAdaptiveWorker(
    run: RunRecord,
    agent: AgentRecord,
    stepBudget: number,
  ): Promise<AdaptiveWorkerResult> {
    if (stepBudget < 1) throw new Error("No step budget remains for the selected worker.");
    const capability = this.repository.runCapability(run.id);
    const system = [
      agent.instructions,
      `You are ${agent.name}. Your role is ${agent.role}.`,
      "Do not claim to have used tools or sources that were not actually provided.",
      "External writes are forbidden. If a write would help, put it in proposed_actions instead of executing it.",
      evidencePrompt(),
    ].join("\n\n");

    const calls: AgentCallResult[] = [];
    const gatewayLogIds: string[] = [];
    let toolCalls = 0;
    let steps = 0;

    if (
      agent.kind === "scout"
      && agent.tool_policy === "read_only"
      && agent.max_tool_calls > 0
      && capability
      && stepBudget >= 3
    ) {
      const search = await brokerSearch(capability, `${run.task}\n${agent.role}`, agent.allowed_plugin_ids);
      steps += 1;
      const planCall = await runAgentInference(this.env, run.id, agent, [
        { role: "system", content: [
          agent.instructions,
          `You are ${agent.name}, a read-only scout.`,
          "Choose only useful reads. Return ONLY JSON: {\"tool_requests\":[{\"tool_ref\":\"...\",\"arguments\":{}}]}.",
          `Request at most ${Math.min(agent.max_tool_calls, Math.max(0, stepBudget - 3))} tool calls. Use only listed tool refs and their schemas.`,
        ].join("\n\n") },
        { role: "user", content: [
          `Task: ${run.task}`,
          "Available read-only tools:",
          compactObservation(search, 16_000),
        ].join("\n\n") },
      ]);
      calls.push(planCall);
      if (planCall.gateway_log_id) gatewayLogIds.push(planCall.gateway_log_id);
      steps += 1;

      const maxCalls = Math.min(agent.max_tool_calls, Math.max(0, stepBudget - steps - 1));
      const requests = parseToolRequests(planCall.text).slice(0, maxCalls);
      const observations = requests.length
        ? await Promise.all(requests.map(async (request) => {
            try {
              const result = await brokerCall(capability, request.tool_ref, request.arguments);
              return { tool_ref: request.tool_ref, ok: true, result: compactObservation(result) };
            } catch (error) {
              return { tool_ref: request.tool_ref, ok: false, error: errorText(error) };
            }
          }))
        : [];
      toolCalls = observations.length;
      steps += toolCalls;

      ensureLocalStep(stepBudget, steps);
      const finalCall = await runAgentInference(this.env, run.id, agent, [
        { role: "system", content: system },
        { role: "user", content: [
          `Task: ${run.task}`,
          "Capability search:",
          compactObservation(search, 8_000),
          observations.length ? "Actual read-only tool observations:" : "No tool call was selected.",
          observations.length ? compactObservation(observations, 22_000) : "",
          "Produce the compact evidence packet now.",
          evidencePrompt(),
        ].filter(Boolean).join("\n\n") },
      ]);
      calls.push(finalCall);
      if (finalCall.gateway_log_id) gatewayLogIds.push(finalCall.gateway_log_id);
      steps += 1;
      const packet = parseEvidencePacket(finalCall.text, {
        agent_id: agent.id,
        agent_name: agent.name,
        kind: agent.kind,
      });
      return {
        steps,
        calls,
        output: {
          agent_id: agent.id,
          agent_name: agent.name,
          round: 1,
          model: finalCall.model,
          output: truncate(finalCall.text, 8_000),
          evidence_packet: packet,
          tool_calls: toolCalls,
          model_calls: calls.length,
          gateway_log_ids: gatewayLogIds,
        },
      };
    }

    const call = await runAgentInference(this.env, run.id, agent, [
      { role: "system", content: system },
      { role: "user", content: [
        `Task: ${run.task}`,
        agent.tool_policy === "read_only" && !capability
          ? "Read-only tool access was not available for this run. State that limitation rather than inventing evidence."
          : "",
        "Produce your bounded evidence packet.",
        evidencePrompt(),
      ].filter(Boolean).join("\n\n") },
    ]);
    calls.push(call);
    if (call.gateway_log_id) gatewayLogIds.push(call.gateway_log_id);
    steps = 1;
    return {
      steps,
      calls,
      output: {
        agent_id: agent.id,
        agent_name: agent.name,
        round: 1,
        model: call.model,
        output: truncate(call.text, 8_000),
        evidence_packet: parseEvidencePacket(call.text, {
          agent_id: agent.id,
          agent_name: agent.name,
          kind: agent.kind,
        }),
        tool_calls: 0,
        model_calls: 1,
        gateway_log_ids: gatewayLogIds,
      },
    };
  }

  private async shouldReview(
    run: RunRecord,
    team: TeamRecord,
    packets: EvidencePacket[],
  ): Promise<boolean> {
    if (team.review_policy === "never") return false;
    if (team.review_policy === "always") return true;
    const fallback = packets.some((packet) =>
      packet.confidence < 0.72 || packet.needs_more_work || packet.uncertainties.length > 0);
    const decision = await askJev(this.env, {
      task: run.task,
      evidence_packets: packets,
    }, {
      needs_review: {
        type: "noul",
        instructions: "Does this result need an independent reviewer before it is returned to the primary model?",
        criteria: {
          true: "Evidence is weak, conflicting, incomplete, or contains risky unsupported conclusions.",
          false: "Evidence is coherent and sufficient for the primary model to continue.",
        },
      },
      contradiction: {
        type: "noul",
        instructions: "Do these evidence packets materially contradict each other?",
      },
      sufficient: {
        type: "noul",
        instructions: "Is the evidence sufficient to answer the task without another specialist pass?",
      },
    });
    this.addJevUsage(run, decision.usage);
    if (!decision.answers) return fallback;
    const review = noulProbability(decision.answers.needs_review);
    const contradiction = noulProbability(decision.answers.contradiction);
    const sufficient = noulProbability(decision.answers.sufficient);
    if (review === null && contradiction === null && sufficient === null) return fallback;
    return (review ?? 0) >= 0.55 || (contradiction ?? 0) >= 0.55 || (sufficient !== null && sufficient < 0.55);
  }

  private completeAdaptive(run: RunRecord, team: TeamRecord): void {
    const packets = evidencePackets(run.state.outputs);
    if (!packets.length) throw new Error("Adaptive run produced no evidence packets.");
    const reviewerId = run.state.reviewer_agent_id;
    const reviewerPacket = reviewerId ? packets.find((packet) => packet.agent_id === reviewerId) : undefined;
    const candidates = packets.filter((packet) => packet.agent_id !== reviewerId);
    const best = [...candidates].sort((left, right) => right.confidence - left.confidence)[0] || packets[0];
    const final = compactFinalResult({
      mode: "adaptive",
      conclusion: reviewerPacket?.conclusion || best.conclusion,
      confidence: reviewerPacket?.confidence ?? best.confidence,
      findings: candidates.map((packet) => ({
        agent: packet.agent_name,
        kind: packet.kind,
        conclusion: packet.conclusion,
        confidence: packet.confidence,
        facts: packet.facts.slice(0, 6),
        evidence: packet.evidence.slice(0, 6),
        uncertainties: packet.uncertainties.slice(0, 3),
      })),
      review: reviewerPacket ? {
        conclusion: reviewerPacket.conclusion,
        confidence: reviewerPacket.confidence,
        uncertainties: reviewerPacket.uncertainties.slice(0, 4),
      } : null,
      proposed_actions: uniqueStrings(packets.flatMap((packet) => packet.proposed_actions)).slice(0, 8),
      routing: run.state.routing || null,
      usage: {
        subagent_input_tokens: run.state.usage.input_tokens,
        subagent_output_tokens: run.state.usage.output_tokens,
        model_calls: run.state.usage.reported_token_calls + run.state.usage.estimated_token_calls,
        decision_calls: run.state.usage.decision_calls,
        target_primary_context_tokens: team.primary_context_tokens,
      },
    }, team.primary_context_tokens);

    run.final_result = final;
    run.status = "completed";
    run.completed_at = new Date().toISOString();
    this.repository.saveRun(run);
    this.repository.clearRunCapability(run.id);
  }

  private async processLegacy(run: RunRecord, team: TeamRecord, agents: AgentRecord[]): Promise<void> {
    const coordinator = agents.find((agent) => agent.id === team.coordinator_agent_id);
    if (!coordinator) throw new Error("Coordinator agent is missing from the team.");
    const members = agents.filter((agent) => agent.id !== coordinator.id);

    if (run.stage === "planning") {
      ensureStepAvailable(run);
      const call = await this.callAgent(run.id, coordinator, [
        `Task: ${run.task}`,
        `Team members: ${members.map((agent) => `${agent.name} — ${agent.role}`).join("; ")}`,
        "Create a concise delegation plan. Assign one concrete deliverable to each specialist and define the final acceptance criteria.",
      ].join("\n\n"));
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
        const previous = run.state.outputs.filter((item) => item.agent_id === agent.id).at(-1)?.output;
        const call = await this.callAgent(run.id, agent, [
          `Overall task: ${run.task}`,
          `Coordinator plan: ${run.state.coordinator_plan || "No plan available."}`,
          run.state.feedback ? `Coordinator feedback for revision: ${run.state.feedback}` : "",
          previous ? `Your previous-round output: ${truncate(previous, 20_000)}` : "",
          `Your responsibility: ${agent.role}`,
          "Produce your assigned deliverable. Be explicit about assumptions, risks, and unresolved questions.",
        ].filter(Boolean).join("\n\n"));
        run.state.outputs.push({
          agent_id: agent.id,
          agent_name: agent.name,
          round: run.state.round,
          model: call.model,
          output: call.text,
          model_calls: 1,
          gateway_log_ids: call.gateway_log_id ? [call.gateway_log_id] : [],
        });
        run.state.member_index += 1;
        run.state.steps_completed += 1;
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
      const call = await this.callAgent(run.id, coordinator, [
        `Task: ${run.task}`,
        `Round ${run.state.round} specialist outputs:`,
        compactOutputs(run.state.outputs.filter((item) => item.round === run.state.round)),
        "Review the outputs. Identify contradictions, missing evidence, and concrete revision instructions for the next round.",
      ].join("\n\n"));
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
    const call = await this.callAgent(run.id, coordinator, [
      `Task: ${run.task}`,
      `Coordinator plan: ${run.state.coordinator_plan || "No plan available."}`,
      "Specialist outputs:",
      compactOutputs(run.state.outputs),
      "Synthesize one final result. Resolve conflicts, separate verified conclusions from assumptions, and finish with recommended next actions.",
    ].join("\n\n"));
    run.state.steps_completed += 1;
    addUsage(run.state.usage, call);
    run.final_result = call.text;
    run.status = "completed";
    run.completed_at = new Date().toISOString();
    this.repository.saveRun(run);
    this.repository.clearRunCapability(run.id);
  }

  private async callAgent(runId: string, agent: AgentRecord, userPrompt: string): Promise<AgentCallResult> {
    return runAgentInference(this.env, runId, agent, [
      {
        role: "system",
        content: `${agent.instructions}\n\nYou are ${agent.name}. Your role is ${agent.role}. Stay within this role and do not claim to have used tools or sources that were not provided.`,
      },
      { role: "user", content: truncate(userPrompt, 70_000) },
    ]);
  }

  private addJevUsage(
    run: RunRecord,
    usage?: { input_tokens: number; output_tokens: number; estimated_cost_usd: number },
  ): void {
    if (!usage) return;
    run.state.usage.input_tokens += usage.input_tokens;
    run.state.usage.output_tokens += usage.output_tokens;
    run.state.usage.estimated_cost_usd = Math.round(
      (run.state.usage.estimated_cost_usd + usage.estimated_cost_usd) * 1_000_000_000,
    ) / 1_000_000_000;
    run.state.usage.decision_calls += 1;
  }
}

function deterministicWorkers(task: string, workers: AgentRecord[]): AgentRecord[] {
  const scouts = workers.filter((agent) => agent.kind === "scout");
  const specialists = workers.filter((agent) => agent.kind === "specialist");
  const investigation = /\b(investigat|research|find|search|log|error|incident|audit|repository|workflow|diagnos|compare|inspect|check)\b/i.test(task);
  const selected: AgentRecord[] = [];
  if (investigation && scouts[0]) selected.push(scouts[0]);
  if (specialists[0] && (!investigation || task.length > 500)) selected.push(specialists[0]);
  if (!selected.length) selected.push(scouts[0] || specialists[0] || workers[0]);
  return selected;
}

function evidencePackets(outputs: RunOutput[]): EvidencePacket[] {
  return outputs.flatMap((output) => output.evidence_packet ? [output.evidence_packet] : []);
}

function parseToolRequests(text: string): Array<{ tool_ref: string; arguments: Record<string, unknown> }> {
  const parsed = parseObject(text);
  const requests = Array.isArray(parsed?.tool_requests) ? parsed.tool_requests : [];
  return requests.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.tool_ref !== "string" || !row.tool_ref.trim()) return [];
    const args = row.arguments && typeof row.arguments === "object" && !Array.isArray(row.arguments)
      ? row.arguments as Record<string, unknown>
      : {};
    return [{ tool_ref: row.tool_ref.trim(), arguments: args }];
  });
}

function parseObject(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\\s*/iu, "").replace(/\\s*```$/u, "");
  try {
    const value = JSON.parse(cleaned) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const value = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
        if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function ensureStepAvailable(run: RunRecord): void {
  if (run.state.steps_completed >= run.state.max_steps) {
    throw new Error(`The agent run reached its ${run.state.max_steps}-step limit.`);
  }
}

function ensureLocalStep(stepBudget: number, used: number): void {
  if (used >= stepBudget) throw new Error("Adaptive worker exhausted its assigned step budget.");
}

function compactFinalResult(value: Record<string, unknown>, maxTokens: number): string {
  const maxChars = Math.max(2_000, maxTokens * 4);
  let json = JSON.stringify(value);
  if (json.length <= maxChars) return json;
  const compact = { ...value } as Record<string, unknown>;
  const findings = Array.isArray(compact.findings) ? compact.findings as Array<Record<string, unknown>> : [];
  compact.findings = findings.slice(0, 4).map((finding) => ({
    agent: finding.agent,
    kind: finding.kind,
    conclusion: truncate(String(finding.conclusion || ""), 1_500),
    confidence: finding.confidence,
    evidence: Array.isArray(finding.evidence) ? finding.evidence.slice(0, 3) : [],
    uncertainties: Array.isArray(finding.uncertainties) ? finding.uncertainties.slice(0, 2) : [],
  }));
  if (typeof compact.conclusion === "string") compact.conclusion = truncate(compact.conclusion, 2_000);
  json = JSON.stringify(compact);
  if (json.length <= maxChars) return json;
  return JSON.stringify({
    mode: "adaptive",
    conclusion: truncate(String(compact.conclusion || ""), Math.max(500, maxChars - 800)),
    confidence: compact.confidence,
    proposed_actions: Array.isArray(compact.proposed_actions) ? compact.proposed_actions.slice(0, 3) : [],
    note: "Result compacted to the configured primary-model context budget. Detailed evidence remains in run outputs.",
  });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
