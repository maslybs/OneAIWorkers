export interface Env {
  [key: string]: unknown;

  HUB_NAME?: string;
  PUBLIC_BASE_URL?: string;
  MCP_SHARED_SECRET?: string;
  UPDATE_CHECK_ENABLED?: string;
  UPDATE_MANIFEST_URL?: string;
  UPDATE_SERVICE_URL?: string;

  // D1 database used for OAuth, connector registry, and audit records.
  OAUTH_DB?: D1Database;

  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  DISCORD_WEBHOOK_URL?: string;
  SLACK_WEBHOOK_URL?: string;
  DEFAULT_WEBHOOK_URL?: string;

  // Optional. Needed only for advanced Worker Builder / child Workers.
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  CF_WORKERS_DEV_SUBDOMAIN?: string;
}

export interface ToolResultPayload {
  ok: boolean;
  message?: string;
  data?: unknown;
  update?: UpdateNotice;
}

export interface UpdateNotice {
  available: true;
  current_version: string;
  latest_version: string;
  critical: boolean;
  update_url: string;
  release_notes_url?: string;
  message: {
    en: string;
    uk: string;
  };
}

export interface UrlFetchResult {
  url: string;
  status: number;
  ok: boolean;
  contentType: string | null;
  finalUrl: string;
  text: string;
  truncated: boolean;
}
