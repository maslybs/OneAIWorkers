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

test("proposes a reviewable team without creating or invoking agents", () => {
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
  assert.equal(proposal.team.coordinator_index, 0);
  assert.equal(proposal.create_payload.confirmed, false);
  assert.ok(proposal.estimate.estimated_calls > 0);
  assert.ok(proposal.estimate.estimated_cost_usd >= 0);
  assert.ok(proposal.estimate.estimated_neurons > 0);
  assert.ok(proposal.estimate.maximum_neurons >= proposal.estimate.estimated_neurons);
  assert.equal(proposal.estimate.billing_type, "workers_ai_neurons");
  assert.ok(proposal.estimate.breakdown.every((item) => item.maximum_output_tokens >= item.output_tokens));
  assert.match(proposal.orchestration.stop_and_control.join(" "), /agent_run_cancel/u);
});

test("reports that agent teams use one Durable Object and no Worker API key", () => {
  const capabilities = agents.agentCapabilities({ AI: {}, AGENT_MANAGER: {} });
  assert.equal(capabilities.configured, true);
  assert.equal(capabilities.creates_new_workers, false);
  assert.equal(capabilities.requires_cloudflare_api_token, false);
  assert.equal(capabilities.execution.background_progress, true);
  assert.equal(capabilities.execution.connector_tool_execution, false);
});

test("refuses an agent run that cannot fit within max_steps", async () => {
  const team = {
    id: "team-1",
    name: "Review team",
    description: "",
    coordinator_agent_id: "coordinator",
    member_agent_ids: ["coordinator", "reviewer"],
    enabled: true,
    max_rounds: 2,
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
