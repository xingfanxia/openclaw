export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface AccountConfig {
  id: string;
  email: string;
  type: string;
}

export interface DriveConfig {
  accounts: AccountConfig[];
  oauth: OAuthConfig;
  defaultAccount?: string;
  accountAliases?: Record<string, string>;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
  webViewLink?: string;
  webContentLink?: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
  shared?: boolean;
  trashed?: boolean;
}

export interface DrivePermission {
  id: string;
  type: string;
  role: string;
  emailAddress?: string;
  displayName?: string;
}

export function resolveAccountId(
  accountIdOrAlias: string | undefined,
  config: DriveConfig,
): string | undefined {
  if (!accountIdOrAlias) {
    return config.defaultAccount;
  }
  if (config.accountAliases && config.accountAliases[accountIdOrAlias]) {
    return config.accountAliases[accountIdOrAlias];
  }
  return accountIdOrAlias;
}
