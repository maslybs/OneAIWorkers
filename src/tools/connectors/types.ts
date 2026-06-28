export type JsonObject = Record<string, unknown>;

export type ConnectorMode = "internal" | "child_worker";

export type OAuthClientAuthMethod = "basic" | "body";

export type AuthConfig =
  | { type: "none" }
  | { type: "bearer_secret"; secret_name: string }
  | { type: "auth_header_secret"; secret_name: string; scheme?: string }
  | { type: "api_key_header_secret"; secret_name: string; header_name: string }
  | { type: "api_key_query_secret"; secret_name: string; query_name: string }
  | { type: "basic_secret"; secret_name: string; username?: string }
  | { type: "basic_secret_pair"; username_secret_name: string; password_secret_name: string }
  | {
      type: "oauth2_client_credentials";
      token_url: string;
      client_id_secret_name: string;
      client_secret_secret_name: string;
      scope?: string;
      audience?: string;
      client_auth_method?: OAuthClientAuthMethod;
      access_token_field?: string;
      token_type?: string;
    }
  | {
      type: "oauth2_refresh_token";
      token_url: string;
      refresh_token_secret_name: string;
      client_id_secret_name?: string;
      client_secret_secret_name?: string;
      scope?: string;
      client_auth_method?: OAuthClientAuthMethod;
      access_token_field?: string;
      token_type?: string;
    }
  | {
      type: "google_oauth2_refresh_token";
      client_id_secret_name: string;
      client_secret_secret_name: string;
      refresh_token_secret_name: string;
      scope?: string;
    };

export interface ConnectorRow {
  connector_id: string;
  name: string;
  description: string | null;
  mode: ConnectorMode;
  child_worker_url: string | null;
  child_worker_binding: string | null;
  child_worker_token_secret: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface ActionRow {
  connector_id: string;
  action_name: string;
  description: string | null;
  method: string;
  url: string;
  auth_json: string;
  headers_json: string;
  query_json: string;
  body_template_json: string | null;
  input_schema_json: string | null;
  created_at: number;
  updated_at: number;
}

export interface PreparedRequest {
  method: string;
  url: URL;
  headers: Headers;
  body?: string;
}
