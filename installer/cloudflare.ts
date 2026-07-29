import type { CloudflareAccount } from "./types";

const API_BASE = "https://api.cloudflare.com/client/v4";

interface ApiEnvelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number; message?: string }>;
}

interface D1DatabaseResult {
  uuid: string;
  name: string;
}

export class CloudflareApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function listAccounts(token: string): Promise<CloudflareAccount[]> {
  const accounts = await api<CloudflareAccount[]>(token, "/accounts?per_page=50&direction=asc");
  return accounts.filter((account) => /^[a-f0-9]{32}$/u.test(account.id) && account.name).slice(0, 50);
}

export async function scriptExists(token: string, accountId: string, scriptName: string): Promise<boolean> {
  const response = await cloudflareFetch(token, `/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}`);
  if (response.status === 404) return false;
  if (response.ok) return true;
  throw await responseError(response);
}

export async function scriptBindingNames(token: string, accountId: string, scriptName: string): Promise<string[]> {
  const result = await api<{ bindings?: Array<{ name?: string }> }>(
    token,
    `/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}/settings`,
  );
  return [...new Set((result.bindings || []).map((binding) => binding.name).filter((name): name is string => Boolean(name)))];
}

export async function createD1(token: string, accountId: string, name: string): Promise<D1DatabaseResult> {
  return api<D1DatabaseResult>(token, `/accounts/${accountId}/d1/database`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function deleteD1(token: string, accountId: string, databaseId: string): Promise<void> {
  await api<unknown>(token, `/accounts/${accountId}/d1/database/${databaseId}`, { method: "DELETE" });
}

export async function deleteScript(token: string, accountId: string, scriptName: string): Promise<void> {
  await api<unknown>(token, `/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}`, { method: "DELETE" });
}

export async function accountSubdomain(token: string, accountId: string): Promise<string | null> {
  const response = await cloudflareFetch(token, `/accounts/${accountId}/workers/subdomain`);
  if (response.status === 404) return null;
  if (!response.ok) throw await responseError(response);
  const payload = await response.json<ApiEnvelope<{ subdomain: string }>>();
  return payload.success && payload.result?.subdomain ? payload.result.subdomain : null;
}

export async function createAccountSubdomain(token: string, accountId: string, subdomain: string): Promise<string> {
  const result = await api<{ subdomain: string }>(token, `/accounts/${accountId}/workers/subdomain`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subdomain }),
  });
  return result.subdomain;
}

export async function uploadWorker(input: {
  token: string;
  accountId: string;
  scriptName: string;
  databaseId: string;
  sharedSecret: string;
  installerUrl: string;
  code: string;
}): Promise<void> {
  const metadata = {
    main_module: "worker.js",
    compatibility_date: "2026-06-27",
    compatibility_flags: ["nodejs_compat"],
    bindings: [
      { type: "d1", name: "OAUTH_DB", database_id: input.databaseId },
      { type: "secret_text", name: "MCP_SHARED_SECRET", text: input.sharedSecret },
      { type: "plain_text", name: "HUB_NAME", text: "OneAIWorkers" },
      { type: "plain_text", name: "UPDATE_SERVICE_URL", text: `${input.installerUrl}/update/start` },
    ],
  };
  const body = new FormData();
  body.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  body.set("worker.js", new Blob([input.code], { type: "application/javascript+module" }), "worker.js");
  await api<unknown>(
    input.token,
    `/accounts/${input.accountId}/workers/scripts/${encodeURIComponent(input.scriptName)}`,
    { method: "PUT", body },
  );
}

export async function updateWorker(input: {
  token: string;
  accountId: string;
  scriptName: string;
  bindingNames: string[];
  code: string;
  version: string;
}): Promise<void> {
  const metadata = {
    main_module: "worker.js",
    compatibility_date: "2026-06-27",
    compatibility_flags: ["nodejs_compat"],
    bindings: input.bindingNames.map((name) => ({ type: "inherit", name })),
    annotations: { "workers/message": `OneAIWorkers ${input.version}` },
  };
  const body = new FormData();
  body.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  body.set("worker.js", new Blob([input.code], { type: "application/javascript+module" }), "worker.js");
  await api<unknown>(
    input.token,
    `/accounts/${input.accountId}/workers/scripts/${encodeURIComponent(input.scriptName)}?bindings_inherit=strict`,
    { method: "PUT", body },
  );
}

export async function enableWorkersDev(token: string, accountId: string, scriptName: string): Promise<void> {
  await api<unknown>(token, `/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, previews_enabled: false }),
  });
}

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await cloudflareFetch(token, path, init);
  if (!response.ok) throw await responseError(response);
  const payload = await response.json<ApiEnvelope<T>>();
  if (!payload.success) throw new CloudflareApiError(apiMessage(payload.errors), response.status);
  return payload.result;
}

function cloudflareFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("accept", "application/json");
  return fetch(`${API_BASE}${path}`, { ...init, headers, redirect: "error" });
}

async function responseError(response: Response): Promise<CloudflareApiError> {
  try {
    const payload = await response.json<ApiEnvelope<unknown>>();
    return new CloudflareApiError(apiMessage(payload.errors) || `Cloudflare повернув код ${response.status}.`, response.status);
  } catch {
    return new CloudflareApiError(`Cloudflare повернув код ${response.status}.`, response.status);
  }
}

function apiMessage(errors?: Array<{ code?: number; message?: string }>): string {
  const message = errors?.map((error) => error.message?.trim()).filter(Boolean).slice(0, 3).join("; ");
  return message || "Cloudflare не зміг виконати дію.";
}
