import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import { listEvents } from "../calendar-client.js";
import type { OAuthConfig, AccountConfig } from "../types.js";
import type { CalendarEvent } from "../types.js";
import {
  accountNotFoundResult,
  errorResult,
  successResult,
  validateAccount,
  resolveAccountId,
} from "../types.js";

/**
 * Compute midnight (start of day) in the given IANA timezone as a UTC Date.
 *
 * Approach: take noon UTC on the target calendar date, find the local hour/minute
 * at that instant, and subtract to reach local midnight.
 */
function startOfDayInTz(now: Date, tz: string): Date {
  // Today's calendar date in the target timezone (YYYY-MM-DD)
  const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  // Noon UTC on that calendar date — avoids DST-transition edge cases around midnight
  const noonUtc = new Date(`${dateStr}T12:00:00Z`);
  // What local time is it in `tz` at noonUtc?
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(noonUtc);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  // Subtract local hours/minutes from noonUtc to reach midnight local
  return new Date(noonUtc.getTime() - h * 3_600_000 - m * 60_000);
}

function groupByDate(events: CalendarEvent[], timezone: string): Record<string, CalendarEvent[]> {
  const groups: Record<string, CalendarEvent[]> = {};
  const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  for (const event of events) {
    const dateKey = event.allDay ? event.start : dateFmt.format(new Date(event.start));
    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    groups[dateKey].push(event);
  }
  return groups;
}

function formatTime(isoString: string, allDay: boolean, timezone: string): string {
  if (allDay) return "all-day";
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: timezone,
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
    description: `Get a day or multi-day agenda summary grouped by date. Default account: ${defaultAccount}. Use for "What's on my calendar today?" or "Show my week ahead".`,
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
        const startOfDay = startOfDayInTz(now, defaultTimezone);
        const endOfRange = new Date(startOfDay.getTime() + days * 24 * 60 * 60 * 1000);

        const events = await listEvents(oauthConfig, accountId, {
          calendarId: params.calendar_id,
          timeMin: startOfDay.toISOString(),
          timeMax: endOfRange.toISOString(),
          maxResults: 25,
        });

        const grouped = groupByDate(events, defaultTimezone);

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
          const dateObj = new Date(dateKey + "T12:00:00Z");
          const dayLabel = dateObj.toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
            timeZone: defaultTimezone,
          });

          agendaDays.push({
            date: dateKey,
            dayLabel,
            events: dayEvents.map((e) => ({
              id: e.id,
              time: formatTime(e.start, e.allDay, defaultTimezone),
              summary: e.summary,
              location: e.location,
              hangoutLink: e.hangoutLink,
            })),
          });
        }

        // Fill in empty days that had no events
        const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: defaultTimezone });
        for (let i = 0; i < days; i++) {
          const d = new Date(startOfDay.getTime() + i * 24 * 60 * 60 * 1000);
          const dateKey = dateFmt.format(d);
          if (!grouped[dateKey]) {
            const dayLabel = d.toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
              timeZone: defaultTimezone,
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
