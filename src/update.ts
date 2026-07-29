import { bilingualObject } from "./i18n";
import { assertSafeOutboundUrl, fetchWithSafeRedirects } from "./security";
import type { Env, UpdateNotice } from "./types";

export const APP_VERSION = "0.6.1";

const DEFAULT_MANIFEST_URL = "https://raw.githubusercontent.com/maslybs/OneAIWorkers/main/update-manifest.json";
const MANIFEST_CACHE_MS = 6 * 60 * 60 * 1000;
const FAILED_CACHE_MS = 5 * 60 * 1000;
const MAX_MANIFEST_BYTES = 32_000;

interface UpdateManifest {
  schema_version: 1;
  latest_version: string;
  minimum_supported_version?: string;
  update_service_url?: string;
  release_notes_url?: string;
  critical?: boolean;
  message?: {
    en?: string;
    uk?: string;
  };
}

export interface UpdateState {
  status: "available" | "current" | "disabled" | "unavailable";
  current_version: string;
  latest_version?: string;
  update_url: string;
  update_service_url?: string;
  release_notes_url?: string;
  critical?: boolean;
  message?: {
    en: string;
    uk: string;
  };
}

interface ManifestCacheEntry {
  expiresAt: number;
  value: UpdateManifest | null;
}

const manifestCache = new Map<string, ManifestCacheEntry>();

export async function getUpdateState(env: Env, baseUrl: string): Promise<UpdateState> {
  const updateUrl = new URL("/update", ensureTrailingSlash(baseUrl)).toString();
  if (env.UPDATE_CHECK_ENABLED?.trim().toLowerCase() === "false") {
    return { status: "disabled", current_version: APP_VERSION, update_url: updateUrl };
  }

  const manifestUrl = env.UPDATE_MANIFEST_URL?.trim() || DEFAULT_MANIFEST_URL;
  try {
    const manifest = await getManifest(manifestUrl);
    if (!manifest) return { status: "unavailable", current_version: APP_VERSION, update_url: updateUrl };
    return evaluateUpdateManifest(manifest, updateUrl, env.UPDATE_SERVICE_URL);
  } catch {
    return { status: "unavailable", current_version: APP_VERSION, update_url: updateUrl };
  }
}

export function updateNotice(state: UpdateState): UpdateNotice | undefined {
  if (state.status !== "available" || !state.latest_version) return undefined;
  return {
    available: true,
    current_version: state.current_version,
    latest_version: state.latest_version,
    critical: Boolean(state.critical),
    update_url: state.update_url,
    release_notes_url: state.release_notes_url,
    message: state.message || bilingualObject(
      "A newer OneAIWorkers version is available.",
      "Доступна новіша версія OneAIWorkers.",
    ),
  };
}

export function updateServiceStartUrl(state: UpdateState, baseUrl: string): string | null {
  if (state.status !== "available" || !state.update_service_url || !state.latest_version) return null;
  const serviceUrl = assertSafeOutboundUrl(state.update_service_url);
  serviceUrl.searchParams.set("worker_url", baseUrl);
  serviceUrl.searchParams.set("current_version", state.current_version);
  serviceUrl.searchParams.set("latest_version", state.latest_version);
  serviceUrl.searchParams.set("return_url", new URL("/update", ensureTrailingSlash(baseUrl)).toString());
  return serviceUrl.toString();
}

export function evaluateUpdateManifest(
  manifest: UpdateManifest,
  updateUrl: string,
  serviceUrlOverride?: string,
): UpdateState {
  const normalized = validateManifest(manifest);
  const available = compareVersions(normalized.latest_version, APP_VERSION) > 0;
  const updateServiceUrl = serviceUrlOverride?.trim() || normalized.update_service_url;
  if (updateServiceUrl) assertSafeOutboundUrl(updateServiceUrl);

  return {
    status: available ? "available" : "current",
    current_version: APP_VERSION,
    latest_version: normalized.latest_version,
    update_url: assertSafeOutboundUrl(updateUrl).toString(),
    update_service_url: updateServiceUrl,
    release_notes_url: normalized.release_notes_url,
    critical: available && Boolean(normalized.critical),
    message: normalized.message
      ? {
          en: normalized.message.en || "A newer OneAIWorkers version is available.",
          uk: normalized.message.uk || "Доступна новіша версія OneAIWorkers.",
        }
      : undefined,
  };
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts.numbers[index] !== rightParts.numbers[index]) {
      return leftParts.numbers[index] > rightParts.numbers[index] ? 1 : -1;
    }
  }
  if (leftParts.prerelease === rightParts.prerelease) return 0;
  if (!leftParts.prerelease) return 1;
  if (!rightParts.prerelease) return -1;
  return leftParts.prerelease.localeCompare(rightParts.prerelease);
}

async function getManifest(rawUrl: string): Promise<UpdateManifest | null> {
  const manifestUrl = assertSafeOutboundUrl(rawUrl).toString();
  const now = Date.now();
  const cached = manifestCache.get(manifestUrl);
  if (cached && cached.expiresAt > now) return cached.value;

  try {
    const response = await fetchWithSafeRedirects(manifestUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) throw new Error(`Update manifest returned ${response.status}.`);
    const text = await response.text();
    if (text.length > MAX_MANIFEST_BYTES) throw new Error("Update manifest is too large.");
    const manifest = validateManifest(JSON.parse(text) as UpdateManifest);
    manifestCache.set(manifestUrl, { expiresAt: now + MANIFEST_CACHE_MS, value: manifest });
    return manifest;
  } catch {
    manifestCache.set(manifestUrl, { expiresAt: now + FAILED_CACHE_MS, value: null });
    return null;
  }
}

function validateManifest(value: UpdateManifest): UpdateManifest {
  if (!value || typeof value !== "object" || value.schema_version !== 1) {
    throw new Error("Unsupported update manifest.");
  }
  parseVersion(value.latest_version);
  if (value.minimum_supported_version) parseVersion(value.minimum_supported_version);
  if (value.update_service_url) value.update_service_url = assertSafeOutboundUrl(value.update_service_url).toString();
  if (value.release_notes_url) value.release_notes_url = assertSafeOutboundUrl(value.release_notes_url).toString();
  if (value.message?.en && value.message.en.length > 500) throw new Error("Update message is too long.");
  if (value.message?.uk && value.message.uk.length > 500) throw new Error("Update message is too long.");
  return value;
}

function parseVersion(version: string): { numbers: [number, number, number]; prerelease: string } {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) throw new Error("Invalid OneAIWorkers version.");
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] || "",
  };
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
