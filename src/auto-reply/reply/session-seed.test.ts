import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSeedContextPrefix, readRecentChatMessages } from "./session-seed.js";

describe("session-seed", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-seed-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeJsonl(filePath: string, entries: unknown[]): void {
    const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    fs.writeFileSync(filePath, content, "utf-8");
  }

  function makeMessage(role: string, text: string, extra?: Record<string, unknown>) {
    return {
      type: "message",
      message: { role, content: text, ...extra },
    };
  }

  describe("readRecentChatMessages", () => {
    it("extracts user and assistant text messages", () => {
      const file = path.join(tmpDir, "session.jsonl");
      writeJsonl(file, [
        { type: "session", id: "test-id" },
        makeMessage("user", "Hello there"),
        makeMessage("assistant", "Hi! How can I help?"),
        makeMessage("user", "What's the weather?"),
        makeMessage("assistant", "It's sunny today."),
      ]);

      const result = readRecentChatMessages(file, 10);
      expect(result).toContain("User: Hello there");
      expect(result).toContain("Assistant: Hi! How can I help?");
      expect(result).toContain("User: What's the weather?");
      expect(result).toContain("Assistant: It's sunny today.");
    });

    it("respects the count limit", () => {
      const file = path.join(tmpDir, "session.jsonl");
      writeJsonl(file, [
        { type: "session", id: "test-id" },
        makeMessage("user", "Message 1"),
        makeMessage("assistant", "Reply 1"),
        makeMessage("user", "Message 2"),
        makeMessage("assistant", "Reply 2"),
        makeMessage("user", "Message 3"),
        makeMessage("assistant", "Reply 3"),
      ]);

      const result = readRecentChatMessages(file, 2);
      expect(result).not.toContain("Message 1");
      expect(result).not.toContain("Reply 1");
      expect(result).toContain("User: Message 3");
      expect(result).toContain("Assistant: Reply 3");
    });

    it("skips tool role messages", () => {
      const file = path.join(tmpDir, "session.jsonl");
      writeJsonl(file, [
        { type: "session", id: "test-id" },
        makeMessage("user", "Do something"),
        makeMessage("assistant", "Sure, let me use a tool"),
        { type: "message", message: { role: "tool", content: "tool result" } },
        makeMessage("assistant", "Done!"),
      ]);

      const result = readRecentChatMessages(file, 10);
      expect(result).not.toContain("tool result");
      expect(result).toContain("User: Do something");
      expect(result).toContain("Assistant: Done!");
    });

    it("skips slash commands", () => {
      const file = path.join(tmpDir, "session.jsonl");
      writeJsonl(file, [
        { type: "session", id: "test-id" },
        makeMessage("user", "/reset"),
        makeMessage("user", "Real message"),
        makeMessage("assistant", "Got it"),
      ]);

      const result = readRecentChatMessages(file, 10);
      expect(result).not.toContain("/reset");
      expect(result).toContain("User: Real message");
    });

    it("handles array content format", () => {
      const file = path.join(tmpDir, "session.jsonl");
      writeJsonl(file, [
        { type: "session", id: "test-id" },
        {
          type: "message",
          message: {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "data:image/png;base64,..." } },
              { type: "text", text: "What is this?" },
            ],
          },
        },
        makeMessage("assistant", "It's a picture"),
      ]);

      const result = readRecentChatMessages(file, 10);
      expect(result).toContain("User: What is this?");
      expect(result).not.toContain("base64");
    });

    it("returns null for empty session", () => {
      const file = path.join(tmpDir, "session.jsonl");
      writeJsonl(file, [{ type: "session", id: "test-id" }]);

      const result = readRecentChatMessages(file, 10);
      expect(result).toBeNull();
    });

    it("returns null for count of 0", () => {
      const file = path.join(tmpDir, "session.jsonl");
      writeJsonl(file, [makeMessage("user", "Hello")]);

      const result = readRecentChatMessages(file, 0);
      expect(result).toBeNull();
    });

    it("returns null for missing file", () => {
      const result = readRecentChatMessages("/nonexistent/path.jsonl", 10);
      expect(result).toBeNull();
    });
  });

  describe("buildSeedContextPrefix", () => {
    it("returns formatted string with seed markers for valid session", () => {
      const file = path.join(tmpDir, "old.jsonl");
      writeJsonl(file, [
        { type: "session", id: "old-id" },
        makeMessage("user", "What's your name?"),
        makeMessage("assistant", "I'm an AI assistant."),
        makeMessage("user", "Tell me a joke"),
        makeMessage("assistant", "Why did the chicken cross the road?"),
      ]);

      const result = buildSeedContextPrefix({
        oldSessionFile: file,
        messageCount: 50,
      });

      expect(result).not.toBeNull();
      expect(result).toContain("[Previous session context — last 50 messages]");
      expect(result).toContain("User: What's your name?");
      expect(result).toContain("Assistant: I'm an AI assistant.");
      expect(result).toContain("User: Tell me a joke");
      expect(result).toContain("Assistant: Why did the chicken cross the road?");
      expect(result).toContain(
        "[End of previous session context. Continue the conversation naturally.]",
      );
    });

    it("returns null when count is 0", () => {
      const file = path.join(tmpDir, "old.jsonl");
      writeJsonl(file, [makeMessage("user", "Hello")]);

      const result = buildSeedContextPrefix({
        oldSessionFile: file,
        messageCount: 0,
      });

      expect(result).toBeNull();
    });

    it("returns null when old file doesn't exist", () => {
      const result = buildSeedContextPrefix({
        oldSessionFile: "/nonexistent.jsonl",
        messageCount: 50,
      });

      expect(result).toBeNull();
    });

    it("returns null when session has no chat messages", () => {
      const file = path.join(tmpDir, "empty.jsonl");
      writeJsonl(file, [{ type: "session", id: "empty-id" }]);

      const result = buildSeedContextPrefix({
        oldSessionFile: file,
        messageCount: 50,
      });

      expect(result).toBeNull();
    });
  });
});
