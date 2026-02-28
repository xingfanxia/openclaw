import { getCalendarStatus } from "../calendar-client.js";
import type { OAuthConfig, AccountConfig } from "../types.js";

export interface CalendarAccountStatus {
  id: string;
  email: string;
  type: string;
  connected: boolean;
  calendarCount?: number;
  primaryTimezone?: string;
  error?: string;
}

export async function getCalendarStatuses(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
): Promise<CalendarAccountStatus[]> {
  const statuses: CalendarAccountStatus[] = [];

  for (const account of accounts) {
    try {
      const status = await getCalendarStatus(oauthConfig, account.id);
      statuses.push({
        id: account.id,
        email: account.email,
        type: account.type,
        connected: true,
        calendarCount: status.calendarCount,
        primaryTimezone: status.primaryTimezone,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const needsReauth =
        message.includes("insufficient") ||
        message.includes("scope") ||
        message.includes("not authenticated") ||
        message.includes("invalid_grant");
      statuses.push({
        id: account.id,
        email: account.email,
        type: account.type,
        connected: false,
        error: needsReauth
          ? `Calendar access denied. Re-auth needed: /gmail_auth ${account.id}`
          : message,
      });
    }
  }

  return statuses;
}

export function formatCalendarStatusText(statuses: CalendarAccountStatus[]): string {
  const lines: string[] = [];
  lines.push("=== Calendar Account Status ===");
  lines.push("");

  for (const status of statuses) {
    const icon = status.connected ? "[OK]" : "[!!]";
    lines.push(`${icon} ${status.id} (${status.email}) — ${status.type}`);

    if (!status.connected) {
      lines.push(`    Status: Not connected`);
      lines.push(`    Error: ${status.error}`);
    } else {
      lines.push(`    Status: Connected`);
      lines.push(`    Calendars: ${status.calendarCount} | Timezone: ${status.primaryTimezone}`);
    }
    lines.push("");
  }

  const connected = statuses.filter((s) => s.connected).length;
  lines.push(`Connected: ${connected}/${statuses.length} accounts`);

  if (connected < statuses.length) {
    lines.push("");
    lines.push("Tip: Re-auth accounts with /gmail_auth <account-id> to grant Calendar scopes.");
  }

  return lines.join("\n");
}
