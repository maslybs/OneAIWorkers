import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({
  absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
  entryPoints: ["src/tools/integrations.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
});
const moduleSource = result.outputFiles[0]?.text;
assert.ok(moduleSource);
const integrations = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);

test("exposes native AI and agent actions through the stable connector discovery method", async () => {
  const listed = await integrations.listConnectors({}, { include_actions: true });
  const native = listed.connectors.find((connector) => connector.connector_id === "native");
  assert.ok(native);
  assert.equal(native.virtual, true);
  const actionNames = native.actions.map((action) => action.name);
  assert.ok(actionNames.includes("agent_team_propose"));
  assert.ok(actionNames.includes("agent_run_status"));
  assert.ok(actionNames.includes("ai_recommend_model"));
  assert.ok(actionNames.includes("ai_chat"));
});

test("runs proposal-only agent discovery through the frozen call_connector_tool schema", async () => {
  const result = await integrations.callConnectorTool({}, {
    connector_id: "native",
    action_name: "agent_team_propose",
    input: {
      task: "Design and review a secure TypeScript API migration",
      max_agents: 4,
      priority: "balanced",
      max_rounds: 1,
      expected_input_tokens_per_call: 2_000,
      expected_output_tokens_per_call: 800,
    },
    dry_run: false,
    confirmed: false,
  });
  assert.equal(result.native, true);
  assert.equal(result.action_name, "agent_team_propose");
  assert.equal(result.result.proposal_only, true);
  assert.equal(result.result.created, false);
});

test("validates native AI calls in dry-run mode without consuming AI", async () => {
  const result = await integrations.callConnectorTool({}, {
    connector_id: "native",
    action_name: "ai_chat",
    input: {
      profile: "fast",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 128,
      temperature: 0.2,
    },
    dry_run: true,
    confirmed: false,
  });
  assert.equal(result.dry_run, true);
  assert.equal(result.consumes_ai, true);
  assert.equal(result.requires_confirmation, true);
});

test("requires generic confirmation before native AI inference", async () => {
  await assert.rejects(
    integrations.callConnectorTool({}, {
      connector_id: "native",
      action_name: "ai_chat",
      input: {
        profile: "fast",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 128,
        temperature: 0.2,
      },
      dry_run: false,
      confirmed: false,
    }),
    /Explicit confirmation is required/u,
  );
});
