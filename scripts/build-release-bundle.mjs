import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "release");
const bundleName = "oneaiworkers-worker.mjs";
const metadataName = "oneaiworkers-release.json";
const checksumName = `${bundleName}.sha256`;

const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const updateManifest = JSON.parse(await readFile(resolve(projectRoot, "update-manifest.json"), "utf8"));
const updateSource = await readFile(resolve(projectRoot, "src/update.ts"), "utf8");
const sourceVersion = updateSource.match(/export const APP_VERSION = "([^"]+)"/u)?.[1];
const version = String(packageJson.version || "");

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
  throw new Error("package.json contains an invalid version.");
}
if (sourceVersion !== version || updateManifest.latest_version !== version) {
  throw new Error("package.json, APP_VERSION, and update-manifest.json must use the same version.");
}

const result = await build({
  absWorkingDir: projectRoot,
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  conditions: ["worker", "browser"],
  external: ["cloudflare:*"],
  minify: true,
  write: false,
  legalComments: "none",
});

const code = result.outputFiles[0]?.text;
if (!code || code.length < 100_000) throw new Error("The OneAIWorkers release bundle is unexpectedly small.");
if (code.length > 4 * 1024 * 1024) throw new Error("The OneAIWorkers release bundle exceeds 4 MiB.");
if (!code.includes("AgentManager") || !code.includes("export")) {
  throw new Error("The OneAIWorkers release bundle does not expose the required Worker exports.");
}

const sha256 = createHash("sha256").update(code, "utf8").digest("hex");
const metadata = {
  schema_version: 1,
  version,
  source_repository: "maslybs/OneAIWorkers",
  source_commit: process.env.GITHUB_SHA || null,
  bundle: {
    name: bundleName,
    bytes: Buffer.byteLength(code, "utf8"),
    sha256,
  },
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, bundleName), code, "utf8"),
  writeFile(resolve(outputDirectory, checksumName), `${sha256}  ${bundleName}\n`, "utf8"),
  writeFile(resolve(outputDirectory, metadataName), `${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
]);

console.log(`Built OneAIWorkers ${version}: ${metadata.bundle.bytes} bytes, sha256 ${sha256}.`);
