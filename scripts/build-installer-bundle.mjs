import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const updateSource = await readFile(resolve(projectRoot, "src/update.ts"), "utf8");
const version = updateSource.match(/export const APP_VERSION = "([^"]+)"/)?.[1];
if (!version) throw new Error("Could not read APP_VERSION from src/update.ts.");

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
if (!code) throw new Error("OneAIWorkers bundle is empty.");

const outputPath = resolve(projectRoot, "installer/generated/oneaiworkers-bundle.js");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `export const ONEAIWORKERS_VERSION = ${JSON.stringify(version)};\nexport const ONEAIWORKERS_CODE = ${JSON.stringify(code)};\n`,
  "utf8",
);

console.log(`Built OneAIWorkers ${version} for the installer (${code.length} bytes).`);
