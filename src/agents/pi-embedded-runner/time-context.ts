import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { formatZonedTimestamp } from "../../infra/format-time/format-datetime.ts";

/**
 * Format a millisecond duration as a compact human-readable elapsed string.
 * Examples: "2m", "1h 15m", "3h", "1d 2h"
 */
export function formatElapsed(ms: number): string {
  if (ms < 0) {
    return "0m";
  }
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) {
    return "<1m";
  }
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/**
 * Matches the envelope timestamp pattern at the start of a message.
 * Examples:
 *   [Mon 2026-02-23 21:47 PST | Telegram DM from AX]
 *   [Mon 2026-02-23 21:47 PST]
 */
const ENVELOPE_TIMESTAMP_RE =
  /^\[([A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? [A-Z]{2,5})(.*?)\]/;

/**
 * Annotate an envelope timestamp with an elapsed-time suffix.
 * `[Mon 2026-02-23 21:47 PST | Telegram DM from AX] hi`
 * → `[Mon 2026-02-23 21:47 PST (37m ago) | Telegram DM from AX] hi`
 */
function annotateEnvelopeWithElapsed(text: string, nowMs: number): string {
  const match = text.match(ENVELOPE_TIMESTAMP_RE);
  if (!match) {
    return text;
  }
  const timestampPart = match[1]; // "Mon 2026-02-23 21:47 PST"
  const rest = match[2]; // " | Telegram DM from AX" or ""
  // Parse the timestamp: strip day-of-week prefix, parse the rest
  const dateStr = timestampPart.replace(/^[A-Za-z]{3} /, ""); // "2026-02-23 21:47 PST"
  // Extract YYYY-MM-DD HH:MM and timezone abbreviation
  const parts = dateStr.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::\d{2})? ([A-Z]{2,5})$/);
  if (!parts) {
    return text;
  }
  // Parse as ISO with timezone guess — timezone abbreviations are ambiguous,
  // but for elapsed-time annotation, being off by a few minutes is acceptable.
  const isoStr = `${parts[1]}T${parts[2]}:00`;
  const parsed = new Date(isoStr);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }
  // Estimate UTC offset from the timezone abbreviation.
  const msgMs = estimateTimestampMs(parsed, parts[3]);
  const elapsed = formatElapsed(nowMs - msgMs);
  // Insert the elapsed annotation after the timestamp part.
  return text.replace(ENVELOPE_TIMESTAMP_RE, `[${timestampPart} (${elapsed} ago)${rest}]`);
}

/**
 * Estimate the UTC timestamp from a local Date and timezone abbreviation.
 * Uses common US/UTC abbreviations. Falls back to treating the Date as UTC.
 */
function estimateTimestampMs(localDate: Date, tzAbbrev: string): number {
  // Common timezone offsets in hours from UTC
  const offsets: Record<string, number> = {
    PST: -8,
    PDT: -7,
    MST: -7,
    MDT: -6,
    CST: -6,
    CDT: -5,
    EST: -5,
    EDT: -4,
    UTC: 0,
    GMT: 0,
    CET: 1,
    CEST: 2,
    JST: 9,
    CST_CN: 8, // Chinese Standard Time
  };
  const offset = offsets[tzAbbrev];
  if (offset !== undefined) {
    // localDate was parsed as UTC, but it's actually local time.
    // Subtract the offset to get UTC.
    return localDate.getTime() - offset * 3600_000;
  }
  return localDate.getTime();
}

type TextContent = { type: "text"; text: string };

function getMessageText(msg: AgentMessage): string | undefined {
  if (msg.role === "user") {
    if (typeof msg.content === "string") {
      return msg.content;
    }
    if (Array.isArray(msg.content)) {
      const firstText = msg.content.find(
        (b): b is TextContent =>
          !!b && typeof b === "object" && (b as { type?: string }).type === "text",
      );
      return firstText?.text;
    }
  }
  return undefined;
}

function setMessageText(msg: AgentMessage, original: string, updated: string): AgentMessage {
  if (msg.role !== "user") {
    return msg;
  }
  if (typeof msg.content === "string") {
    return { ...msg, content: updated };
  }
  if (Array.isArray(msg.content)) {
    const newContent = msg.content.map((block) => {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "text" &&
        (block as TextContent).text === original
      ) {
        return { ...block, text: updated };
      }
      return block;
    });
    return { ...msg, content: newContent };
  }
  return msg;
}

/**
 * Inject time-elapsed annotations into message history so the LLM can
 * reason about time without doing arithmetic.
 *
 * For each user message with an envelope timestamp, appends `(Xm ago)`.
 * For the latest user message, also prepends a `[Now: ...]` header if
 * it doesn't already have a "Current time:" line (heartbeat prompts have one).
 *
 * Returns original array reference if nothing changed.
 */
export function injectTimeContext(
  messages: AgentMessage[],
  nowMs: number,
  timezone: string,
): AgentMessage[] {
  if (messages.length === 0) {
    return messages;
  }

  let touched = false;
  const out: AgentMessage[] = [];

  // Find the index of the last user message
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Only annotate user messages
    if (msg.role !== "user") {
      out.push(msg);
      continue;
    }

    const text = getMessageText(msg);
    if (!text) {
      out.push(msg);
      continue;
    }

    let updated = text;

    // Annotate envelope timestamps with elapsed time
    if (ENVELOPE_TIMESTAMP_RE.test(updated)) {
      updated = annotateEnvelopeWithElapsed(updated, nowMs);
    }

    // For the latest user message, prepend current time if not already present
    if (i === lastUserIdx && !updated.includes("Current time:")) {
      const formatted = formatZonedTimestamp(new Date(nowMs), { timeZone: timezone });
      if (formatted) {
        const dow = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          weekday: "short",
        }).format(new Date(nowMs));
        updated = `[Now: ${dow} ${formatted}]\n${updated}`;
      }
    }

    if (updated !== text) {
      touched = true;
      out.push(setMessageText(msg, text, updated));
    } else {
      out.push(msg);
    }
  }

  return touched ? out : messages;
}
