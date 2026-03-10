import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import { listCalendars } from "../calendar-client.js";
import type { OAuthConfig, AccountConfig } from "../types.js";
import {
  accountNotFoundResult,
  errorResult,
  successResult,
  validateAccount,
  resolveAccountId,
} from "../types.js";

export function createCalendarListTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  defaultAccount: string,
  aliases: Record<string, string>,
): AnyAgentTool {
  return {
    name: "calendar_list",
    description: `List all calendars available for a Google account. Shows calendar name, ID, timezone, and access role. Default account: ${defaultAccount}. Aliases: ${Object.entries(
      aliases,
    )
      .map(([k, v]) => `${k}→${v}`)
      .join(", ")}.`,
    parameters: Type.Object({
      account_id: Type.Optional(
        Type.String({
          description: `Account ID or alias (default: ${defaultAccount}). Available: ${accounts.map((a) => a.id).join(", ")}`,
        }),
      ),
    }),
    execute: async (_toolCallId: string, params: { account_id?: string }) => {
      const accountId = resolveAccountId(params.account_id, defaultAccount, aliases);
      if (!validateAccount(accounts, accountId)) {
        return accountNotFoundResult(accountId, accounts);
      }

      try {
        const calendars = await listCalendars(oauthConfig, accountId);
        return successResult({
          account: accountId,
          calendarCount: calendars.length,
          calendars: calendars.map((c) => ({
            id: c.id,
            name: c.summary,
            primary: c.primary,
            timeZone: c.timeZone,
            accessRole: c.accessRole,
          })),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(message, { account: accountId });
      }
    },
  } as AnyAgentTool;
}
