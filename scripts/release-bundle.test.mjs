import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const updateManifest = JSON.parse(await readFile(new URL("../update-manifest.json", import.meta.url), "utf8"));
const metadata = JSON.parse(await readFile(new URL("../release/oneaiworkers-release.json", import.meta.url), "utf8"));
const bundle = await readFile(new URL("../release/oneaiworkers-worker.mjs", import.meta.url), "utf8");
const checksumFile = await readFile(new URL("../release/oneaiworkers-worker.mjs.sha256", import.meta.url), "utf8");

test("publishes one version across source, manifest, and release metadata", () => {
  assert.equal(metadata.schema_version, 1);
  assert.equal(metadata.version, packageJson.version);
  assert.equal(metadata.version, updateManifest.latest_version);
  assert.equal(metadata.source_repository, "maslybs/OneAIWorkers");
  assert.equal(metadata.bundle.name, "oneaiworkers-worker.mjs");
});

test("publishes a self-contained Worker bundle with a matching checksum", () => {
  const sha256 = createHash("sha256").update(bundle, "utf8").digest("hex");
  assert.equal(metadata.bundle.bytes, Buffer.byteLength(bundle, "utf8"));
  assert.equal(metadata.bundle.sha256, sha256);
  assert.equal(checksumFile, `${sha256}  oneaiworkers-worker.mjs\n`);
  assert.ok(bundle.length > 100_000);
  assert.match(bundle, /AgentManager/u);
  assert.match(bundle, /export/u);
});
