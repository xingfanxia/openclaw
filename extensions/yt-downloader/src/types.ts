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

export interface YtDownloaderConfig {
  accounts: AccountConfig[];
  oauth: OAuthConfig;
  defaultAccount?: string;
  accountAliases?: Record<string, string>;
  cookiesFile?: string;
}

export function resolveAccountId(
  accountIdOrAlias: string | undefined,
  config: YtDownloaderConfig,
): string | undefined {
  if (!accountIdOrAlias) {
    return config.defaultAccount;
  }
  if (config.accountAliases && config.accountAliases[accountIdOrAlias]) {
    return config.accountAliases[accountIdOrAlias];
  }
  return accountIdOrAlias;
}
