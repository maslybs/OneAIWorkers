export type ExposureMode = "meta" | "direct" | "hybrid";
export type CapabilityKind = "plugin" | "skill" | "agent" | "prompt" | "resource" | "ui";
export type WPermission = "discover" | "describe" | "execute" | "present" | "read" | "edit" | "admin";

export interface WRequestContext {
  tenantId: string;
  userId: string;
  endpointId: string;
  sessionId: string;
  exposureMode: ExposureMode;
  baseUrl: string;
}

export interface WEndpointConfig {
  endpoint_id: string;
  exposure_mode: ExposureMode;
  exposed_plugins_json: string;
  exposed_capability_kinds_json: string;
  allow_direct_tools_json: string;
  access_level: "read" | "edit" | "admin";
}

export interface WToolRecord {
  id: string;
  tool_ref: string;
  method_name: string;
  version: string;
  title: string;
  description: string;
  search_text: string;
  input_schema_json: string;
  output_schema_json: string | null;
  execution_plan_json: string;
  read_only: number;
  destructive: number;
  idempotent: number;
  requires_confirmation: number;
  connection_type: string | null;
  required_scopes_json: string | null;
  semantic_family: string | null;
  presentation_mode: string;
  enabled: number;
  status: string;
  schema_hash: string;
  search_text_hash: string;
  capability_id: string;
  capability_key: string;
  capability_kind: CapabilityKind;
  capability_title: string;
  capability_description: string;
  capability_target: string;
  plugin_version_id: string;
  plugin_id: string;
  plugin_name: string;
  plugin_description: string;
  plugin_enabled: number;
  connected?: number;
  historical_success?: number;
}

export interface WSearchCandidate extends WToolRecord {
  exactScore: number;
  lexicalScore: number;
  semanticScore: number;
  availabilityScore: number;
  historicalSuccessScore: number;
  score: number;
}

export interface WVectorRow {
  tool_id: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_blob: ArrayBuffer | Uint8Array | number[];
  embedding_norm: number;
  cluster_id: number | null;
}

export interface WExecutionPlan {
  type: "legacy" | "skill";
  connector_id?: string;
  action_name?: string;
  skill_ref?: string;
  dispatch?: Record<string, unknown>;
  argument_root?: string;
  argument_aliases?: Record<string, string>;
  value_aliases?: Record<string, Record<string, string>>;
}

export interface WStoredResultRow {
  id: string;
  tenant_id: string;
  user_id: string;
  endpoint_id: string;
  session_id: string | null;
  content_type: string;
  storage_type: string;
  storage_key: string;
  original_chars: number | null;
  content_hash: string;
  created_at: string;
  expires_at: string;
}
