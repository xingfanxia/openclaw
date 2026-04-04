import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { google, calendar_v3 } from "googleapis";
import type { OAuthConfig, CalendarEntry, CalendarEvent } from "./types.js";

const TOKEN_FILE = path.join(os.homedir(), ".openclaw", "gmail-tokens.json");

interface StoredToken {
  accountId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  updatedAt: string;
}

interface TokenStore {
  [accountId: string]: StoredToken;
}

function loadTokens(): TokenStore {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = fs.readFileSync(TOKEN_FILE, "utf-8");
      return JSON.parse(data) as TokenStore;
    }
  } catch {
    // Return empty on parse error
  }
  return {};
}

function getToken(accountId: string): StoredToken | undefined {
  const store = loadTokens();
  return store[accountId];
}

function isTokenExpired(token: StoredToken): boolean {
  return Date.now() >= token.expiryDate - 5 * 60 * 1000;
}

function saveTokenUpdate(token: StoredToken): void {
  const store = loadTokens();
  store[token.accountId] = { ...token, updatedAt: new Date().toISOString() };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2), "utf-8");
}

function createOAuth2Client(config: OAuthConfig) {
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

async function ensureFreshToken(config: OAuthConfig, accountId: string): Promise<void> {
  const token = getToken(accountId);
  if (!token) return;
  if (isTokenExpired(token)) {
    const client = createOAuth2Client(config);
    client.setCredentials({ refresh_token: token.refreshToken });
    const { credentials } = await client.refreshAccessToken();
    saveTokenUpdate({
      ...token,
      accessToken: credentials.access_token ?? "",
      expiryDate: credentials.expiry_date ?? Date.now() + 3600 * 1000,
    });
  }
}

function getCalendarClient(config: OAuthConfig, accountId: string): calendar_v3.Calendar {
  const token = getToken(accountId);
  if (!token) {
    throw new Error(
      `Account "${accountId}" is not authenticated. Use /gmail_auth ${accountId} to connect (Calendar scopes required).`,
    );
  }
  const oauth2Client = createOAuth2Client(config);
  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expiry_date: token.expiryDate,
  });
  return google.calendar({ version: "v3", auth: oauth2Client });
}

function parseEvent(event: calendar_v3.Schema$Event): CalendarEvent {
  const isAllDay = Boolean(event.start?.date);
  return {
    id: event.id ?? "",
    summary: event.summary ?? "(no title)",
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    start: isAllDay ? (event.start?.date ?? "") : (event.start?.dateTime ?? ""),
    end: isAllDay ? (event.end?.date ?? "") : (event.end?.dateTime ?? ""),
    allDay: isAllDay,
    status: event.status ?? "confirmed",
    htmlLink: event.htmlLink ?? "",
    hangoutLink: event.hangoutLink ?? undefined,
    attendees: event.attendees?.map((a) => ({
      email: a.email ?? "",
      responseStatus: a.responseStatus ?? "needsAction",
    })),
    recurrence: event.recurrence ?? undefined,
    creator: event.creator?.email ?? undefined,
    organizer: event.organizer?.email ?? undefined,
  };
}

export async function listCalendars(
  config: OAuthConfig,
  accountId: string,
): Promise<CalendarEntry[]> {
  await ensureFreshToken(config, accountId);
  const cal = getCalendarClient(config, accountId);
  const res = await cal.calendarList.list();
  const items = res.data.items ?? [];
  return items.map((c) => ({
    id: c.id ?? "",
    summary: c.summary ?? "",
    description: c.description ?? undefined,
    primary: c.primary ?? false,
    timeZone: c.timeZone ?? undefined,
    accessRole: c.accessRole ?? "",
  }));
}

export async function listEvents(
  config: OAuthConfig,
  accountId: string,
  opts: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    query?: string;
    maxResults?: number;
    singleEvents?: boolean;
    orderBy?: string;
  },
): Promise<CalendarEvent[]> {
  await ensureFreshToken(config, accountId);
  const cal = getCalendarClient(config, accountId);

  const res = await cal.events.list({
    calendarId: opts.calendarId ?? "primary",
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    q: opts.query,
    maxResults: opts.maxResults ?? 50,
    singleEvents: opts.singleEvents ?? true,
    orderBy: opts.orderBy ?? "startTime",
  });

  const items = res.data.items ?? [];
  return items.map(parseEvent);
}

export async function createEvent(
  config: OAuthConfig,
  accountId: string,
  opts: {
    calendarId?: string;
    summary: string;
    description?: string;
    location?: string;
    startDateTime?: string;
    endDateTime?: string;
    startDate?: string;
    endDate?: string;
    timeZone?: string;
    attendees?: string[];
    recurrence?: string[];
    addMeetLink?: boolean;
  },
): Promise<CalendarEvent> {
  await ensureFreshToken(config, accountId);
  const cal = getCalendarClient(config, accountId);

  const isAllDay = Boolean(opts.startDate);

  const eventBody: calendar_v3.Schema$Event = {
    summary: opts.summary,
    description: opts.description,
    location: opts.location,
    start: isAllDay
      ? { date: opts.startDate }
      : { dateTime: opts.startDateTime, timeZone: opts.timeZone },
    end: isAllDay
      ? { date: opts.endDate ?? opts.startDate }
      : { dateTime: opts.endDateTime, timeZone: opts.timeZone },
    attendees: opts.attendees?.map((email) => ({ email })),
    recurrence: opts.recurrence,
  };

  if (opts.addMeetLink) {
    eventBody.conferenceData = {
      createRequest: {
        requestId: `openclaw-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const res = await cal.events.insert({
    calendarId: opts.calendarId ?? "primary",
    requestBody: eventBody,
    conferenceDataVersion: opts.addMeetLink ? 1 : undefined,
  });

  return parseEvent(res.data);
}

export async function updateEvent(
  config: OAuthConfig,
  accountId: string,
  eventId: string,
  opts: {
    calendarId?: string;
    summary?: string;
    description?: string;
    location?: string;
    startDateTime?: string;
    endDateTime?: string;
    startDate?: string;
    endDate?: string;
    timeZone?: string;
    attendees?: string[];
    addMeetLink?: boolean;
  },
): Promise<CalendarEvent> {
  await ensureFreshToken(config, accountId);
  const cal = getCalendarClient(config, accountId);

  const patch: calendar_v3.Schema$Event = {};
  if (opts.summary !== undefined) patch.summary = opts.summary;
  if (opts.description !== undefined) patch.description = opts.description;
  if (opts.location !== undefined) patch.location = opts.location;
  if (opts.startDate) {
    patch.start = { date: opts.startDate };
    patch.end = { date: opts.endDate ?? opts.startDate };
  } else if (opts.startDateTime) {
    patch.start = { dateTime: opts.startDateTime, timeZone: opts.timeZone };
    if (opts.endDateTime) {
      patch.end = { dateTime: opts.endDateTime, timeZone: opts.timeZone };
    }
  }
  if (opts.attendees) {
    patch.attendees = opts.attendees.map((email) => ({ email }));
  }
  if (opts.addMeetLink) {
    patch.conferenceData = {
      createRequest: {
        requestId: `openclaw-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const res = await cal.events.patch({
    calendarId: opts.calendarId ?? "primary",
    eventId,
    requestBody: patch,
    conferenceDataVersion: opts.addMeetLink ? 1 : undefined,
  });

  return parseEvent(res.data);
}

export async function deleteEvent(
  config: OAuthConfig,
  accountId: string,
  eventId: string,
  calendarId?: string,
): Promise<void> {
  await ensureFreshToken(config, accountId);
  const cal = getCalendarClient(config, accountId);
  await cal.events.delete({
    calendarId: calendarId ?? "primary",
    eventId,
  });
}

export async function quickAddEvent(
  config: OAuthConfig,
  accountId: string,
  text: string,
  calendarId?: string,
): Promise<CalendarEvent> {
  await ensureFreshToken(config, accountId);
  const cal = getCalendarClient(config, accountId);
  const res = await cal.events.quickAdd({
    calendarId: calendarId ?? "primary",
    text,
  });
  return parseEvent(res.data);
}

export async function getCalendarStatus(
  config: OAuthConfig,
  accountId: string,
): Promise<{ email: string; calendarCount: number; primaryTimezone: string }> {
  await ensureFreshToken(config, accountId);
  const calendars = await listCalendars(config, accountId);
  const primary = calendars.find((c) => c.primary);
  return {
    email: primary?.summary ?? accountId,
    calendarCount: calendars.length,
    primaryTimezone: primary?.timeZone ?? "unknown",
  };
}
