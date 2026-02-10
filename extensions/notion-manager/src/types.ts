export interface NotionAccount {
  id: string;
  integrationToken: string;
  workspace?: string;
}

export interface NotionConfig {
  accounts: NotionAccount[];
  defaultAccount: string;
  accountAliases: Record<string, string>;
}

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  createdTime: string;
  lastEditedTime: string;
  archived: boolean;
  parentType: "database_id" | "page_id" | "workspace";
  parentId: string | null;
  properties: Record<string, unknown>;
}

export interface NotionDatabase {
  id: string;
  title: string;
  url: string;
  createdTime: string;
  lastEditedTime: string;
  properties: Record<string, { type: string; name: string }>;
}

export interface NotionBlock {
  id: string;
  type: string;
  hasChildren: boolean;
  content: string;
  children?: NotionBlock[];
}

export interface NotionComment {
  id: string;
  createdTime: string;
  createdBy: string;
  text: string;
}

/**
 * Resolve an account ID or alias to the canonical account ID.
 * Falls back to defaultAccount if no accountId provided.
 */
export function resolveAccountId(
  accountIdOrAlias: string | undefined,
  defaultAccount: string,
  aliases: Record<string, string>,
): string {
  if (!accountIdOrAlias) {
    return defaultAccount;
  }
  if (aliases[accountIdOrAlias]) {
    return aliases[accountIdOrAlias];
  }
  return accountIdOrAlias;
}

/**
 * Find an account by its resolved ID. Throws if not found.
 */
export function findAccount(accounts: NotionAccount[], accountId: string): NotionAccount {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) {
    const available = accounts.map((a) => a.id).join(", ");
    throw new Error(`Notion account "${accountId}" not found. Available accounts: ${available}`);
  }
  return account;
}

/**
 * Resolve account ID and find the account in one step.
 */
export function resolveAccount(
  accountIdOrAlias: string | undefined,
  config: NotionConfig,
): NotionAccount {
  const resolvedId = resolveAccountId(
    accountIdOrAlias,
    config.defaultAccount,
    config.accountAliases,
  );
  return findAccount(config.accounts, resolvedId);
}
