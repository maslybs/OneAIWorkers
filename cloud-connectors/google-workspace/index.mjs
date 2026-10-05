const VERSION = "0.1.0";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const DOCS_API = "https://docs.googleapis.com/v1";
const SHEETS_API = "https://sheets.googleapis.com/v4";
const MAX_TEXT_CHARS = 1_000_000;
const MAX_BINARY_BYTES = 5_000_000;
const ACTIONS = [
  "check_connection",
  "list_files", "get_file", "download_file_text", "download_file_base64", "export_file_text",
  "create_folder", "upload_text_file", "update_file_metadata", "update_file_text", "copy_file", "delete_file",
  "list_permissions", "create_permission",
  "create_document", "create_document_with_text", "create_many_documents", "get_document", "insert_text",
  "batch_update_document", "find_text", "linkify_url",
  "get_spreadsheet", "get_values", "batch_get_values", "append_values", "update_values",
  "batch_update_values", "clear_values", "batch_clear_values", "batch_update_spreadsheet",
  "add_sheet", "delete_sheet", "format_range", "auto_resize_dimensions",
];

let tokenCache = { accessToken: "", expiresAt: 0, credentialFingerprint: "" };

export default {
  async fetch(request, env) {
    if (!(await authorized(request, env))) return json({ ok: false, error: "Unauthorized" }, 401);
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/tools/list") {
      return json({ ok: true, plugin: "google-workspace", version: VERSION, actions: ACTIONS });
    }
    if (request.method !== "POST" || url.pathname !== "/tools/call") return json({ ok: false, error: "Not found" }, 404);
    try {
      const payload = await request.json();
      const name = text(payload.name);
      const args = object(payload.arguments);
      const credentials = object(payload.credentials);
      if (!ACTIONS.includes(name)) throw requestError("Unknown Google Workspace action.");
      validateCredentials(credentials);
      if (payload.dry_run === true) return json(dryRun(name, args));
      return json({ ok: true, data: await run(name, args, credentials) });
    } catch (error) {
      return json({ ok: false, error: safeError(error), code: error?.code || "request_failed" }, error?.status || 400);
    }
  },
};

async function run(name, args, credentials) {
  if (name === "check_connection") {
    const about = await googleJson(credentials, "GET", `${DRIVE_API}/about`, { query: { fields: "user,storageQuota" } });
    return { connected: true, services: ["drive", "docs", "sheets"], user: about.user || null, storage_quota: about.storageQuota || null };
  }
  if (name === "list_files") return listFiles(credentials, args);
  if (name === "get_file") return googleJson(credentials, "GET", `${DRIVE_API}/files/${segment(args.file_id)}`, {
    query: { fields: args.fields || "id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink,webContentLink,owners,trashed,description" },
  });
  if (name === "download_file_text") return downloadText(credentials, `${DRIVE_API}/files/${segment(args.file_id)}`, { alt: "media" }, args.max_chars);
  if (name === "download_file_base64") return downloadBase64(credentials, `${DRIVE_API}/files/${segment(args.file_id)}`, { alt: "media" });
  if (name === "export_file_text") return downloadText(credentials, `${DRIVE_API}/files/${segment(args.file_id)}/export`, {
    mimeType: text(args.mime_type) || "text/plain",
  }, args.max_chars);
  if (name === "create_folder") return googleJson(credentials, "POST", `${DRIVE_API}/files`, {
    body: compact({ name: required(args.name, "name"), mimeType: "application/vnd.google-apps.folder", parents: stringList(args.parent_ids) }),
    query: { fields: "id,name,mimeType,parents,webViewLink" },
  });
  if (name === "upload_text_file") return uploadTextFile(credentials, args);
  if (name === "update_file_metadata") return googleJson(credentials, "PATCH", `${DRIVE_API}/files/${segment(args.file_id)}`, {
    body: compact({ name: args.name, description: args.description, starred: args.starred, trashed: args.trashed }),
    query: compact({ addParents: stringList(args.add_parent_ids).join(","), removeParents: stringList(args.remove_parent_ids).join(","), fields: "id,name,mimeType,parents,modifiedTime,webViewLink,trashed" }),
  });
  if (name === "update_file_text") return googleRaw(credentials, "PATCH", `${DRIVE_UPLOAD_API}/files/${segment(args.file_id)}`, {
    query: { uploadType: "media", fields: "id,name,mimeType,size,modifiedTime,webViewLink" },
    headers: { "content-type": text(args.mime_type) || "text/plain; charset=utf-8" },
    body: String(args.content ?? args.text ?? ""),
    parse: "json",
  });
  if (name === "copy_file") return googleJson(credentials, "POST", `${DRIVE_API}/files/${segment(args.file_id)}/copy`, {
    body: compact({ name: args.name, parents: stringList(args.parent_ids) }),
    query: { fields: "id,name,mimeType,parents,webViewLink" },
  });
  if (name === "delete_file") {
    await googleRaw(credentials, "DELETE", `${DRIVE_API}/files/${segment(args.file_id)}`, { parse: "empty" });
    return { deleted: true, file_id: text(args.file_id) };
  }
  if (name === "list_permissions") return googleJson(credentials, "GET", `${DRIVE_API}/files/${segment(args.file_id)}/permissions`, {
    query: { fields: args.fields || "nextPageToken,permissions(id,type,role,emailAddress,displayName,domain,expirationTime,allowFileDiscovery)", pageSize: integer(args.limit, 100, 1, 100) },
  });
  if (name === "create_permission") return googleJson(credentials, "POST", `${DRIVE_API}/files/${segment(args.file_id)}/permissions`, {
    query: compact({ sendNotificationEmail: booleanValue(args.send_notification_email), emailMessage: args.email_message, fields: "id,type,role,emailAddress,domain,expirationTime" }),
    body: compact({ type: required(args.type, "type"), role: required(args.role, "role"), emailAddress: args.email, domain: args.domain, expirationTime: args.expiration_time, allowFileDiscovery: args.allow_file_discovery }),
  });

  if (name === "create_document") return createDocument(credentials, args);
  if (name === "create_document_with_text") {
    const document = await createDocument(credentials, args);
    const content = String(args.text ?? args.content ?? "");
    if (content) await insertText(credentials, { document_id: document.document_id, text: content, index: 1 });
    return document;
  }
  if (name === "create_many_documents") {
    const documents = array(args.documents);
    if (!documents.length || documents.length > 20) throw requestError("documents must contain 1 to 20 items.");
    const results = [];
    for (const item of documents) results.push(await run("create_document_with_text", object(item), credentials));
    return { count: results.length, documents: results };
  }
  if (name === "get_document") return getDocument(credentials, args);
  if (name === "insert_text") return insertText(credentials, args);
  if (name === "batch_update_document") return batchUpdateDocument(credentials, args);
  if (name === "find_text") return findText(credentials, args);
  if (name === "linkify_url") return linkifyUrl(credentials, args);

  if (name === "get_spreadsheet") return googleJson(credentials, "GET", `${SHEETS_API}/spreadsheets/${segment(args.spreadsheet_id)}`, {
    query: compact({ includeGridData: booleanValue(args.include_grid_data), fields: args.fields }),
  });
  if (name === "get_values") return googleJson(credentials, "GET", `${SHEETS_API}/spreadsheets/${segment(args.spreadsheet_id)}/values/${segmentPath(args.range)}`, {
    query: compact({ majorDimension: args.major_dimension, valueRenderOption: args.value_render_option, dateTimeRenderOption: args.date_time_render_option }),
  });
  if (name === "batch_get_values") {
    const url = new URL(`${SHEETS_API}/spreadsheets/${segment(args.spreadsheet_id)}/values:batchGet`);
    for (const range of stringList(args.ranges)) url.searchParams.append("ranges", range);
    for (const [key, value] of Object.entries(compact({ majorDimension: args.major_dimension, valueRenderOption: args.value_render_option, dateTimeRenderOption: args.date_time_render_option }))) url.searchParams.set(key, String(value));
    return googleJson(credentials, "GET", url.toString());
  }
  if (name === "append_values") return googleJson(credentials, "POST", `${SHEETS_API}/spreadsheets/${segment(args.spreadsheet_id)}/values/${segmentPath(args.range)}:append`, {
    query: compact({ valueInputOption: args.value_input_option || "USER_ENTERED", insertDataOption: args.insert_data_option || "INSERT_ROWS", includeValuesInResponse: booleanValue(args.include_values_in_response) }),
    body: { majorDimension: args.major_dimension || "ROWS", values: matrix(args.values) },
  });
  if (name === "update_values") return googleJson(credentials, "PUT", `${SHEETS_API}/spreadsheets/${segment(args.spreadsheet_id)}/values/${segmentPath(args.range)}`, {
    query: compact({ valueInputOption: args.value_input_option || "USER_ENTERED", includeValuesInResponse: booleanValue(args.include_values_in_response) }),
    body: { range: text(args.range), majorDimension: args.major_dimension || "ROWS", values: matrix(args.values) },
  });
  if (name === "batch_update_values") return googleJson(credentials, "POST", `${SHEETS_API}/spreadsheets/${segment(args.spreadsheet_id)}/values:batchUpdate`, {
    body: { valueInputOption: args.value_input_option || "USER_ENTERED", includeValuesInResponse: args.include_values_in_response === true, data: array(args.data) },
  });
  if (name === "clear_values") return googleJson(credentials, "POST", `${SHEETS_API}/spreadsheets/${segment(args.spreadsheet_id)}/values/${segmentPath(args.range)}:clear`, { body: {} });
  if (name === "batch_clear_values") return googleJson(credentials, "POST", `${SHEETS_API}/spreadsheets/${segment(args.spreadsheet_id)}/values:batchClear`, { body: { ranges: stringList(args.ranges) } });
  if (name === "batch_update_spreadsheet") return batchUpdateSpreadsheet(credentials, args.spreadsheet_id, array(args.requests));
  if (name === "add_sheet") return batchUpdateSpreadsheet(credentials, args.spreadsheet_id, [{ addSheet: { properties: compact({ title: required(args.title, "title"), index: args.index, hidden: args.hidden, rightToLeft: args.right_to_left }) } }]);
  if (name === "delete_sheet") return batchUpdateSpreadsheet(credentials, args.spreadsheet_id, [{ deleteSheet: { sheetId: integer(args.sheet_id, NaN) } }]);
  if (name === "format_range") return batchUpdateSpreadsheet(credentials, args.spreadsheet_id, [{ repeatCell: { range: gridRange(args.range), cell: { userEnteredFormat: object(args.format) }, fields: text(args.fields) || "userEnteredFormat" } }]);
  if (name === "auto_resize_dimensions") return batchUpdateSpreadsheet(credentials, args.spreadsheet_id, [{ autoResizeDimensions: { dimensions: dimensionRange(args) } }]);
  throw requestError("Unknown Google Workspace action.");
}

async function listFiles(credentials, args) {
  return googleJson(credentials, "GET", `${DRIVE_API}/files`, { query: compact({
    q: args.query || args.q, pageSize: integer(args.limit, 100, 1, 1000), pageToken: args.page_token,
    orderBy: args.order_by, spaces: args.spaces || "drive", corpora: args.corpora,
    driveId: args.drive_id, includeItemsFromAllDrives: booleanValue(args.include_shared_drives),
    supportsAllDrives: booleanValue(args.include_shared_drives),
    fields: args.fields || "nextPageToken,incompleteSearch,files(id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink,owners,trashed,description)",
  }) });
}

async function uploadTextFile(credentials, args) {
  const boundary = `oneaiworkers_${crypto.randomUUID().replaceAll("-", "")}`;
  const metadata = compact({ name: required(args.name, "name"), parents: stringList(args.parent_ids), description: args.description, mimeType: text(args.mime_type) || "text/plain" });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n${String(args.content ?? args.text ?? "")}\r\n--${boundary}--`;
  return googleRaw(credentials, "POST", `${DRIVE_UPLOAD_API}/files`, {
    query: { uploadType: "multipart", fields: "id,name,mimeType,size,parents,webViewLink" },
    headers: { "content-type": `multipart/related; boundary=${boundary}` }, body, parse: "json",
  });
}

async function createDocument(credentials, args) {
  const raw = await googleJson(credentials, "POST", `${DOCS_API}/documents`, { body: { title: required(args.title || args.name, "title") } });
  return { document_id: raw.documentId, title: raw.title, web_url: raw.documentId ? `https://docs.google.com/document/d/${raw.documentId}/edit` : null };
}

async function getDocument(credentials, args) {
  const id = required(args.document_id, "document_id");
  const raw = await googleJson(credentials, "GET", `${DOCS_API}/documents/${segment(id)}`, { query: { includeTabsContent: "true" } });
  const plainText = extractDocumentText(raw);
  const limited = limitText(plainText, args.max_chars);
  const compactResult = { document_id: raw.documentId || id, title: raw.title || null, revision_id: raw.revisionId || null, plain_text: limited.text, truncated: limited.truncated, web_url: `https://docs.google.com/document/d/${id}/edit` };
  return args.include_raw === true ? { ...compactResult, raw } : compactResult;
}

async function insertText(credentials, args) {
  return batchUpdateDocument(credentials, { document_id: args.document_id, requests: [{ insertText: { location: { index: integer(args.index, 1, 1, Number.MAX_SAFE_INTEGER) }, text: String(args.text ?? args.content ?? "") } }] });
}

async function batchUpdateDocument(credentials, args) {
  const id = required(args.document_id, "document_id");
  const requests = array(args.requests);
  if (!requests.length || requests.length > 100) throw requestError("requests must contain 1 to 100 items.");
  const result = await googleJson(credentials, "POST", `${DOCS_API}/documents/${segment(id)}:batchUpdate`, { body: { requests } });
  return { document_id: id, replies: result.replies || [], write_control: result.writeControl || null, web_url: `https://docs.google.com/document/d/${id}/edit` };
}

async function findText(credentials, args) {
  const document = await getDocument(credentials, { document_id: args.document_id, include_raw: true, max_chars: MAX_TEXT_CHARS });
  const needle = required(args.text, "text");
  const source = args.match_case === false ? document.plain_text.toLowerCase() : document.plain_text;
  const query = args.match_case === false ? needle.toLowerCase() : needle;
  const matches = [];
  let offset = 0;
  while (matches.length < integer(args.limit, 20, 1, 100)) {
    const index = source.indexOf(query, offset);
    if (index < 0) break;
    matches.push({ offset: index, text: document.plain_text.slice(Math.max(0, index - 80), index + needle.length + 80) });
    offset = index + Math.max(1, query.length);
  }
  return { document_id: document.document_id, matches, count: matches.length };
}

async function linkifyUrl(credentials, args) {
  const id = required(args.document_id, "document_id");
  const target = required(args.url, "url");
  const raw = await googleJson(credentials, "GET", `${DOCS_API}/documents/${segment(id)}`, { query: { includeTabsContent: "true" } });
  const ranges = findTextRanges(raw, target);
  if (!ranges.length) return { document_id: id, updated: 0, url: target };
  await batchUpdateDocument(credentials, { document_id: id, requests: ranges.map((range) => ({ updateTextStyle: { range, textStyle: { link: { url: target } }, fields: "link" } })) });
  return { document_id: id, updated: ranges.length, url: target };
}

async function batchUpdateSpreadsheet(credentials, spreadsheetId, requests) {
  if (!requests.length || requests.length > 100) throw requestError("requests must contain 1 to 100 items.");
  return googleJson(credentials, "POST", `${SHEETS_API}/spreadsheets/${segment(spreadsheetId)}:batchUpdate`, { body: { requests, includeSpreadsheetInResponse: false } });
}

async function downloadText(credentials, url, query, maxChars) {
  const response = await googleRaw(credentials, "GET", url, { query, parse: "response" });
  const value = await response.text();
  const limited = limitText(value, maxChars);
  return { text: limited.text, truncated: limited.truncated, content_type: response.headers.get("content-type") };
}

async function downloadBase64(credentials, url, query) {
  const response = await googleRaw(credentials, "GET", url, { query, parse: "response" });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BINARY_BYTES) throw requestError(`File is larger than ${MAX_BINARY_BYTES} bytes.`);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { base64: btoa(binary), bytes: bytes.byteLength, content_type: response.headers.get("content-type") };
}

async function googleJson(credentials, method, url, options = {}) {
  return googleRaw(credentials, method, url, { ...options, parse: "json" });
}

async function googleRaw(credentials, method, address, options = {}, retry = true) {
  const url = new URL(address);
  for (const [key, value] of Object.entries(compact(options.query || {}))) {
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, String(item));
    else url.searchParams.set(key, String(value));
  }
  const token = await getAccessToken(credentials, !retry);
  const headers = new Headers({ accept: "application/json", authorization: `Bearer ${token}` });
  for (const [key, value] of Object.entries(options.headers || {})) headers.set(key, String(value));
  let body = options.body;
  if (body && typeof body === "object" && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
    headers.set("content-type", headers.get("content-type") || "application/json; charset=utf-8");
    body = JSON.stringify(body);
  }
  const response = await fetch(url, { method, headers, body, redirect: "manual" });
  if (response.status === 401 && retry) {
    tokenCache = { accessToken: "", expiresAt: 0, credentialFingerprint: "" };
    return googleRaw(credentials, method, address, options, false);
  }
  if (!response.ok) {
    const raw = (await response.text()).slice(0, 2_000);
    const payload = parseJson(raw);
    const message = text(payload?.error?.message || payload?.error_description || payload?.error || raw || `HTTP ${response.status}`);
    const error = new Error(`Google returned ${response.status}: ${message.slice(0, 500)}`);
    error.status = response.status === 401 ? 401 : 502;
    error.code = response.status === 401 ? "reauthorization_required" : "google_api_error";
    throw error;
  }
  if (options.parse === "response") return response;
  if (options.parse === "empty" || response.status === 204) return null;
  const raw = await response.text();
  return raw ? parseJson(raw) : null;
}

async function getAccessToken(credentials, forceRefresh = false) {
  const clientId = required(credentials.client_id, "client_id");
  const clientSecret = required(credentials.client_secret, "client_secret");
  const refreshToken = required(credentials.refresh_token, "refresh_token");
  const fingerprint = await digest(`${clientId}\n${refreshToken}`);
  if (!forceRefresh && tokenCache.accessToken && tokenCache.credentialFingerprint === fingerprint && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.accessToken;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    redirect: "manual",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const oauthCode = text(payload.error);
    const error = new Error(oauthCode === "invalid_grant"
      ? "Google access has expired or was revoked. Open the protected plugin settings and connect Google again."
      : `Google token refresh failed: ${oauthCode || response.status}.`);
    error.status = oauthCode === "invalid_grant" ? 401 : 502;
    error.code = oauthCode === "invalid_grant" ? "reauthorization_required" : "token_refresh_failed";
    throw error;
  }
  tokenCache = { accessToken: String(payload.access_token), expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 3600)) * 1000, credentialFingerprint: fingerprint };
  return tokenCache.accessToken;
}

function extractDocumentText(document) {
  const parts = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.textRun?.content === "string") parts.push(value.textRun.content);
    for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child);
  };
  visit(document.body || document.tabs || document);
  return parts.join("").replace(/\r\n/gu, "\n");
}

function findTextRanges(document, needle) {
  const ranges = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.textRun?.content === "string" && Number.isInteger(value.startIndex)) {
      let offset = 0;
      while (true) {
        const found = value.textRun.content.indexOf(needle, offset);
        if (found < 0) break;
        ranges.push({ startIndex: value.startIndex + found, endIndex: value.startIndex + found + needle.length });
        offset = found + Math.max(1, needle.length);
      }
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child);
  };
  visit(document.body || document.tabs || document);
  return ranges;
}

function gridRange(value) {
  const range = object(value);
  const output = {};
  for (const key of ["sheetId", "startRowIndex", "endRowIndex", "startColumnIndex", "endColumnIndex"]) {
    const source = range[key] ?? range[toSnake(key)];
    if (source !== undefined) output[key] = integer(source, NaN);
  }
  if (!Number.isInteger(output.sheetId)) throw requestError("range.sheet_id is required.");
  return output;
}

function dimensionRange(args) {
  const dimension = text(args.dimension).toUpperCase();
  if (!Number.isInteger(Number(args.sheet_id)) || !["ROWS", "COLUMNS"].includes(dimension)) throw requestError("sheet_id and dimension are required.");
  return compact({ sheetId: Number(args.sheet_id), dimension, startIndex: args.start_index, endIndex: args.end_index });
}

function dryRun(name, args) {
  return { ok: true, dry_run: true, action: name, identifiers: compact({ file_id: args.file_id, document_id: args.document_id, spreadsheet_id: args.spreadsheet_id, range: args.range }), note: "No request was sent to Google." };
}

function validateCredentials(credentials) {
  required(credentials.client_id, "client_id");
  required(credentials.client_secret, "client_secret");
  required(credentials.refresh_token, "refresh_token");
}

function matrix(value) {
  if (!Array.isArray(value) || !value.every(Array.isArray)) throw requestError("values must be an array of rows.");
  return value;
}
function limitText(value, maxChars) { const maximum = integer(maxChars, 120_000, 1, MAX_TEXT_CHARS); return { text: String(value).slice(0, maximum), truncated: String(value).length > maximum }; }
function segment(value) { return encodeURIComponent(required(value, "id")); }
function segmentPath(value) { return encodeURIComponent(required(value, "range")).replaceAll("%2F", "%2F"); }
function compact(value) { return Object.fromEntries(Object.entries(object(value)).filter(([, item]) => item !== undefined && item !== null && item !== "" && !(Array.isArray(item) && item.length === 0))); }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function stringList(value) { return (Array.isArray(value) ? value : text(value).split(/[ ,]+/u)).map(text).filter(Boolean); }
function text(value) { return String(value ?? "").trim(); }
function required(value, name) { const output = text(value); if (!output) throw requestError(`${name} is required.`); return output; }
function integer(value, fallback, minimum = -Number.MAX_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER) { const number = Number(value); return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.trunc(number))) : fallback; }
function booleanValue(value) { return typeof value === "boolean" ? String(value) : undefined; }
function parseJson(value) { try { return JSON.parse(value); } catch { return { raw: value }; } }
function toSnake(value) { return value.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`); }
function requestError(message) { const error = new Error(message); error.status = 400; error.code = "invalid_request"; return error; }
function safeError(error) { return error instanceof Error ? error.message.slice(0, 700) : "Unknown error"; }
async function digest(value) { const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

async function authorized(request, env) {
  const expected = text(env.CHILD_TOKEN); const actual = text(request.headers.get("x-oneaiworkers-child-token"));
  const [leftDigest, rightDigest] = await Promise.all([expected, actual].map((value) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
  const left = new Uint8Array(leftDigest); const right = new Uint8Array(rightDigest); let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return expected.length >= 32 && expected.length === actual.length && difference === 0;
}
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
