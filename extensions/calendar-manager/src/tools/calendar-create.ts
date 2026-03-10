import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import { createEvent } from "../calendar-client.js";
import type { OAuthConfig, AccountConfig } from "../types.js";
import {
  accountNotFoundResult,
  errorResult,
  successResult,
  validateAccount,
  resolveAccountId,
} from "../types.js";

export function createCalendarCreateTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  defaultTimezone: string,
  defaultAccount: string,
  aliases: Record<string, string>,
): AnyAgentTool {
  return {
    name: "calendar_create",
    description: `Create a calendar event. Supports timed events, all-day events, attendees, recurrence, and Google Meet links. Default account: ${defaultAccount}.`,
    parameters: Type.Object({
      summary: Type.String({
        description: "Event title/summary",
      }),
      account_id: Type.Optional(
        Type.String({
          description: `Account ID or alias (default: ${defaultAccount})`,
        }),
      ),
      start_datetime: Type.Optional(
        Type.String({
          description: "Start datetime for timed events (ISO 8601, e.g. 2026-02-10T15:00:00-08:00)",
        }),
      ),
      end_datetime: Type.Optional(
        Type.String({
          description: "End datetime for timed events (ISO 8601). Defaults to 1 hour after start.",
        }),
      ),
      start_date: Type.Optional(
        Type.String({
          description: "Start date for all-day events (YYYY-MM-DD)",
        }),
      ),
      end_date: Type.Optional(
        Type.String({
          description: "End date for all-day events (YYYY-MM-DD). Defaults to start_date.",
        }),
      ),
      description: Type.Optional(Type.String({ description: "Event description/notes" })),
      location: Type.Optional(Type.String({ description: "Event location" })),
      calendar_id: Type.Optional(Type.String({ description: "Calendar ID (default: primary)" })),
      attendees: Type.Optional(
        Type.Array(Type.String(), { description: "Attendee email addresses" }),
      ),
      recurrence: Type.Optional(
        Type.Array(Type.String(), {
          description: "RRULE rules (e.g. ['RRULE:FREQ=WEEKLY;COUNT=10'])",
        }),
      ),
      add_meet_link: Type.Optional(Type.Boolean({ description: "Generate a Google Meet link" })),
      timezone: Type.Optional(
        Type.String({ description: `Timezone (IANA). Default: ${defaultTimezone}` }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        summary: string;
        account_id?: string;
        start_datetime?: string;
        end_datetime?: string;
        start_date?: string;
        end_date?: string;
        description?: string;
        location?: string;
        calendar_id?: string;
        attendees?: string[];
        recurrence?: string[];
        add_meet_link?: boolean;
        timezone?: string;
      },
    ) => {
      const accountId = resolveAccountId(params.account_id, defaultAccount, aliases);
      if (!validateAccount(accounts, accountId)) {
        return accountNotFoundResult(accountId, accounts);
      }

      if (!params.start_datetime && !params.start_date) {
        return errorResult("Either start_datetime or start_date is required.");
      }

      try {
        const tz = params.timezone ?? defaultTimezone;

        let endDateTime = params.end_datetime;
        if (params.start_datetime && !endDateTime && !params.start_date) {
          const startDate = new Date(params.start_datetime);
          startDate.setHours(startDate.getHours() + 1);
          endDateTime = startDate.toISOString();
        }

        const event = await createEvent(oauthConfig, accountId, {
          calendarId: params.calendar_id,
          summary: params.summary,
          description: params.description,
          location: params.location,
          startDateTime: params.start_datetime,
          endDateTime,
          startDate: params.start_date,
          endDate: params.end_date,
          timeZone: tz,
          attendees: params.attendees,
          recurrence: params.recurrence,
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
            allDay: event.allDay,
            location: event.location,
            hangoutLink: event.hangoutLink,
            htmlLink: event.htmlLink,
            attendees: event.attendees,
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(message, { account: accountId });
      }
    },
  } as AnyAgentTool;
}
