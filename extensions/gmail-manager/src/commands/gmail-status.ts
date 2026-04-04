import { getProfile } from "../gmail-client.js";
import type { OAuthConfig } from "../oauth2.js";
import { getToken, isTokenExpired } from "../token-store.js";

interface AccountConfig {
  id: string;
  email: string;
  type: string;
}

export interface AccountStatus {
  id: string;
  email: string;
  type: string;
  connected: boolean;
  tokenExpired: boolean;
  messagesTotal?: number;
  threadsTotal?: number;
  error?: string;
}

export async function getAccountStatuses(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
): Promise<AccountStatus[]> {
  const statuses: AccountStatus[] = [];

  for (const account of accounts) {
    const token = getToken(account.id);

    if (!token) {
      statuses.push({
        id: account.id,
        email: account.email,
        type: account.type,
        connected: false,
        tokenExpired: false,
        error: "Not authenticated. Use /gmail_auth " + account.id,
      });
      continue;
    }

    const expired = isTokenExpired(token);

    try {
      const profile = await getProfile(oauthConfig, account.id);
      statuses.push({
        id: account.id,
        email: account.email,
        type: account.type,
        connected: true,
        tokenExpired: expired,
        messagesTotal: profile.messagesTotal,
        threadsTotal: profile.threadsTotal,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      statuses.push({
        id: account.id,
        email: account.email,
        type: account.type,
        connected: true,
        tokenExpired: expired,
        error: message,
      });
    }
  }

  return statuses;
}

export function formatStatusText(statuses: AccountStatus[]): string {
  const lines: string[] = [];
  lines.push("=== Gmail Account Status ===");
  lines.push("");

  for (const status of statuses) {
    const icon = status.connected && !status.error ? "[OK]" : "[!!]";
    lines.push(`${icon} ${status.id} (${status.email}) — ${status.type}`);

    if (!status.connected) {
      lines.push(`    Status: Not connected`);
      lines.push(`    Action: ${status.error}`);
    } else if (status.error) {
      lines.push(`    Status: Error — ${status.error}`);
    } else {
      lines.push(`    Status: Connected`);
      lines.push(`    Messages: ${status.messagesTotal} | Threads: ${status.threadsTotal}`);
      if (status.tokenExpired) {
        lines.push(`    Warning: Token expired, will refresh on next use`);
      }
    }
    lines.push("");
  }

  const connected = statuses.filter((s) => s.connected && !s.error).length;
  lines.push(`Connected: ${connected}/${statuses.length} accounts`);

  return lines.join("\n");
}
