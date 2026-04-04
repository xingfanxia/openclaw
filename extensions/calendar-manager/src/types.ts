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

export interface PluginConfig {
  accounts: AccountConfig[];
  oauth: OAuthConfig;
  defaultTimezone: string;
  defaultAccount?: string;
  accountAliases?: Record<string, string>;
}

export interface CalendarEntry {
  id: string;
  summary: string;
  description?: string;
  primary: boolean;
  timeZone?: string;
  accessRole: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  status: string;
  htmlLink: string;
  hangoutLink?: string;
  attendees?: Array<{ email: string; responseStatus: string }>;
  recurrence?: string[];
  creator?: string;
  organizer?: string;
}

export function resolveAccountId(
  accountId: string | undefined,
  defaultAccount: string,
  aliases: Record<string, string>,
): string {
  if (!accountId) return defaultAccount;
  return aliases[accountId] ?? accountId;
}

export function validateAccount(
  accounts: AccountConfig[],
  accountId: string,
): AccountConfig | null {
  return accounts.find((a) => a.id === accountId) ?? null;
}

export function accountNotFoundResult(accountId: string, accounts: AccountConfig[]) {
  const result = {
    error: `Account "${accountId}" not found. Available: ${accounts.map((a) => a.id).join(", ")}`,
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    details: result,
  };
}

export function errorResult(message: string, extra?: Record<string, unknown>) {
  const result = { error: message, ...extra };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    details: result,
  };
}

export function successResult(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}
