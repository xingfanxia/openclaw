import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import { formatElapsed, injectTimeContext } from "./time-context.js";

function userMsg(text: string, ts = 0): AgentMessage {
  return { role: "user", content: text, timestamp: ts } as AgentMessage;
}

function userMsgWithContent(blocks: Array<{ type: string; text?: string }>, ts = 0): AgentMessage {
  return { role: "user", content: blocks, timestamp: ts } as AgentMessage;
}

function assistantMsg(text: string, ts = 0): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test",
    usage: { inputTokens: 0, outputTokens: 0 },
    timestamp: ts,
  } as unknown as AgentMessage;
}

describe("formatElapsed", () => {
  it("formats sub-minute", () => {
    expect(formatElapsed(20_000)).toBe("<1m");
    expect(formatElapsed(0)).toBe("<1m");
  });

  it("formats minutes", () => {
    expect(formatElapsed(5 * 60_000)).toBe("5m");
    expect(formatElapsed(37 * 60_000)).toBe("37m");
  });

  it("formats hours and minutes", () => {
    expect(formatElapsed(90 * 60_000)).toBe("1h 30m");
    expect(formatElapsed(120 * 60_000)).toBe("2h");
  });

  it("formats days and hours", () => {
    expect(formatElapsed(25 * 3600_000)).toBe("1d 1h");
    expect(formatElapsed(48 * 3600_000)).toBe("2d");
  });

  it("handles negative", () => {
    expect(formatElapsed(-1000)).toBe("0m");
  });
});

describe("injectTimeContext", () => {
  // 2026-02-23 21:47:00 PST = 2026-02-24 05:47:00 UTC
  const msgTimestamp = Date.UTC(2026, 1, 24, 5, 47, 0);
  // 2026-02-23 22:23:00 PST = 2026-02-24 06:23:00 UTC (36 min later)
  const nowMs = Date.UTC(2026, 1, 24, 6, 23, 0);
  const timezone = "America/Los_Angeles";

  it("annotates envelope timestamps with elapsed time", () => {
    const messages: AgentMessage[] = [
      userMsg("[Mon 2026-02-23 21:47 PST | Telegram DM from AX] hello", msgTimestamp),
      assistantMsg("hi there", msgTimestamp + 1000),
    ];

    const result = injectTimeContext(messages, nowMs, timezone);

    expect(result).not.toBe(messages);
    const text = (result[0] as { content: string }).content;
    expect(text).toContain("(36m ago)");
    expect(text).toContain("Telegram DM from AX");
  });

  it("prepends [Now: ...] to the latest user message when no Current time:", () => {
    const messages: AgentMessage[] = [
      userMsg("[Mon 2026-02-23 21:47 PST] earlier msg", msgTimestamp),
      assistantMsg("ok", msgTimestamp + 1000),
      userMsg("[Mon 2026-02-23 22:20 PST] new msg", nowMs - 3 * 60_000),
    ];

    const result = injectTimeContext(messages, nowMs, timezone);

    const lastText = (result[2] as { content: string }).content;
    expect(lastText).toMatch(/^\[Now: /);
    expect(lastText).toContain("2026-02-23 22:23 PST");
  });

  it("does NOT prepend [Now:] when message already has Current time:", () => {
    const messages: AgentMessage[] = [
      userMsg("Read HEARTBEAT.md\nCurrent time: Monday, February 23rd, 2026 — 10:23 PM", nowMs),
    ];

    const result = injectTimeContext(messages, nowMs, timezone);

    // Should return original since no envelope timestamps to annotate and Current time: present
    expect(result).toBe(messages);
  });

  it("returns original reference when no changes needed", () => {
    const messages: AgentMessage[] = [
      userMsg("plain text no envelope", 0),
      assistantMsg("response", 0),
      userMsg("another plain\nCurrent time: already here", 0),
    ];

    const result = injectTimeContext(messages, nowMs, timezone);
    expect(result).toBe(messages);
  });

  it("handles content array messages", () => {
    const messages: AgentMessage[] = [
      userMsgWithContent(
        [{ type: "text", text: "[Mon 2026-02-23 21:47 PST | Telegram DM from AX] photo" }],
        msgTimestamp,
      ),
    ];

    const result = injectTimeContext(messages, nowMs, timezone);

    expect(result).not.toBe(messages);
    const content = (result[0] as { content: Array<{ type: string; text: string }> }).content;
    expect(content[0].text).toContain("(36m ago)");
    // Latest message also gets [Now:] since no "Current time:"
    expect(content[0].text).toMatch(/^\[Now: /);
  });

  it("preserves assistant messages unchanged", () => {
    const messages: AgentMessage[] = [
      userMsg("[Mon 2026-02-23 21:47 PST] hi", msgTimestamp),
      assistantMsg("hello!", msgTimestamp + 1000),
    ];

    const result = injectTimeContext(messages, nowMs, timezone);
    expect(result[1]).toBe(messages[1]);
  });

  it("handles empty message array", () => {
    expect(injectTimeContext([], nowMs, timezone)).toEqual([]);
  });

  it("annotates multiple user messages with different elapsed times", () => {
    const msg1Time = nowMs - 120 * 60_000; // 2 hours ago
    const msg2Time = nowMs - 30 * 60_000; // 30 min ago

    const messages: AgentMessage[] = [
      userMsg("[Mon 2026-02-23 20:23 PST] first", msg1Time),
      assistantMsg("ack", msg1Time + 1000),
      userMsg("[Mon 2026-02-23 21:53 PST] second", msg2Time),
    ];

    const result = injectTimeContext(messages, nowMs, timezone);

    const first = (result[0] as { content: string }).content;
    const second = (result[2] as { content: string }).content;
    expect(first).toContain("(2h ago)");
    expect(second).toContain("(30m ago)");
  });
});
