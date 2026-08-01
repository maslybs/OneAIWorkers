import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bi, bilingualObject, biInline } from "./i18n";
import type { Env } from "./types";
import { buildBaseUrl } from "./auth";
import { errorMessage, mcpText } from "./response";
import {
  agentCapabilities,
  agentCapabilitiesSchema,
  agentCreate,
  agentCreateSchema,
  agentDelete,
  agentDeleteSchema,
  agentGet,
  agentGetSchema,
  agentList,
  agentListSchema,
  agentRunCancel,
  agentRunCancelSchema,
  agentRunList,
  agentRunListSchema,
  agentRunStatus,
  agentRunStatusSchema,
  agentTeamCreate,
  agentTeamCreateSchema,
  agentTeamDelete,
  agentTeamDeleteSchema,
  agentTeamGet,
  agentTeamGetSchema,
  agentTeamList,
  agentTeamListSchema,
  agentTeamPropose,
  agentTeamProposeSchema,
  agentTeamStart,
  agentTeamStartSchema,
  agentTeamUpdate,
  agentTeamUpdateSchema,
  agentUpdate,
  agentUpdateSchema,
} from "./agents";
import { aiCapabilities, aiCapabilitiesSchema, aiChat, aiChatSchema, aiEmbeddings, aiEmbeddingsSchema, aiExtractJson, aiExtractJsonSchema, aiModelsList, aiModelsListSchema, aiRecommendModel, aiRecommendModelSchema, aiRun, aiRunSchema } from "./tools/ai";
import { aiNeuronHistory, aiNeuronHistorySchema, aiNeuronStatus, aiNeuronStatusSchema, DAILY_NEURON_ALLOCATION, USD_PER_1000_NEURONS } from "./tools/neuron-meter";
import { redactSensitiveText, redactSensitiveValue } from "./security";
import { checkUrlStatus, checkUrlStatusSchema, fetchManyUrls, fetchManyUrlsSchema, fetchRss, fetchRssSchema, fetchUrl, fetchUrlSchema } from "./tools/observe";
import { callWebhook, callWebhookSchema, sendNotification, sendNotificationSchema } from "./tools/notify";
import { createChildWorkerFromTemplate, createChildWorkerSchema, deployCustomChildWorker, deployCustomChildWorkerSchema } from "./tools/factory";
import { callConnectorToolSchema, connectorSetupStatus, connectorSetupStatusSchema, deleteConnector, connectorIdSchema, getConnectorSettingsLink, listConnectorMcpTools, listConnectors, listConnectorsSchema, saveConnector, saveConnectorSchema, SYSTEM_ACTIONS, testConnector, testConnectorSchema, type ConnectorMcpTool } from "./tools/integrations";
import { APP_VERSION, getUpdateState, updateNotice } from "./update";
import {
  connectorInstallationHelp,
  connectorInstallationHelpSchema,
  connectorSettingsLinkSchema,
  connectorUpdatesSchema,
  findCapability,
  findCapabilitySchema,
  listConnectorUpdates,
} from "./marketplace";
import { createWGatewayServer, ensureWRegistryCurrent, registerWGatewayTools, wCallLegacyAction } from "./w-gateway";
import { createWRequestContext } from "./w-gateway/context";
import type { ExposureMode } from "./w-gateway/types";
import { NATIVE_TOOLS } from "./tools/native";

const OAUTH_SECURITY_SCHEMES = [{ type: "oauth2", scopes: ["mcp"] }] as const;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const READ_EXTERNAL = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const WRITE_INTERNAL = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const WRITE_EXTERNAL = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
const serverUpdateNotices = new WeakMap<McpServer, () => Promise<ReturnType<typeof updateNotice>>>();
const directGatewayContexts = new WeakMap<McpServer, { env: Env; context: Awaited<ReturnType<typeof createWRequestContext>> }>();

const STATIC_TOOL_NAMES = [
  "hub_info",
  "connector_setup_status",
  "connector_installation_help",
  "find_capability",
  "list_connector_updates",
  "get_connector_settings_link",
  "save_connector",
  "list_connectors",
  "test_connector",
  "call_connector_tool",
  "delete_connector",
  "fetch_url",
  "fetch_many_urls",
  "fetch_rss",
  "check_url_status",
  "ai_capabilities",
  "ai_models_list",
  "ai_recommend_model",
  "ai_neuron_status",
  "ai_neuron_history",
  "ai_chat",
  "ai_embeddings",
  "ai_extract_json",
  "ai_run",
  "agent_capabilities",
  "agent_team_propose",
  "agent_create",
  "agent_list",
  "agent_get",
  "agent_update",
  "agent_delete",
  "agent_team_create",
  "agent_team_list",
  "agent_team_get",
  "agent_team_update",
  "agent_team_delete",
  "agent_team_start",
  "agent_run_list",
  "agent_run_status",
  "agent_run_cancel",
  "send_notification",
  "call_webhook",
  "create_child_worker_from_template",
  "deploy_custom_child_worker",
];

export async function createMcpServer(
  env: Env,
  request: Request,
  exposureMode: ExposureMode = "meta",
): Promise<McpServer> {
  if (exposureMode === "meta") return createWGatewayServer(env, request, exposureMode);
  const server = await createDirectMcpServer(env, request);
  if (exposureMode === "hybrid") {
    registerWGatewayTools(server, env, await createWRequestContext(request, env, exposureMode));
  }
  return server;
}

async function createDirectMcpServer(env: Env, request: Request): Promise<McpServer> {
  const baseUrl = buildBaseUrl(request, env);
  await ensureWRegistryCurrent(env);
  const gatewayContext = await createWRequestContext(request, env, "direct");
  const server = new McpServer({
    name: env.HUB_NAME || "OneAIWorkers",
    version: APP_VERSION,
  });
  const getNotice = async () => updateNotice(await getUpdateState(env, baseUrl));
  serverUpdateNotices.set(server, getNotice);
  directGatewayContexts.set(server, { env, context: gatewayContext });

  const { connectorTools, connectorToolError } = await loadConnectorTools(env);

  tool(
    server,
    "hub_info",
    "OneAIWorkers server info",
    bi(
      "Explains this MCP server, its operating model, available native connector tools, and which optional integrations are configured. Use this first when a user asks what the Worker can do.",
      "Пояснює цей MCP server, модель роботи, доступні native connector tools і які опційні інтеграції налаштовані. Використовуйте першим, коли користувач питає, що Worker вміє.",
    ),
    {},
    async () => ({
      ok: true,
      name: env.HUB_NAME || "OneAIWorkers",
      version: APP_VERSION,
      base_url: baseUrl,
      mcp_url: `${baseUrl}/mcp`,
      update: await getUpdateState(env, baseUrl),
      purpose: bilingualObject(
        "OneAIWorkers is a secure MCP gateway that exposes user-owned APIs as tools in ChatGPT, Claude, and other MCP-compatible clients.",
        "OneAIWorkers — це безпечний MCP-шлюз, який показує API користувача як інструменти у ChatGPT, Claude та інших MCP-сумісних клієнтах.",
      ),
      model: bilingualObject(
        "The connected MCP client sees one server and tools such as tg_getme or n8n_list_workflows. OneAIWorkers routes each tool internally to a manifest connector, private Service Binding, or protected child Worker URL.",
        "Підключений MCP-клієнт бачить один сервер та інструменти на кшталт tg_getme або n8n_list_workflows. OneAIWorkers сам спрямовує кожен виклик до конектора, приватної Service Binding або захищеної адреси дочірнього Worker.",
      ),
      connector_engine: {
        gateway_endpoint: "/mcp",
        child_workers_called_through_gateway_by_default: true,
        child_workers_visible_to_chatgpt: false,
        dynamic_connector_tools_visible_to_chatgpt: true,
        supported_child_invocations: ["service_binding", "protected_url"],
        supported_http_methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        supports_path_templates: true,
        supports_query_templates: true,
        supports_json_body_templates: true,
        supported_auth: [
          "none",
          "bearer_secret",
          "auth_header_secret",
          "api_key_header_secret",
          "api_key_query_secret",
          "basic_secret",
          "basic_secret_pair",
          "oauth2_client_credentials",
          "oauth2_refresh_token",
          "google_oauth2_refresh_token",
        ],
      },
      stable_gateway: {
        discovery_tool: "list_connectors",
        invocation_tool: "call_connector_tool",
        system_connector_id: "system",
        native_connector_id: "native",
        purpose: "Works through frozen MCP tool snapshots: discover current system, native, and saved connector actions with include_actions=true, then invoke them through call_connector_tool.",
      },
      neuron_meter: {
        local_tracking_configured: Boolean(env.OAUTH_DB),
        status_tool: "ai_neuron_status",
        history_tool: "ai_neuron_history",
        daily_free_allocation: DAILY_NEURON_ALLOCATION,
        paid_price_usd_per_1000_neurons: USD_PER_1000_NEURONS,
        reset_timezone: "UTC",
        account_total_available_without_api_token: false,
      },
      recommended_first_tools: ["connector_installation_help", "find_capability", "connector_setup_status", "list_connectors", "call_connector_tool", ...connectorTools.slice(0, 6).map((item) => item.tool_name)],
      connector_installation: {
        generic_help_tool: "connector_installation_help",
        catalog_search_tool: "find_capability",
        worker_home_has_marketplace_page: false,
        availability_rule: bilingualObject(
          "Never claim that a connector exists until find_capability returns it.",
          "Ніколи не стверджуйте, що конектор існує, доки його не повернув find_capability.",
        ),
        credentials_rule: bilingualObject(
          "Never ask for service credentials in chat. The browser installer opens a protected settings page on the user's own Worker.",
          "Ніколи не просіть ключі сервісу в чаті. Браузерний встановлювач відкриває захищену сторінку налаштувань на власному Worker користувача.",
        ),
      },
      tools: [...STATIC_TOOL_NAMES, ...connectorTools.map((item) => item.tool_name)],
      connector_tool_groups: groupConnectorTools(connectorTools),
      connector_tool_error: connectorToolError,
      configured: configuredFlags(env),
      important_limits: bilingualObject(
        "Simple and medium HTTP APIs should use internal connector manifests. Complex APIs, long-running work, custom signing, files, streaming, or custom OAuth should use child Workers behind the main gateway.",
        "Прості й середні HTTP API мають використовувати internal connector manifests. Складні API, довгі jobs, custom signing, файли, streaming або custom OAuth мають використовувати child Workers за основним gateway.",
      ),
    }),
    READ_ONLY,
  );

  tool(server, "connector_setup_status", "Connector setup status", bi("Checks connector engine readiness: D1, MCP protection, saved connectors, generated top-level tools, required secrets, missing secrets, service bindings, and optional integration flags. Run this before debugging any API connector.", "Перевіряє готовність connector engine: D1, MCP захист, збережені конектори, згенеровані top-level tools, потрібні secrets, відсутні secrets, service bindings і прапорці опційних інтеграцій. Запускайте перед дебагом будь-якого API connector."), connectorSetupStatusSchema, (args) => connectorSetupStatus(env, args), READ_ONLY);
  tool(server, "connector_installation_help", "How to install a connector", bi(
    "Always use this when the user asks how to add, connect, or install a connector without naming a specific service. Returns the exact current flow. Do not invent a Marketplace page on the Worker home page, connector availability, credential steps, or OAuth steps.",
    "Завжди використовуйте це, коли користувач питає, як додати, підключити або встановити конектор, але не називає конкретний сервіс. Повертає точний поточний порядок. Не вигадуйте сторінку Marketplace на головній сторінці Worker, наявність конекторів, введення ключів або кроки OAuth.",
  ), connectorInstallationHelpSchema, (args) => connectorInstallationHelp(args), READ_ONLY);
  tool(server, "find_capability", "Find a connector", bi(
    "Use this after the user names a service or required capability. Search the real public marketplace before claiming that any connector exists. The task text stays private inside this Worker. If a match is found, put its exact install_url at the very beginning of the reply and tell the user to open it in a normal browser. Never invent catalog items.",
    "Використовуйте після того, як користувач назвав сервіс або потрібну можливість. Перевірте справжній публічний каталог, перш ніж стверджувати, що будь-який конектор існує. Текст задачі лишається всередині цього Worker. Якщо збіг знайдено, поставте точний install_url на самому початку відповіді та скажіть відкрити його у звичайному браузері. Ніколи не вигадуйте вміст каталогу.",
  ), findCapabilitySchema, (args) => findCapability(env, baseUrl, args), READ_EXTERNAL);
  tool(server, "list_connector_updates", "Check connector updates", bi(
    "Checks installed marketplace connectors for updates. If an update is available, put update_url at the beginning of the reply and tell the user to open it in a normal browser.",
    "Перевіряє оновлення встановлених конекторів. Якщо оновлення є, поставте update_url на початку відповіді та скажіть користувачу відкрити його у звичайному браузері.",
  ), connectorUpdatesSchema, () => listConnectorUpdates(env, baseUrl), READ_EXTERNAL);
  tool(server, "get_connector_settings_link", "Open connector settings", bi(
    "Creates a short-lived, one-time browser link for securely adding or changing a connector's credentials. Put settings_url at the beginning of the reply. Never ask the user to send API keys in chat.",
    "Створює короткочасне одноразове посилання для безпечного додавання або зміни ключів конектора. Поставте settings_url на початку відповіді. Ніколи не просіть користувача надсилати API-ключі в чат.",
  ), connectorSettingsLinkSchema, (args) => getConnectorSettingsLink(env, baseUrl, args.connector_id), WRITE_INTERNAL);
  tool(server, "list_connectors", "List connector actions", bi("Stable live discovery gateway. Reads current saved connectors from D1 and lists virtual system and native actions. Set include_actions=true when the MCP client has a frozen top-level tool snapshot.", "Стабільний живий gateway пошуку. Читає поточні збережені конектори з D1 і показує віртуальні системні та native дії. Встановіть include_actions=true, якщо MCP-клієнт має застарілий список верхньорівневих команд."), listConnectorsSchema, (args) => listConnectors(env, args), READ_ONLY);
  tool(server, "save_connector", "Save API connector", bi("Creates or updates an API connector manifest. The connector is immediately available through list_connectors and call_connector_tool. A later MCP tool-list refresh only adds top-level shortcut tools. Secrets must be referenced by Cloudflare secret name, never placed directly in the manifest.", "Створює або оновлює налаштування API-конектора. Конектор одразу доступний через list_connectors і call_connector_tool. Подальше оновлення списку MCP-команд лише додає окремі короткі команди. Секрети треба вказувати тільки за назвою Cloudflare secret, ніколи не вставляти значення напряму."), saveConnectorSchema, (args) => saveConnector(env, args), WRITE_EXTERNAL);
  tool(server, "test_connector", "Test connector action", bi("Tests a saved connector action. Defaults to dry_run=true, which prepares the HTTP request without calling the external API. Use this before real calls or when a generated top-level tool fails.", "Тестує збережену дію connector. За замовчуванням dry_run=true: готує HTTP запит без виклику зовнішнього API. Використовуйте перед реальними викликами або коли generated top-level tool падає."), testConnectorSchema, (args) => testConnector(env, args, baseUrl), READ_EXTERNAL);
  tool(server, "call_connector_tool", "Call current action", bi("Legacy compatibility method. Runs only an operation already published in the plugin registry and applies the same permissions and confirmation rules as w_call.", "Старий метод сумісності. Виконує лише дію, яка вже опублікована в реєстрі плагінів, і застосовує ті самі права та правила підтвердження, що й w_call."), callConnectorToolSchema, (args) => wCallLegacyAction(env, gatewayContext, {
    plugin_id: args.connector_id,
    action_name: args.action_name,
    arguments: args.input,
    dry_run: args.dry_run,
    confirmation_token: args.confirmation_token,
    idempotency_key: args.idempotency_key,
  }), WRITE_EXTERNAL);
  tool(server, "delete_connector", "Delete connector", bi("Deletes a saved connector and all of its actions from D1. Its generated top-level MCP tools disappear on the next tools/list refresh. Use only when the user explicitly asks to remove a connector.", "Видаляє збережений connector і всі його actions з D1. Його generated top-level MCP tools зникнуть при наступному tools/list refresh. Використовуйте тільки коли користувач явно просить видалити connector."), connectorIdSchema, (args) => deleteConnector(env, args), DESTRUCTIVE);

  tool(server, "fetch_url", "Fetch URL", bi("Fetches a public HTTPS URL and returns text suitable for LLM interpretation. Blocks local/private hosts and unsafe outbound targets.", "Отримує публічний HTTPS URL і повертає текст для інтерпретації LLM. Блокує local/private hosts і небезпечні outbound targets."), fetchUrlSchema, fetchUrl, READ_EXTERNAL);
  tool(server, "fetch_many_urls", "Fetch many URLs", bi("Fetches up to 10 public HTTPS URLs and returns compact results. Use for lightweight research or status checks, not crawling.", "Отримує до 10 публічних HTTPS URL і повертає компактні результати. Використовуйте для легкого research або status checks, не для crawling."), fetchManyUrlsSchema, fetchManyUrls, READ_EXTERNAL);
  tool(server, "fetch_rss", "Fetch RSS feed", bi("Fetches an RSS/Atom feed and returns recent feed items in a model-readable format.", "Отримує RSS/Atom feed і повертає останні елементи у форматі, зручному для моделі."), fetchRssSchema, fetchRss, READ_EXTERNAL);
  tool(server, "check_url_status", "Check URL status", bi("Checks whether a public website or API endpoint is reachable and how long the request took.", "Перевіряє, чи доступний публічний сайт або API endpoint і скільки часу зайняв запит."), checkUrlStatusSchema, checkUrlStatus, READ_EXTERNAL);

  tool(server, "ai_capabilities", "Workers AI capabilities", bi("Shows whether the native Workers AI binding is configured, plus curated profiles and safety limits.", "Показує, чи налаштований native Workers AI binding, а також curated профілі та safety limits."), aiCapabilitiesSchema, () => aiCapabilities(env), READ_ONLY);
  tool(server, "ai_models_list", "List curated Workers AI models", bi("Lists the curated Workers AI models, exact model metadata, pricing snapshots and stable profiles shipped with this OneAIWorkers version. This is not a live Cloudflare catalog.", "Показує curated моделі Workers AI, точні metadata моделей, snapshot цін і стабільні профілі, що постачаються з цією версією OneAIWorkers. Це не live-каталог Cloudflare."), aiModelsListSchema, aiModelsList, READ_ONLY);
  tool(server, "ai_recommend_model", "Recommend a Workers AI model", bi("Deterministically recommends a curated model from workload, cost, latency, quality, context and capability requirements. It does not invoke or bill an AI model.", "Детерміновано рекомендує curated модель за задачею, ціною, latency, якістю, context і потрібними capabilities. Цей tool не викликає і не тарифікує AI-модель."), aiRecommendModelSchema, aiRecommendModel, READ_ONLY);
  tool(server, "ai_neuron_status", "Neuron meter status", bi("Shows today's locally tracked Workers AI neuron estimate for this OneAIWorkers deployment, remaining free allocation, UTC reset time, token-source confidence, and whether Cloudflare error 3036 was observed. This is not an account-wide Cloudflare total.", "Показує локально відстежену оцінку Workers AI neurons за сьогодні для цього OneAIWorkers deployment, залишок free allocation, UTC reset, confidence джерела токенів і чи спостерігалась Cloudflare помилка 3036. Це не загальний показник Cloudflare account."), aiNeuronStatusSchema, () => aiNeuronStatus(env), READ_ONLY);
  tool(server, "ai_neuron_history", "Neuron meter history", bi("Lists recent local billing ledger entries with model, token counts, neuron estimate, run ID and agent ID. Prompts and outputs are never stored in this ledger.", "Показує останні записи локального billing ledger: модель, token counts, оцінка neurons, run ID та agent ID. Prompts і outputs у цьому ledger не зберігаються."), aiNeuronHistorySchema, (args) => aiNeuronHistory(env, args), READ_ONLY);
  tool(server, "ai_chat", "Run Workers AI chat", bi("Runs a non-streaming text chat through the native Workers AI binding, records local neuron usage, and returns a billing block with token counts, estimated neurons, daily PSY usage, and confidence.", "Запускає non-streaming text chat через native Workers AI binding, записує локальне використання neurons і повертає billing block з token counts, estimated neurons, добовим PSY usage та confidence."), aiChatSchema, (args) => aiChat(env, args), READ_EXTERNAL);
  tool(server, "ai_embeddings", "Create Workers AI embeddings", bi("Creates text embeddings through the native Workers AI binding using a curated multilingual model by default and reports the exact selected model.", "Створює text embeddings через native Workers AI binding, за замовчуванням використовуючи curated multilingual модель, і повертає точну обрану модель."), aiEmbeddingsSchema, (args) => aiEmbeddings(env, args), READ_EXTERNAL);
  tool(server, "ai_extract_json", "Extract structured JSON with Workers AI", bi("Uses an active structured-output model to extract an object according to a supplied JSON Schema and reports the exact selected model.", "Використовує активну structured-output модель для extraction об'єкта за переданою JSON Schema і повертає точну обрану модель."), aiExtractJsonSchema, (args) => aiExtractJson(env, args), READ_EXTERNAL);
  tool(server, "ai_run", "Run advanced Workers AI request", bi("Runs an advanced non-streaming Workers AI request. Only @cf/ models are accepted; unlisted models require explicit opt-in. This operation may consume Workers AI quota.", "Запускає advanced non-streaming Workers AI request. Дозволені лише @cf/ моделі; unlisted моделі потребують явного opt-in. Операція може використовувати квоту Workers AI."), aiRunSchema, (args) => aiRun(env, args), READ_EXTERNAL);

  tool(server, "agent_capabilities", "Agent orchestration capabilities", bi("Shows whether the Durable Object agent registry and Workers AI bindings are configured, plus lifecycle, cost, and cancellation limits.", "Показує, чи налаштовані Durable Object registry агентів і Workers AI bindings, а також lifecycle, cost і cancellation limits."), agentCapabilitiesSchema, () => agentCapabilities(env), READ_ONLY);
  tool(server, "agent_team_propose", "Propose an agent team", bi("Proposes a senior coordinator and specialist agents for a task, with responsibilities, orchestration stages, expected results, and preflight USD, expected-neuron, and maximum-neuron estimates. This never creates agents.", "Пропонує старшого координатора і спеціалістів для задачі з відповідальністю, етапами оркестрації, очікуваними результатами та preflight оцінками в USD, expected neurons і maximum neurons. Агентів не створює."), agentTeamProposeSchema, agentTeamPropose, READ_ONLY);
  tool(server, "agent_create", "Create agent", bi("Creates one data-defined agent in the Durable Object registry after explicit confirmation.", "Створює одного data-defined агента в Durable Object registry після явного підтвердження."), agentCreateSchema, (args) => agentCreate(env, args), WRITE_INTERNAL);
  tool(server, "agent_list", "List agents", bi("Lists saved agents and whether each agent is enabled.", "Показує збережених агентів і чи кожен агент увімкнений."), agentListSchema, (args) => agentList(env, args), READ_ONLY);
  tool(server, "agent_get", "Get agent", bi("Returns one saved agent configuration without running it.", "Повертає конфігурацію одного агента без запуску."), agentGetSchema, (args) => agentGet(env, args), READ_ONLY);
  tool(server, "agent_update", "Update agent", bi("Updates an agent role, model, limits, or enabled state after explicit confirmation.", "Оновлює роль, модель, ліміти або enabled state агента після явного підтвердження."), agentUpdateSchema, (args) => agentUpdate(env, args), WRITE_INTERNAL);
  tool(server, "agent_delete", "Delete agent", bi("Deletes an unused agent after explicit confirmation. Agents assigned to teams cannot be deleted directly.", "Видаляє невикористовуваного агента після явного підтвердження. Агента в команді не можна видалити напряму."), agentDeleteSchema, (args) => agentDelete(env, args), DESTRUCTIVE);
  tool(server, "agent_team_create", "Create agent team", bi("Creates a confirmed coordinator-and-specialists team from a reviewed proposal. No new Worker or code deployment is created.", "Створює підтверджену команду координатора і спеціалістів із перевіреної пропозиції. Новий Worker або deployment коду не створюється."), agentTeamCreateSchema, (args) => agentTeamCreate(env, args), WRITE_INTERNAL);
  tool(server, "agent_team_list", "List agent teams", bi("Lists saved agent teams and their enabled state.", "Показує збережені команди агентів та їх enabled state."), agentTeamListSchema, (args) => agentTeamList(env, args), READ_ONLY);
  tool(server, "agent_team_get", "Get agent team", bi("Returns a team, its agents, orchestration settings, and current cost estimate.", "Повертає команду, її агентів, orchestration settings і поточну оцінку вартості."), agentTeamGetSchema, (args) => agentTeamGet(env, args), READ_ONLY);
  tool(server, "agent_team_update", "Update agent team", bi("Updates membership, coordinator, limits, budget, rounds, or enabled state after explicit confirmation.", "Оновлює склад, координатора, ліміти, бюджет, rounds або enabled state після явного підтвердження."), agentTeamUpdateSchema, (args) => agentTeamUpdate(env, args), WRITE_INTERNAL);
  tool(server, "agent_team_delete", "Delete agent team", bi("Deletes an agent team and optionally its now-unused agents after explicit confirmation.", "Видаляє команду агентів і опційно її вже невикористовуваних агентів після явного підтвердження."), agentTeamDeleteSchema, (args) => agentTeamDelete(env, args), DESTRUCTIVE);
  tool(server, "agent_team_start", "Start agent team run", bi("Starts a durable queued agent run after explicit confirmation. Before the first AI call, the Worker checks the USD budget and attaches an expected/max neuron preflight compared with the locally tracked daily remainder.", "Запускає durable queued run агентів після явного підтвердження. До першого AI call Worker перевіряє USD budget і додає expected/max neuron preflight у порівнянні з локально відстеженим добовим залишком."), agentTeamStartSchema, (args) => agentTeamStart(env, args), WRITE_EXTERNAL);
  tool(server, "agent_run_list", "List agent runs", bi("Lists recent queued, running, completed, failed, and cancelled agent runs.", "Показує останні queued, running, completed, failed і cancelled запуски агентів."), agentRunListSchema, (args) => agentRunList(env, args), READ_ONLY);
  tool(server, "agent_run_status", "Get agent run status", bi("Returns the current orchestration stage, specialist outputs, estimated usage, error, or final result for one run.", "Повертає поточний етап оркестрації, outputs спеціалістів, estimated usage, помилку або фінальний результат одного run."), agentRunStatusSchema, (args) => agentRunStatus(env, args), READ_ONLY);
  tool(server, "agent_run_cancel", "Cancel agent run", bi("Requests cooperative cancellation after explicit confirmation. A Workers AI request already in flight cannot be interrupted, but no next step will start.", "Запитує cooperative cancellation після явного підтвердження. Workers AI request, що вже виконується, не переривається, але наступний крок не почнеться."), agentRunCancelSchema, (args) => agentRunCancel(env, args), DESTRUCTIVE);

  tool(server, "send_notification", "Send notification", bi("Sends a message through configured Telegram, Discord, Slack, or generic webhook integration. This creates an external side effect.", "Надсилає повідомлення через налаштований Telegram, Discord, Slack або generic webhook. Це створює зовнішній side effect."), sendNotificationSchema, (args) => sendNotification(env, args), WRITE_EXTERNAL);
  tool(server, "call_webhook", "Call webhook", bi("Calls a public HTTPS webhook with a JSON payload. Use for user-approved automation callbacks only.", "Викликає публічний HTTPS webhook з JSON payload. Використовуйте тільки для підтверджених користувачем automation callbacks."), callWebhookSchema, callWebhook, WRITE_EXTERNAL);

  tool(server, "create_child_worker_from_template", "Create child Worker from template", bi("Advanced builder: deploys a protected child Cloudflare Worker from a reviewed safe template. The child is meant to be used through the main OneAIWorkers gateway; direct API access is optional and requires an explicit token.", "Розширений builder: деплоїть захищений child Cloudflare Worker з перевіреного безпечного шаблону. Child має використовуватись через основний OneAIWorkers gateway; прямий API доступ опційний і вимагає окремий token."), createChildWorkerSchema, (args) => createChildWorkerFromTemplate(env, args), WRITE_EXTERNAL);
  tool(server, "deploy_custom_child_worker", "Deploy custom child Worker", bi("Advanced Worker Builder: deploys reviewed custom JavaScript as a separate protected child Worker only when allow_custom_code=true. Register it as a connector so the MCP client sees its actions as normal OneAIWorkers tools.", "Розширений Worker Builder: розгортає перевірений JavaScript як окремий захищений дочірній Worker лише коли allow_custom_code=true. Зареєструйте його як конектор, щоб MCP-клієнт бачив його дії як звичайні інструменти OneAIWorkers."), deployCustomChildWorkerSchema, (args) => deployCustomChildWorker(env, args), WRITE_EXTERNAL);

  registerConnectorTools(server, env, gatewayContext, connectorTools);

  return server;
}

function tool<T extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  inputSchema: T,
  handler: (args: z.infer<z.ZodObject<T>>) => Promise<unknown> | unknown,
  annotations: Record<string, boolean>,
) {
  const directRoute = directGatewayContexts.get(server);
  const routePluginId = NATIVE_TOOLS.some((item) => item.name === name)
    ? "native"
    : SYSTEM_ACTIONS.some((item) => item.name === name) && name !== "call_connector_tool"
      ? "system"
      : null;
  const routedInputSchema = directRoute && routePluginId
    ? {
        ...inputSchema,
        confirmation_token: z.string().min(20).max(300).optional(),
        idempotency_key: z.string().min(1).max(200).optional(),
      }
    : inputSchema;
  const callback = (async (args: unknown) => safeRun(
    () => directRoute && routePluginId
      ? wCallLegacyAction(directRoute.env, directRoute.context, {
          plugin_id: routePluginId,
          action_name: name,
          arguments: connectorInput(args as Record<string, unknown>),
          confirmation_token: typeof (args as Record<string, unknown>).confirmation_token === "string"
            ? String((args as Record<string, unknown>).confirmation_token)
            : undefined,
          idempotency_key: typeof (args as Record<string, unknown>).idempotency_key === "string"
            ? String((args as Record<string, unknown>).idempotency_key)
            : undefined,
        })
      : handler(args as z.infer<z.ZodObject<T>>),
    serverUpdateNotices.get(server),
  )) as never;
  const descriptor = {
    title,
    description,
    inputSchema: routedInputSchema,
    securitySchemes: OAUTH_SECURITY_SCHEMES,
    annotations,
  } as never;
  server.registerTool(name, descriptor, callback);
}

function registerConnectorTools(server: McpServer, env: Env, gatewayContext: Awaited<ReturnType<typeof createWRequestContext>>, connectorTools: ConnectorMcpTool[]) {
  const usedNames = new Set(STATIC_TOOL_NAMES);
  for (const connectorTool of connectorTools) {
    const toolName = uniqueToolName(connectorTool.tool_name, usedNames);
    const annotations = {
      readOnlyHint: connectorTool.read_only,
      destructiveHint: connectorTool.destructive,
      openWorldHint: true,
    };
    const inputSchema = {
      ...inputSchemaFromJsonSchema(connectorTool.input_schema),
      dry_run: z.boolean().default(false).describe(biInline("If true, prepare the routed request without calling the connector.", "Якщо true, підготувати routed request без виклику connector.")),
      confirmed: z.boolean().default(false).describe(biInline("Optional explicit user confirmation for side-effect actions.", "Опційне явне підтвердження користувача для actions із side effects.")),
      confirmation_token: z.string().min(20).max(300).optional(),
      idempotency_key: z.string().min(1).max(200).optional(),
    };
    tool(
      server,
      toolName,
      connectorTool.title,
      connectorTool.description,
      inputSchema,
      (args) => {
        const dryRun = Boolean(args.dry_run);
        return wCallLegacyAction(env, gatewayContext, {
          plugin_id: connectorTool.connector_id,
          action_name: connectorTool.action_name,
          arguments: connectorInput(args),
          dry_run: dryRun,
          confirmation_token: typeof args.confirmation_token === "string" ? args.confirmation_token : undefined,
          idempotency_key: typeof args.idempotency_key === "string" ? args.idempotency_key : undefined,
        });
      },
      annotations,
    );
  }
}

async function safeRun(
  fn: () => Promise<unknown> | unknown,
  getNotice?: () => Promise<ReturnType<typeof updateNotice>>,
) {
  try {
    const data = redactSensitiveValue(await fn());
    const update = await getNotice?.();
    return mcpText({ ok: true, data, update });
  } catch (error) {
    const update = await getNotice?.();
    return mcpText({
      ok: false,
      message: redactSensitiveText(`${biInline("Error", "Помилка")}: ${errorMessage(error)}`),
      update,
    });
  }
}

async function loadConnectorTools(env: Env): Promise<{ connectorTools: ConnectorMcpTool[]; connectorToolError: string | null }> {
  try {
    if (!env.OAUTH_DB) return { connectorTools: [], connectorToolError: "D1 database is not configured." };
    return { connectorTools: await listConnectorMcpTools(env), connectorToolError: null };
  } catch (error) {
    return { connectorTools: [], connectorToolError: redactSensitiveText(errorMessage(error)) };
  }
}

function connectorInput(args: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (key === "dry_run" || key === "confirmed" || key === "confirmation_token" || key === "idempotency_key") continue;
    input[key] = value;
  }
  return input;
}

function inputSchemaFromJsonSchema(schema: unknown): z.ZodRawShape {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return {};
  const record = schema as Record<string, unknown>;
  const properties = record.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return {};
  const required = new Set(Array.isArray(record.required) ? record.required.filter((item): item is string => typeof item === "string") : []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
    let field = zodFromJsonSchemaProperty(value);
    const property = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    if ("default" in property) field = field.default(property.default as never);
    else if (!required.has(key)) field = field.optional();
    shape[key] = field;
  }
  return shape;
}

function zodFromJsonSchemaProperty(schema: unknown): z.ZodTypeAny {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return z.unknown();
  const record = schema as Record<string, unknown>;
  const description = typeof record.description === "string" ? record.description : undefined;
  const enumValues = Array.isArray(record.enum) ? record.enum.filter((item): item is string => typeof item === "string") : [];
  if (enumValues.length > 0) return describe(z.enum(enumValues as [string, ...string[]]), description);

  const type = Array.isArray(record.type) ? record.type.find((item) => item !== "null") : record.type;
  if (type === "string") return describe(z.string(), description);
  if (type === "number" || type === "integer") return describe(z.number(), description);
  if (type === "boolean") return describe(z.boolean(), description);
  if (type === "array") return describe(z.array(z.unknown()), description);
  if (type === "object") return describe(z.record(z.string(), z.unknown()), description);
  return describe(z.unknown(), description);
}

function describe<T extends z.ZodTypeAny>(schema: T, description?: string): T {
  return description ? schema.describe(description) as T : schema;
}

function groupConnectorTools(connectorTools: ConnectorMcpTool[]) {
  const groups: Record<string, { connector_id: string; connector_name: string; tools: string[] }> = {};
  for (const item of connectorTools) {
    groups[item.connector_id] ??= { connector_id: item.connector_id, connector_name: item.connector_name, tools: [] };
    groups[item.connector_id].tools.push(item.tool_name);
  }
  return Object.values(groups);
}

function uniqueToolName(baseName: string, usedNames: Set<string>): string {
  let name = baseName;
  let index = 2;
  while (usedNames.has(name)) name = `${baseName}_${index++}`;
  usedNames.add(name);
  return name;
}

function configuredFlags(env: Env) {
  return {
    d1_database: Boolean(env.OAUTH_DB),
    mcp_shared_secret: Boolean(env.MCP_SHARED_SECRET),
    telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    discord: Boolean(env.DISCORD_WEBHOOK_URL),
    slack: Boolean(env.SLACK_WEBHOOK_URL),
    default_webhook: Boolean(env.DEFAULT_WEBHOOK_URL),
    workers_ai: Boolean(env.AI),
    agent_manager: Boolean(env.AGENT_MANAGER),
    encrypted_credentials: Boolean(env.CREDENTIALS_MASTER_KEY),
    plugin_installer_signature: Boolean(env.PLUGIN_INSTALLER_PUBLIC_KEY || env.CONNECTOR_INSTALLER_PUBLIC_KEY),
    marketplace: Boolean(env.MARKETPLACE_CATALOG_URL || env.PLUGIN_INSTALLER_URL),
    worker_builder: Boolean(env.CF_ACCOUNT_ID && env.CF_API_TOKEN),
  };
}
