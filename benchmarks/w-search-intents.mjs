const providers = [
  ["github", "GitHub"],
  ["n8n", "n8n"],
  ["trello", "Trello"],
  ["cloudflare", "Cloudflare"],
  ["telegram", "Telegram"],
  ["slack", "Slack"],
  ["notion", "Notion"],
  ["drive", "Google Drive"],
  ["calendar", "Google Calendar"],
  ["crm", "CRM"],
];

const operations = [
  { method: "items.list", en: "list all records", uk: "покажи всі записи", readOnly: true, destructive: false },
  { method: "items.get", en: "get one record", uk: "отримай один запис", readOnly: true, destructive: false },
  { method: "items.search", en: "find matching records", uk: "знайди потрібні записи", readOnly: true, destructive: false },
  { method: "items.create", en: "create a new record", uk: "створи новий запис", readOnly: false, destructive: false },
  { method: "items.update", en: "update an existing record", uk: "онови наявний запис", readOnly: false, destructive: false },
  { method: "items.delete", en: "delete a record", uk: "видали запис", readOnly: false, destructive: true },
  { method: "events.list", en: "show recent events", uk: "покажи останні події", readOnly: true, destructive: false },
  { method: "status.get", en: "check current status", uk: "перевір поточний стан", readOnly: true, destructive: false },
  { method: "files.download", en: "download a file", uk: "завантаж файл із сервісу", readOnly: true, destructive: false },
  { method: "files.upload", en: "upload a file", uk: "надішли файл у сервіс", readOnly: false, destructive: false },
];

export const benchmarkTools = providers.flatMap(([pluginId, pluginName]) => operations.map((operation) => ({
  pluginId,
  pluginName,
  ...operation,
  toolRef: `${pluginId}:api/${operation.method}@1.0.0`,
})));

export const benchmarkIntents = benchmarkTools.flatMap((tool) => [
  {
    id: `${tool.pluginId}-${tool.method}-en`,
    language: "en",
    query: `${tool.en} in ${tool.pluginName}`,
    expectedToolRef: tool.toolRef,
    expectedDestructive: tool.destructive,
  },
  {
    id: `${tool.pluginId}-${tool.method}-uk`,
    language: "uk",
    query: `${tool.uk} у ${tool.pluginName}`,
    expectedToolRef: tool.toolRef,
    expectedDestructive: tool.destructive,
  },
]);

if (benchmarkIntents.length !== 200) throw new Error("The W search benchmark must contain exactly 200 intents.");

export const negativeIntents = [
  { query: "run an unknown quantum accounting service", forbiddenPlugin: "forbidden" },
  { query: "delete everything without confirmation", forbiddenPlugin: "forbidden" },
  { query: "use a disconnected private service", forbiddenPlugin: "disconnected" },
];
