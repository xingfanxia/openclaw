import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import { listEvents } from "../calendar-client.js";
import type { OAuthConfig, AccountConfig } from "../types.js";
import {
  accountNotFoundResult,
  errorResult,
  successResult,
  validateAccount,
  resolveAccountId,
} from "../types.js";

export function createCalendarEventsTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  defaultTimezone: string,
  defaultAccount: string,
  aliases: Record<string, string>,
): AnyAgentTool {
  return {
    name: "calendar_events",
    description: `Search or list calendar events. Supports time range filtering and text search. Default account: ${defaultAccount}.`,
    parameters: Type.Object({
      account_id: Type.Optional(
        Type.String({
          description: `Account ID or alias (default: ${defaultAccount})`,
        }),
      ),
      time_min: Type.Optional(
        Type.String({
          description: "Start of time range (ISO 8601). Defaults to now.",
        }),
      ),
      time_max: Type.Optional(
        Type.String({
          description: "End of time range (ISO 8601). Defaults to 7 days from now.",
        }),
      ),
      query: Type.Optional(
        Type.String({
          description: "Free-text search query to filter events",
        }),
      ),
      calendar_id: Type.Optional(
        Type.String({
          description: "Calendar ID to query (default: primary)",
        }),
      ),
      max_results: Type.Optional(
        Type.Number({
          description: "Maximum events to return (default: 50)",
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        account_id?: string;
        time_min?: string;
        time_max?: string;
        query?: string;
        calendar_id?: string;
        max_results?: number;
      },
    ) => {
      const accountId = resolveAccountId(params.account_id, defaultAccount, aliases);
      if (!validateAccount(accounts, accountId)) {
        return accountNotFoundResult(accountId, accounts);
      }

      try {
        const now = new Date();
        const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const events = await listEvents(oauthConfig, accountId, {
          calendarId: params.calendar_id,
          timeMin: params.time_min ?? now.toISOString(),
          timeMax: params.time_max ?? weekLater.toISOString(),
          query: params.query,
          maxResults: params.max_results,
        });

        return successResult({
          account: accountId,
          eventCount: events.length,
          timeRange: {
            from: params.time_min ?? now.toISOString(),
            to: params.time_max ?? weekLater.toISOString(),
          },
          query: params.query ?? null,
          events: events.map((e) => ({
            id: e.id,
            summary: e.summary,
            start: e.start,
            end: e.end,
            allDay: e.allDay,
            location: e.location,
            status: e.status,
            hangoutLink: e.hangoutLink,
            attendees: e.attendees,
            htmlLink: e.htmlLink,
          })),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(message, { account: accountId });
      }
    },
  } as AnyAgentTool;
}
