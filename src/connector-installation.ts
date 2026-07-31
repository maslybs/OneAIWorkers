import { z } from "zod";
import { createConnectorAccessToken, storeCredentialProfile, type CredentialField } from "./vault";
import { verifyEcdsaTicket } from "./crypto";
import { getInstalledPackage, getMarketplaceItem, consumeInstallNonce, saveInstalledPackage } from "./marketplace";
import { safeKey } from "./security";
import type { Env } from "./types";
import { saveConnector } from "./tools/integrations";

const credentialFieldSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/),
  label: z.string().min(1).max(120),
  label_uk: z.string().max(120).optional(),
  type: z.enum(["secret", "text", "url"]),
  required: z.boolean().optional(),
  placeholder: z.string().max(300).optional(),
  help: z.string().max(500).optional(),
  help_uk: z.string().max(500).optional(),
});

const actionSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.string().url(),
  auth: z.object({ type: z.literal("none") }).default({ type: "none" }),
  headers: z.record(z.string(), z.string()).default({}),
  query: z.record(z.string(), z.unknown()).default({}),
  body_template: z.unknown().optional(),
  input_schema: z.record(z.string(), z.unknown()).optional(),
});

const installTicketSchema = z.object({
  iss: z.literal("oneaiworkers-installer"),
  aud: z.string().url(),
  operation: z.enum(["install", "update"]),
  lang: z.enum(["en", "uk"]).default("en"),
  iat: z.number().int(),
  exp: z.number().int(),
  nonce: z.string().min(16).max(200),
  package: z.object({
    id: z.string().min(2).max(80),
    target_id: z.string().min(2).max(80),
    version: z.string().min(1).max(40),
    checksum: z.string().min(16).max(200),
  }),
  connector: z.object({
    id: z.string().min(2).max(80),
    name: z.string().min(1).max(120),
    description: z.string().max(1000).optional(),
    child_worker_url: z.string().url(),
    child_script_name: z.string().min(1).max(80),
    child_token: z.string().min(32).max(300),
    credential_fields: z.array(credentialFieldSchema).max(30).default([]),
    actions: z.array(actionSchema).min(1).max(50),
  }),
});

export async function registerInstalledConnector(env: Env, baseUrl: string, ticket: string) {
  if (!env.CONNECTOR_INSTALLER_PUBLIC_KEY) throw new Error("CONNECTOR_INSTALLER_PUBLIC_KEY is not configured.");
  if (!env.CREDENTIALS_MASTER_KEY) throw new Error("CREDENTIALS_MASTER_KEY is not configured.");
  const rawPayload = await verifyEcdsaTicket(env.CONNECTOR_INSTALLER_PUBLIC_KEY, ticket);
  const payload = installTicketSchema.parse(rawPayload);
  if (normalizeOrigin(payload.aud) !== normalizeOrigin(baseUrl)) throw new Error("Installation ticket belongs to another Worker.");
  const now = Math.floor(Date.now() / 1000);
  if (payload.iat > now + 60 || payload.exp < now) throw new Error("Installation ticket has expired.");

  const catalogEntry = await getMarketplaceItem(env, payload.package.id);
  if (!catalogEntry) throw new Error("This cloud connector is no longer available in the marketplace.");
  if (
    catalogEntry.target.id !== payload.package.target_id ||
    catalogEntry.target.version !== payload.package.version ||
    catalogEntry.target.checksum !== payload.package.checksum
  ) {
    throw new Error("Installation ticket does not match the current marketplace package.");
  }

  await consumeInstallNonce(env, payload.nonce, payload.exp);
  const connectorId = safeKey(payload.connector.id).replaceAll(":", "-");
  const previousPackage = await getInstalledPackage(env, connectorId);
  await storeCredentialProfile(env, connectorId, "system", { child_token: payload.connector.child_token });
  await saveConnector(env, {
    connector_id: connectorId,
    name: payload.connector.name,
    description: payload.connector.description,
    mode: "child_worker",
    child_worker_url: payload.connector.child_worker_url,
    child_worker_token_credential: "child_token",
    actions: payload.connector.actions,
  });
  await saveInstalledPackage(env, {
    connectorId,
    packageId: payload.package.id,
    targetId: payload.package.target_id,
    version: payload.package.version,
    checksum: payload.package.checksum,
    childScriptName: payload.connector.child_script_name,
    credentialFields: payload.connector.credential_fields,
  });

  const accessToken = await createConnectorAccessToken(env, connectorId);
  return {
    ok: true,
    connector_id: connectorId,
    operation: payload.operation,
    version: payload.package.version,
    previous_child_script_name: previousPackage?.child_script_name || null,
    setup_url: `${baseUrl}/connectors/access/${encodeURIComponent(accessToken)}?lang=${payload.lang}`,
    credentials_required: payload.connector.credential_fields.some((field) => field.required),
  };
}

export function parseCredentialFields(value: string): CredentialField[] {
  const parsed = JSON.parse(value) as unknown;
  return z.array(credentialFieldSchema).parse(parsed) as CredentialField[];
}

function normalizeOrigin(value: string): string {
  return new URL(value).origin;
}
