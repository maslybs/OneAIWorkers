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

test("exposes live system, native AI, and agent actions through the stable connector discovery method", async () => {
  const listed = await integrations.listConnectors({}, { include_actions: true });
  assert.equal(listed.ok, true);
  assert.equal(listed.runtime.http_cache, "no-store");
  const system = listed.connectors.find((connector) => connector.connector_id === "system");
  assert.ok(system);
  assert.equal(system.virtual, true);
  const systemActionNames = system.actions.map((action) => action.name);
  assert.ok(systemActionNames.includes("runtime_info"));
  assert.ok(systemActionNames.includes("connector_installation_help"));
  assert.ok(systemActionNames.includes("find_capability"));
  assert.ok(systemActionNames.includes("get_connector_settings_link"));
  assert.ok(systemActionNames.includes("save_connector"));
  assert.ok(systemActionNames.includes("delete_connector"));

  const native = listed.connectors.find((connector) => connector.connector_id === "native");
  assert.ok(native);
  assert.equal(native.virtual, true);
  const actionNames = native.actions.map((action) => action.name);
  assert.ok(actionNames.includes("agent_team_propose"));
  assert.ok(actionNames.includes("agent_run_status"));
  assert.ok(actionNames.includes("ai_recommend_model"));
  assert.ok(actionNames.includes("ai_neuron_status"));
  assert.ok(actionNames.includes("ai_neuron_history"));
  assert.ok(actionNames.includes("ai_chat"));
});

test("routes a cached client's native settings-link call to the live system gateway", async () => {
  const result = await integrations.callConnectorTool({}, {
    connector_id: "native",
    action_name: "get_connector_settings_link",
    input: { connector_id: "n8n" },
    dry_run: true,
    confirmed: false,
  });
  assert.equal(result.system, true);
  assert.equal(result.action_name, "get_connector_settings_link");
  assert.equal(result.dry_run, true);
  assert.deepEqual(result.validated_input, { connector_id: "n8n" });
  assert.equal(result.gateway_runtime.http_cache, "no-store");
});

test("returns the current runtime through the stable system connector", async () => {
  const result = await integrations.callConnectorTool({}, {
    connector_id: "system",
    action_name: "runtime_info",
    input: {},
    dry_run: false,
    confirmed: false,
  }, "https://worker.example");
  assert.equal(result.system, true);
  assert.equal(result.action_name, "runtime_info");
  assert.equal(result.result.version, result.gateway_runtime.version);
  assert.equal(result.result.stable_gateway.system_connector_id, "system");
});

test("keeps the legacy system alias working for native actions", async () => {
  const result = await integrations.callConnectorTool({}, {
    connector_id: "system",
    action_name: "agent_team_propose",
    input: {
      task: "Review a compatibility change",
      max_agents: 2,
      priority: "balanced",
      max_rounds: 1,
      expected_input_tokens_per_call: 1_000,
      expected_output_tokens_per_call: 400,
    },
    dry_run: false,
    confirmed: false,
  });
  assert.equal(result.native, true);
  assert.equal(result.action_name, "agent_team_propose");
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

test("reads neuron meter status through the frozen call_connector_tool schema", async () => {
  const result = await integrations.callConnectorTool({}, {
    connector_id: "native",
    action_name: "ai_neuron_status",
    input: {},
    dry_run: false,
    confirmed: false,
  });
  assert.equal(result.native, true);
  assert.equal(result.action_name, "ai_neuron_status");
  assert.equal(result.result.configured, false);
  assert.equal(result.result.daily_allocation, 10_000);
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

test("saves connector actions with the exact D1 placeholder count", async () => {
  const db = strictD1Mock();
  const result = await integrations.saveConnector({ OAUTH_DB: db }, {
    connector_id: "sample",
    name: "Sample",
    description: "Test connector",
    mode: "internal",
    actions: [{
      name: "list_items",
      description: "List items",
      method: "GET",
      url: "https://api.example.com/items",
      auth: { type: "none" },
      headers: {},
      query: {},
      input_schema: { type: "object", properties: {} },
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.stable_gateway_ready, true);
  assert.equal(result.refresh_required_for_shortcut_tools_only, true);
});

function strictD1Mock() {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          const expected = (sql.match(/\?/gu) || []).length;
          assert.equal(values.length, expected, `D1 bind count mismatch for: ${sql}`);
          return this;
        },
        async run() {
          return { success: true };
        },
        async all() {
          return { results: [] };
        },
        async first() {
          return null;
        },
      };
    },
    async batch(statements) {
      return statements.map(() => ({ success: true }));
    },
  };
}
