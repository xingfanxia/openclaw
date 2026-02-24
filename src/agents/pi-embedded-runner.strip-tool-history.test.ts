import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  getDmStripToolHistoryFromSessionKey,
  stripToolHistoryFromMessages,
} from "./pi-embedded-runner/history.js";

function userMsg(text: string, ts = 0): AgentMessage {
  return { role: "user", content: text, timestamp: ts } as AgentMessage;
}

function assistantTextMsg(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test",
    usage: { inputTokens: 0, outputTokens: 0 },
    timestamp: 0,
  } as unknown as AgentMessage;
}

function assistantWithToolCall(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [
      { type: "text", text },
      { type: "toolCall", id: "tc-1", name: "web_search", args: '{"q":"test"}' },
    ],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test",
    usage: { inputTokens: 0, outputTokens: 0 },
    timestamp: 0,
  } as unknown as AgentMessage;
}

function assistantOnlyToolCall(): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: "tc-2", name: "calendar", args: "{}" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test",
    usage: { inputTokens: 0, outputTokens: 0 },
    timestamp: 0,
  } as unknown as AgentMessage;
}

function assistantWithThinking(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "hmm let me think" },
      { type: "text", text },
    ],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test",
    usage: { inputTokens: 0, outputTokens: 0 },
    timestamp: 0,
  } as unknown as AgentMessage;
}

function toolResultMsg(toolCallId: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "web_search",
    content: [{ type: "text", text: "result data" }],
    isError: false,
    timestamp: 0,
  } as unknown as AgentMessage;
}

describe("stripToolHistoryFromMessages", () => {
  it("removes toolResult messages", () => {
    const messages: AgentMessage[] = [
      userMsg("hello"),
      assistantWithToolCall("searching..."),
      toolResultMsg("tc-1"),
      assistantTextMsg("here you go"),
    ];

    const result = stripToolHistoryFromMessages(messages);

    expect(result).toHaveLength(3);
    expect(result.every((m) => m.role !== "toolResult")).toBe(true);
  });

  it("strips toolCall blocks from assistant messages, keeps text", () => {
    const messages: AgentMessage[] = [assistantWithToolCall("searching...")];

    const result = stripToolHistoryFromMessages(messages);

    expect(result).toHaveLength(1);
    const content = (result[0] as { content: Array<{ type: string }> }).content;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
  });

  it("inserts synthetic text when assistant becomes empty after stripping", () => {
    const messages: AgentMessage[] = [assistantOnlyToolCall()];

    const result = stripToolHistoryFromMessages(messages);

    expect(result).toHaveLength(1);
    const content = (result[0] as { content: Array<{ type: string; text: string }> }).content;
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({ type: "text", text: "" });
  });

  it("strips thinking blocks", () => {
    const messages: AgentMessage[] = [assistantWithThinking("answer")];

    const result = stripToolHistoryFromMessages(messages);

    expect(result).toHaveLength(1);
    const content = (result[0] as { content: Array<{ type: string }> }).content;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
  });

  it("returns original reference when nothing changed", () => {
    const messages: AgentMessage[] = [userMsg("hello"), assistantTextMsg("hi there")];

    const result = stripToolHistoryFromMessages(messages);

    expect(result).toBe(messages);
  });

  it("preserves user messages unchanged", () => {
    const messages: AgentMessage[] = [
      userMsg("hello"),
      assistantWithToolCall("let me check"),
      toolResultMsg("tc-1"),
      userMsg("thanks"),
      assistantTextMsg("no problem"),
    ];

    const result = stripToolHistoryFromMessages(messages);

    expect(result).toHaveLength(4);
    expect(result[0]).toBe(messages[0]);
    expect(result[2]).toBe(messages[3]);
    expect(result[3]).toBe(messages[4]);
  });
});

describe("getDmStripToolHistoryFromSessionKey", () => {
  const makeConfig = (channels: Record<string, unknown>): OpenClawConfig =>
    ({ channels }) as unknown as OpenClawConfig;

  it("returns true for DM session when config is enabled", () => {
    const config = makeConfig({ telegram: { dmStripToolHistory: true } });

    expect(getDmStripToolHistoryFromSessionKey("telegram:dm:12345", config)).toBe(true);
  });

  it("returns false for DM session when config is not set", () => {
    const config = makeConfig({ telegram: {} });

    expect(getDmStripToolHistoryFromSessionKey("telegram:dm:12345", config)).toBe(false);
  });

  it("returns false for channel/group sessions even when config is enabled", () => {
    const config = makeConfig({ telegram: { dmStripToolHistory: true } });

    expect(getDmStripToolHistoryFromSessionKey("telegram:channel:general", config)).toBe(false);
    expect(getDmStripToolHistoryFromSessionKey("telegram:group:mygroup", config)).toBe(false);
  });

  it("returns false when sessionKey is undefined", () => {
    const config = makeConfig({ telegram: { dmStripToolHistory: true } });

    expect(getDmStripToolHistoryFromSessionKey(undefined, config)).toBe(false);
  });

  it("returns false when config is undefined", () => {
    expect(getDmStripToolHistoryFromSessionKey("telegram:dm:12345", undefined)).toBe(false);
  });

  it("handles agent-prefixed session keys", () => {
    const config = makeConfig({ telegram: { dmStripToolHistory: true } });

    expect(getDmStripToolHistoryFromSessionKey("agent:main:telegram:dm:12345", config)).toBe(true);
  });

  it("supports 'direct' kind alias", () => {
    const config = makeConfig({ telegram: { dmStripToolHistory: true } });

    expect(getDmStripToolHistoryFromSessionKey("telegram:direct:12345", config)).toBe(true);
  });
});
