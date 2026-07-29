export interface InstallerEnv {
  CF_OAUTH_CLIENT_ID?: string;
  CF_OAUTH_CLIENT_SECRET?: string;
  INSTALLER_SESSION_SECRET?: string;
  CF_OAUTH_SCOPES?: string;
  PUBLIC_BASE_URL?: string;
  INSTALLER_NAME?: string;
}

export interface InstallerSession {
  accessToken: string;
  csrf: string;
  exp: number;
  mode: "install" | "update";
  workerUrl?: string;
}

export interface OAuthState {
  nonce: string;
  exp: number;
  mode: "install" | "update";
  workerUrl?: string;
}

export interface CloudflareAccount {
  id: string;
  name: string;
}
