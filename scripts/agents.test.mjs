import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({
  absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
  entryPoints: ["src/agents/index.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
});
const moduleSource = result.outputFiles[0]?.text;
assert.ok(moduleSource);
const agents = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);

test("proposes an adaptive token-saving team without creating or invoking agents", () => {
  const proposal = agents.agentTeamPropose({
    task: "Design and test a secure TypeScript API migration",
    max_agents: 4,
    priority: "balanced",
    max_rounds: 2,
    max_budget_usd: 0.5,
    expected_input_tokens_per_call: 2_000,
    expected_output_tokens_per_call: 800,
  });
  assert.equal(proposal.proposal_only, true);
  assert.equal(proposal.created, false);
  assert.equal(proposal.requires_explicit_confirmation, true);
  assert.equal(proposal.task_category, "coding");
  assert.equal(proposal.team.agents.length, 4);
  assert.equal(proposal.team.strategy, "adaptive");
  assert.equal(proposal.create_payload.strategy, "adaptive");
  assert.equal(proposal.create_payload.confirmed, false);
  assert.ok(proposal.team.agents.some((agent) => agent.kind === "scout" && agent.tool_policy === "read_only"));
  assert.ok(proposal.team.agents.some((agent) => agent.kind === "reviewer"));
  assert.ok(proposal.estimate.estimated_calls > 0);
  assert.ok(proposal.estimate.estimated_cost_usd >= 0);
  assert.ok(proposal.estimate.estimated_neurons > 0);
  assert.ok(proposal.estimate.maximum_neurons >= proposal.estimate.estimated_neurons);
  assert.equal(proposal.estimate.billing_type, "workers_ai_neurons");
  assert.match(proposal.orchestration.sequence.join(" "), /Jev/u);
  assert.match(proposal.orchestration.sequence.join(" "), /read-only|read_only/u);
});

test("reports adaptive read-only tools, AI Gateway and optional Jev", () => {
  const capabilities = agents.agentCapabilities({
    AI: {},
    AGENT_MANAGER: {},
    AI_GATEWAY_ID: "oneaiworkers",
  });
  assert.equal(capabilities.configured, true);
  assert.equal(capabilities.creates_new_workers, false);
  assert.equal(capabilities.requires_cloudflare_api_token, false);
  assert.equal(capabilities.execution.background_progress, true);
  assert.equal(capabilities.execution.connector_tool_execution, "read_only_adaptive");
  assert.equal(capabilities.ai_gateway.gateway_id_configured, true);
  assert.equal(capabilities.jev.configured, false);
});

test("compact evidence packets bound free-form model output", () => {
  const packet = agents.parseEvidencePacket(JSON.stringify({
    conclusion: "Root cause found",
    confidence: 0.91,
    facts: Array.from({ length: 20 }, (_, index) => `fact-${index}`),
    evidence: Array.from({ length: 20 }, (_, index) => ({ source: "log", detail: `evidence-${index}` })),
    uncertainties: ["one"],
    proposed_actions: ["fix"],
    needs_more_work: false,
  }), { agent_id: "a1", agent_name: "Scout", kind: "scout" });
  assert.equal(packet.conclusion, "Root cause found");
  assert.equal(packet.facts.length, 10);
  assert.equal(packet.evidence.length, 10);
  assert.equal(packet.confidence, 0.91);
});

test("Jev is optional and does not make the agent runtime unavailable", async () => {
  assert.equal(agents.jevConfigured({}), false);
  const result = await agents.askJev({}, { task: "test" }, {
    relevant: { type: "noul", instructions: "Is this relevant?" },
  });
  assert.deepEqual(result, { configured: false });
});

test("legacy teams keep the existing max_steps contract", async () => {
  const team = {
    id: "team-1",
    name: "Review team",
    description: "",
    coordinator_agent_id: "coordinator",
    member_agent_ids: ["coordinator", "reviewer"],
    enabled: true,
    max_rounds: 2,
    strategy: "legacy",
    max_parallel: 1,
    review_policy: "on_uncertainty",
    primary_context_tokens: 2500,
    expected_input_tokens_per_call: 100,
    expected_output_tokens_per_call: 100,
    max_budget_usd: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const agent = (id) => ({
    id,
    name: id,
    role: id,
    instructions: "Review the task.",
    profile: "fast",
    kind: "specialist",
    tool_policy: "none",
    allowed_plugin_ids: [],
    max_tool_calls: 0,
    enabled: true,
    max_output_tokens: 100,
    temperature: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const repository = {
    requireTeam: () => team,
    requireAgent: (id) => agent(id),
    insertRun: () => assert.fail("A rejected run must not be stored."),
  };
  const state = { storage: { setAlarm: () => assert.fail("A rejected run must not schedule an alarm.") } };
  const orchestrator = new agents.AgentOrchestrator(state, { AI: {} }, repository);

  await assert.rejects(
    () => orchestrator.startRun("team-1", "Review this change", undefined, 4),
    /needs 5 steps, which exceeds the requested limit of 4/u,
  );
});
