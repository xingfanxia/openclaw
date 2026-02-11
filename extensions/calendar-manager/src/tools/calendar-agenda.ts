import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import type { OAuthConfig, AccountConfig } from "../types.js";
import type { CalendarEvent } from "../types.js";
import { listEvents } from "../calendar-client.js";
import {
  accountNotFoundResult,
  errorResult,
  successResult,
  validateAccount,
  resolveAccountId,
} from "../types.js";

function groupByDate(events: CalendarEvent[]): Record<string, CalendarEvent[]> {
  const groups: Record<string, CalendarEvent[]> = {};
  for (const event of events) {
    const dateKey = event.allDay ? event.start : event.start.split("T")[0];
    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    groups[dateKey].push(event);
  }
  return groups;
}

function formatTime(isoString: string, allDay: boolean): string {
  if (allDay) return "all-day";
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

export function createCalendarAgendaTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  defaultTimezone: string,
  defaultAccount: string,
  aliases: Record<string, string>,
): AnyAgentTool {
  return {
    name: "calendar_agenda",
    description: `Get a day or multi-day agenda summary grouped by date. Default account: ${defaultAccount} (work=x@computelabs.ai, personal=xingfanxia@gmail.com). Great for "What's on my calendar today?" or "Show my week ahead".`,
    parameters: Type.Object({
      account_id: Type.Optional(
        Type.String({ description: `Account ID or alias (default: ${defaultAccount})` }),
      ),
      days: Type.Optional(
        Type.Number({
          description: "Number of days to show (1-14, default: 1 for today)",
          minimum: 1,
          maximum: 14,
        }),
      ),
      calendar_id: Type.Optional(Type.String({ description: "Calendar ID (default: primary)" })),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        account_id?: string;
        days?: number;
        calendar_id?: string;
      },
    ) => {
      const accountId = resolveAccountId(params.account_id, defaultAccount, aliases);
      if (!validateAccount(accounts, accountId)) {
        return accountNotFoundResult(accountId, accounts);
      }

      try {
        const days = params.days ?? 1;
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfRange = new Date(startOfDay.getTime() + days * 24 * 60 * 60 * 1000);

        const events = await listEvents(oauthConfig, accountId, {
          calendarId: params.calendar_id,
          timeMin: startOfDay.toISOString(),
          timeMax: endOfRange.toISOString(),
          maxResults: 100,
        });

        const grouped = groupByDate(events);

        const agendaDays: Array<{
          date: string;
          dayLabel: string;
          events: Array<{
            id: string;
            time: string;
            summary: string;
            location?: string;
            hangoutLink?: string;
          }>;
        }> = [];

        const dateKeys = Object.keys(grouped).sort();
        for (const dateKey of dateKeys) {
          const dayEvents = grouped[dateKey];
          const dateObj = new Date(dateKey + "T12:00:00");
          const dayLabel = dateObj.toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
          });

          agendaDays.push({
            date: dateKey,
            dayLabel,
            events: dayEvents.map((e) => ({
              id: e.id,
              time: formatTime(e.start, e.allDay),
              summary: e.summary,
              location: e.location,
              hangoutLink: e.hangoutLink,
            })),
          });
        }

        for (let i = 0; i < days; i++) {
          const d = new Date(startOfDay.getTime() + i * 24 * 60 * 60 * 1000);
          const dateKey = d.toISOString().split("T")[0];
          if (!grouped[dateKey]) {
            const dayLabel = d.toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
            });
            agendaDays.push({
              date: dateKey,
              dayLabel,
              events: [],
            });
          }
        }

        agendaDays.sort((a, b) => a.date.localeCompare(b.date));

        return successResult({
          account: accountId,
          days,
          totalEvents: events.length,
          agenda: agendaDays,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(message, { account: accountId });
      }
    },
  } as AnyAgentTool;
}
