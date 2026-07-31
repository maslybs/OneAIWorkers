import { z } from "zod";
import { biInline } from "./i18n";
import { assertSafeOutboundUrl, safeKey } from "./security";
import type { Env } from "./types";

const DEFAULT_CATALOG_URL = "https://marketplace.bgdn.dev/api/catalog";
const CATALOG_CACHE_MS = 10 * 60 * 1000;

export interface MarketplaceTarget {
  id: string;
  runtime: string;
  version: string;
  package_url: string;
  package_format: string;
  checksum: string;
  signature?: string;
  permissions?: string[];
  requirements?: string[];
}

export interface MarketplaceItem {
  id: string;
  type: string;
  name: string;
  description: string;
  version: string;
  section?: string;
  tags?: string[];
  capabilities?: string[];
  use_cases?: string[];
  aliases?: string[];
  locales?: Record<string, { name?: string; description?: string }>;
  targets?: MarketplaceTarget[] | Record<string, MarketplaceTarget>;
  package_url?: string;
  package_format?: string;
  checksum?: string;
  permissions?: string[];
}

export interface InstalledPackageRow {
  connector_id: string;
  package_id: string;
  target_id: string;
  installed_version: string;
  checksum: string;
  child_script_name: string | null;
  credential_fields_json: string;
  catalog_url: string;
  installed_at: number;
  updated_at: number;
}

interface CatalogCache {
  url: string;
  expiresAt: number;
  items: MarketplaceItem[];
}

let catalogCache: CatalogCache | null = null;

export const findCapabilitySchema = {
  query: z.string().min(2).max(300).describe(biInline(
    "Describe what the user wants to do. The text stays inside this Worker; only the public catalog is downloaded.",
    "Опишіть, що хоче зробити користувач. Цей текст лишається всередині Worker; завантажується лише публічний каталог.",
  )),
  limit: z.number().int().min(1).max(10).default(5),
  language: z.enum(["en", "uk"]).default("en"),
};

export const connectorSettingsLinkSchema = {
  connector_id: z.string().min(2).max(80),
};

export const connectorUpdatesSchema = {};

export async function ensureMarketplaceSchema(env: Env): Promise<void> {
  const db = getDb(env);
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS connector_packages (
      connector_id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      installed_version TEXT NOT NULL,
      checksum TEXT NOT NULL,
      child_script_name TEXT,
      credential_fields_json TEXT NOT NULL DEFAULT '[]',
      catalog_url TEXT NOT NULL,
      installed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS connector_install_nonces (
      nonce TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  ]) {
    await db.prepare(sql).run();
  }
}

export async function findCapability(
  env: Env,
  baseUrl: string,
  args: z.infer<z.ZodObject<typeof findCapabilitySchema>>,
) {
  const items = await fetchMarketplaceCatalog(env);
  const queryTerms = terms(args.query);
  const ranked = items
    .map((item) => ({ item, target: cloudTarget(item), score: scoreItem(item, queryTerms) }))
    .filter((entry): entry is { item: MarketplaceItem; target: MarketplaceTarget; score: number } => Boolean(entry.target) && entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name))
    .slice(0, args.limit || 5)
    .map(({ item, target }) => {
      const localized = item.locales?.[args.language || "en"] || {};
      return {
        connector_id: item.id,
        name: localized.name || item.name,
        description: localized.description || item.description,
        version: target.version,
        capabilities: item.capabilities || [],
        use_cases: item.use_cases || [],
        permissions: target.permissions || [],
        install_url: `${baseUrl}/connectors/install/${encodeURIComponent(item.id)}?lang=${args.language || "en"}`,
      };
    });

  return {
    ok: true,
    query_kept_private: true,
    matches: ranked,
    next_step: ranked.length
      ? biInline(
          `Tell the user a matching connector is available and put this browser link first: ${ranked[0].install_url}`,
          `Скажіть користувачу, що потрібний конектор доступний, і поставте це посилання для браузера на початку відповіді: ${ranked[0].install_url}`,
        )
      : biInline(
          "No compatible cloud connector was found in the marketplace.",
          "У каталозі не знайдено сумісного хмарного конектора.",
        ),
  };
}

export async function listConnectorUpdates(env: Env, baseUrl: string) {
  if (!env.OAUTH_DB) return { ok: false, updates: [], error: "D1 database is not configured." };
  await ensureMarketplaceSchema(env);
  const installed = await env.OAUTH_DB.prepare("SELECT * FROM connector_packages ORDER BY package_id").all<InstalledPackageRow>();
  const items = await fetchMarketplaceCatalog(env);
  const byId = new Map(items.map((item) => [item.id, item]));
  const updates = [];
  for (const row of installed.results || []) {
    const item = byId.get(row.package_id);
    const target = item ? cloudTarget(item) : null;
    if (!item || !target || compareVersions(target.version, row.installed_version) <= 0) continue;
    updates.push({
      connector_id: row.connector_id,
      name: item.name,
      installed_version: row.installed_version,
      latest_version: target.version,
      update_url: `${baseUrl}/connectors/${encodeURIComponent(row.connector_id)}/update`,
    });
  }
  return {
    ok: true,
    updates,
    message: updates.length
      ? biInline(
          `A connector update is available. Open this link in a browser: ${updates[0].update_url}`,
          `Доступне оновлення конектора. Відкрийте це посилання у браузері: ${updates[0].update_url}`,
        )
      : biInline("All installed connectors are current.", "Усі встановлені конектори мають останню версію."),
  };
}

export async function fetchMarketplaceCatalog(env: Env, force = false): Promise<MarketplaceItem[]> {
  const catalogUrl = catalogUrlFor(env);
  if (!force && catalogCache?.url === catalogUrl && catalogCache.expiresAt > Date.now()) return catalogCache.items;
  const safeUrl = assertSafeOutboundUrl(catalogUrl);
  const response = await fetch(safeUrl.toString(), {
    headers: { accept: "application/json" },
    cf: { cacheTtl: 600, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`Marketplace catalog returned ${response.status}.`);
  const payload = await response.json() as { items?: unknown };
  if (!Array.isArray(payload.items)) throw new Error("Marketplace catalog has an invalid format.");
  const items = payload.items.filter(isMarketplaceItem);
  catalogCache = { url: catalogUrl, expiresAt: Date.now() + CATALOG_CACHE_MS, items };
  return items;
}

export async function getMarketplaceItem(env: Env, itemId: string): Promise<{ item: MarketplaceItem; target: MarketplaceTarget } | null> {
  const normalized = safeKey(itemId).replaceAll(":", "-");
  const item = (await fetchMarketplaceCatalog(env)).find((candidate) => candidate.id === normalized);
  if (!item) return null;
  const target = cloudTarget(item);
  return target ? { item, target } : null;
}

export async function saveInstalledPackage(
  env: Env,
  input: {
    connectorId: string;
    packageId: string;
    targetId: string;
    version: string;
    checksum: string;
    childScriptName?: string | null;
    credentialFields: unknown[];
  },
): Promise<void> {
  const db = getDb(env);
  await ensureMarketplaceSchema(env);
  const now = nowSeconds();
  await db.prepare(
    `INSERT INTO connector_packages
       (connector_id, package_id, target_id, installed_version, checksum, child_script_name,
        credential_fields_json, catalog_url, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(connector_id) DO UPDATE SET
       package_id = excluded.package_id,
       target_id = excluded.target_id,
       installed_version = excluded.installed_version,
       checksum = excluded.checksum,
       child_script_name = excluded.child_script_name,
       credential_fields_json = excluded.credential_fields_json,
       catalog_url = excluded.catalog_url,
       updated_at = excluded.updated_at`,
  ).bind(
    input.connectorId,
    input.packageId,
    input.targetId,
    input.version,
    input.checksum,
    input.childScriptName || null,
    JSON.stringify(input.credentialFields),
    catalogUrlFor(env),
    now,
    now,
  ).run();
}

export async function getInstalledPackage(env: Env, connectorId: string): Promise<InstalledPackageRow | null> {
  if (!env.OAUTH_DB) return null;
  await ensureMarketplaceSchema(env);
  return env.OAUTH_DB.prepare("SELECT * FROM connector_packages WHERE connector_id = ?")
    .bind(safeKey(connectorId).replaceAll(":", "-"))
    .first<InstalledPackageRow>();
}

export async function consumeInstallNonce(env: Env, nonce: string, expiresAt: number): Promise<void> {
  const db = getDb(env);
  await ensureMarketplaceSchema(env);
  const now = nowSeconds();
  if (!nonce || nonce.length < 16 || expiresAt < now || expiresAt > now + 15 * 60) throw new Error("Installation ticket has expired.");
  await db.prepare("DELETE FROM connector_install_nonces WHERE expires_at < ?").bind(now).run();
  try {
    await db.prepare(
      "INSERT INTO connector_install_nonces (nonce, expires_at, created_at) VALUES (?, ?, ?)",
    ).bind(nonce, expiresAt, now).run();
  } catch {
    throw new Error("Installation ticket has already been used.");
  }
}

export function cloudTarget(item: MarketplaceItem): MarketplaceTarget | null {
  const targets = Array.isArray(item.targets) ? item.targets : Object.values(item.targets || {});
  const target = targets.find((candidate) =>
    candidate?.runtime === "cloudflare-worker" ||
    candidate?.id === "cloudflare-worker" ||
    candidate?.package_format === "oneaiworkers.connector.v1"
  );
  if (!target || !isMarketplaceTarget(target)) return null;
  return target;
}

function scoreItem(item: MarketplaceItem, queryTerms: string[]): number {
  if (!queryTerms.length) return 1;
  const fields = {
    id: terms(item.id),
    name: terms(item.name),
    aliases: terms((item.aliases || []).join(" ")),
    tags: terms((item.tags || []).join(" ")),
    capabilities: terms((item.capabilities || []).join(" ")),
    useCases: terms((item.use_cases || []).join(" ")),
    description: terms(item.description),
  };
  let score = 0;
  for (const query of queryTerms) {
    if (fields.id.includes(query)) score += 12;
    if (fields.name.includes(query)) score += 10;
    if (fields.aliases.includes(query)) score += 9;
    if (fields.tags.includes(query)) score += 7;
    if (fields.capabilities.includes(query)) score += 6;
    if (fields.useCases.includes(query)) score += 5;
    if (fields.description.includes(query)) score += 2;
  }
  return score;
}

function terms(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

function isMarketplaceItem(value: unknown): value is MarketplaceItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<MarketplaceItem>;
  return typeof item.id === "string" && typeof item.name === "string" && typeof item.description === "string" && typeof item.version === "string";
}

function isMarketplaceTarget(value: unknown): value is MarketplaceTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Partial<MarketplaceTarget>;
  return typeof target.id === "string" &&
    typeof target.runtime === "string" &&
    typeof target.version === "string" &&
    typeof target.package_url === "string" &&
    typeof target.package_format === "string" &&
    typeof target.checksum === "string";
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

function catalogUrlFor(env: Env): string {
  return String(env.MARKETPLACE_CATALOG_URL || DEFAULT_CATALOG_URL);
}

function getDb(env: Env): D1Database {
  if (!env.OAUTH_DB) throw new Error("D1 database is not configured.");
  return env.OAUTH_DB;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
