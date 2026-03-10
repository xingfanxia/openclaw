import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import { updateEvent } from "../calendar-client.js";
import type { OAuthConfig, AccountConfig } from "../types.js";
import {
  accountNotFoundResult,
  errorResult,
  successResult,
  validateAccount,
  resolveAccountId,
} from "../types.js";

export function createCalendarUpdateTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  defaultTimezone: string,
  defaultAccount: string,
  aliases: Record<string, string>,
): AnyAgentTool {
  return {
    name: "calendar_update",
    description: `Update an existing calendar event (PATCH). Only provided fields are changed. Default account: ${defaultAccount}.`,
    parameters: Type.Object({
      event_id: Type.String({
        description: "Event ID to update",
      }),
      account_id: Type.Optional(
        Type.String({ description: `Account ID or alias (default: ${defaultAccount})` }),
      ),
      summary: Type.Optional(Type.String({ description: "New event title" })),
      description: Type.Optional(Type.String({ description: "New description" })),
      location: Type.Optional(Type.String({ description: "New location" })),
      start_datetime: Type.Optional(Type.String({ description: "New start datetime (ISO 8601)" })),
      end_datetime: Type.Optional(Type.String({ description: "New end datetime (ISO 8601)" })),
      start_date: Type.Optional(
        Type.String({ description: "New start date for all-day (YYYY-MM-DD)" }),
      ),
      end_date: Type.Optional(
        Type.String({ description: "New end date for all-day (YYYY-MM-DD)" }),
      ),
      attendees: Type.Optional(Type.Array(Type.String(), { description: "Replace attendee list" })),
      add_meet_link: Type.Optional(Type.Boolean({ description: "Add a Google Meet link" })),
      calendar_id: Type.Optional(Type.String({ description: "Calendar ID (default: primary)" })),
      timezone: Type.Optional(Type.String({ description: "Timezone for datetime fields" })),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        event_id: string;
        account_id?: string;
        summary?: string;
        description?: string;
        location?: string;
        start_datetime?: string;
        end_datetime?: string;
        start_date?: string;
        end_date?: string;
        attendees?: string[];
        add_meet_link?: boolean;
        calendar_id?: string;
        timezone?: string;
      },
    ) => {
      const accountId = resolveAccountId(params.account_id, defaultAccount, aliases);
      if (!validateAccount(accounts, accountId)) {
        return accountNotFoundResult(accountId, accounts);
      }

      try {
        const event = await updateEvent(oauthConfig, accountId, params.event_id, {
          calendarId: params.calendar_id,
          summary: params.summary,
          description: params.description,
          location: params.location,
          startDateTime: params.start_datetime,
          endDateTime: params.end_datetime,
          startDate: params.start_date,
          endDate: params.end_date,
          timeZone: params.timezone ?? defaultTimezone,
          attendees: params.attendees,
          addMeetLink: params.add_meet_link,
        });

        return successResult({
          success: true,
          account: accountId,
          event: {
            id: event.id,
            summary: event.summary,
            start: event.start,
            end: event.end,
            location: event.location,
            hangoutLink: event.hangoutLink,
            htmlLink: event.htmlLink,
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(message, { account: accountId });
      }
    },
  } as AnyAgentTool;
}
