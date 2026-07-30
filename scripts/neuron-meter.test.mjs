import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({
  absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
  entryPoints: ["src/tools/neuron-meter.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
});
const moduleSource = result.outputFiles[0]?.text;
assert.ok(moduleSource);
const meter = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);

test("classifies Workers AI separately from Unified Billing models", () => {
  assert.equal(meter.billingTypeForModel("@cf/openai/gpt-oss-120b"), "workers_ai_neurons");
  assert.equal(meter.billingTypeForModel("openai/gpt-4.1-mini"), "unified_billing_usd");
});

test("converts equivalent token pricing to neurons without double-counting cached input", () => {
  const billing = meter.calculateWorkersAiBilling({
    prompt_tokens: 1_000,
    completion_tokens: 500,
    cached_tokens: 200,
  }, {
    input: 0.35,
    output: 0.75,
    cached_input: 0.07,
  });
  assert.equal(billing.estimated_cost_usd, 0.000669);
  assert.equal(billing.estimated_neurons, 60.818182);
});

test("uses Cloudflare-reported usage when present", () => {
  const usage = meter.resolveTokenUsage({}, {
    response: "ok",
    usage: {
      prompt_tokens: 1_000,
      completion_tokens: 500,
      total_tokens: 1_500,
    },
  });
  assert.deepEqual(usage, {
    prompt_tokens: 1_000,
    completion_tokens: 500,
    cached_tokens: 0,
    total_tokens: 1_500,
    source: "local_reported_tokens",
  });
});

test("falls back to local token estimation when usage is absent", () => {
  const usage = meter.resolveTokenUsage(
    { messages: [{ role: "user", content: "12345678" }] },
    { response: "1234" },
  );
  assert.equal(usage.prompt_tokens, 2);
  assert.equal(usage.completion_tokens, 1);
  assert.equal(usage.source, "local_estimated_tokens");
});

test("resets at the next UTC midnight", () => {
  assert.equal(meter.nextUtcReset("2026-07-30T23:59:59.000Z"), "2026-07-31T00:00:00.000Z");
});

test("recognizes Cloudflare daily neuron limit error 3036", () => {
  assert.equal(meter.isDailyNeuronLimitError(new Error("code 3036: daily free allocation exhausted")), true);
  assert.equal(meter.isDailyNeuronLimitError(new Error("out of capacity 3040")), false);
});

test("persists a metered call and returns the D1 daily aggregate without multi-statement D1 exec", async () => {
  const usageRows = [];
  const schemaStatements = [];
  const db = {
    exec: async () => {
      throw new Error("multi-statement exec must not be used for neuron schema bootstrap");
    },
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async run() {
          if (sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX")) {
            schemaStatements.push(sql);
          }
          if (sql.includes("INSERT INTO ai_neuron_usage")) {
            usageRows.push({
              neurons: Number(this.values[10] || 0),
              source: String(this.values[11]),
            });
          }
          return { success: true };
        },
        async first() {
          if (sql.includes("FROM ai_neuron_usage")) {
            return {
              neurons_today: usageRows.reduce((sum, row) => sum + row.neurons, 0),
              requests_today: usageRows.length,
              reported_token_requests: usageRows.filter((row) => row.source === "local_reported_tokens").length,
              estimated_token_requests: usageRows.filter((row) => row.source === "local_estimated_tokens").length,
              unmetered_requests: 0,
            };
          }
          if (sql.includes("FROM ai_neuron_events")) return { count: 0 };
          return null;
        },
        async all() {
          return { results: [] };
        },
      };
      return statement;
    },
  };
  const response = await meter.runMeteredWorkersAi({
    OAUTH_DB: db,
    AI: {
      run: async () => ({
        response: "hello",
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
    },
  }, {
    model: "@cf/openai/gpt-oss-20b",
    input: { messages: [{ role: "user", content: "hello" }] },
    pricing: { input: 0.2, output: 0.3 },
  });
  assert.equal(schemaStatements.length, 6);
  assert.ok(schemaStatements.every((sql) => !sql.trimEnd().endsWith(";")));
  assert.equal(usageRows.length, 1);
  assert.equal(response.billing.today_psy_neurons, 2.363636);
  assert.equal(response.billing.remaining_neurons, 9_997.636364);
  assert.equal(response.billing.usage_percent, 0.023636);
});

test("returns billing after a metered Workers AI call even when D1 is unavailable", async () => {
  const response = await meter.runMeteredWorkersAi({
    AI: {
      run: async () => ({
        response: "hello",
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
    },
  }, {
    model: "@cf/openai/gpt-oss-20b",
    input: { messages: [{ role: "user", content: "hello" }] },
    pricing: { input: 0.2, output: 0.3 },
  });
  assert.equal(response.billing.source, "local_reported_tokens");
  assert.equal(response.billing.prompt_tokens, 100);
  assert.equal(response.billing.completion_tokens, 20);
  assert.equal(response.billing.estimated_neurons, 2.363636);
  assert.equal(response.billing.today_psy_neurons, null);
  assert.match(response.billing.tracking_error, /D1 database is not configured/u);
});
