import fs from "node:fs";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { hasInterSessionUserProvenance } from "../../sessions/input-provenance.js";

const log = createSubsystemLogger("session-seed");

/**
 * Read recent user/assistant text messages from a session JSONL transcript.
 * Skips tool calls, tool results, thinking blocks, images, and inter-session
 * provenance messages. Returns a formatted string with the last `count` entries.
 */
export function readRecentChatMessages(sessionFilePath: string, count: number): string | null {
  if (count <= 0) {
    return null;
  }
  try {
    const content = fs.readFileSync(sessionFilePath, "utf-8");
    const lines = content.trim().split("\n");

    const messages: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "message" || !entry.message) {
          continue;
        }
        const msg = entry.message;
        const role = msg.role;
        if (role !== "user" && role !== "assistant") {
          continue;
        }
        if (!msg.content) {
          continue;
        }
        // Skip inter-session provenance (system-injected context)
        if (role === "user" && hasInterSessionUserProvenance(msg)) {
          continue;
        }
        // Extract text content only
        let text: string | undefined;
        if (typeof msg.content === "string") {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          // oxlint-disable-next-line typescript/no-explicit-any
          const textBlock = msg.content.find((c: any) => c.type === "text");
          text = textBlock?.text;
        }
        if (!text?.trim()) {
          continue;
        }
        // Skip slash commands — they are session control, not conversation
        if (text.startsWith("/")) {
          continue;
        }
        const label = role === "user" ? "User" : "Assistant";
        messages.push(`${label}: ${text}`);
      } catch {
        // Skip invalid JSON lines
      }
    }

    const recent = messages.slice(-count);
    if (recent.length === 0) {
      return null;
    }
    return recent.join("\n\n");
  } catch (err) {
    log.warn(`failed to read session transcript: ${String(err)}`);
    return null;
  }
}

/**
 * Build a seed context prefix string from the old session's recent chat messages.
 * Returns null if no messages are available or the old session file is missing.
 */
export function buildSeedContextPrefix(params: {
  oldSessionFile: string;
  messageCount: number;
}): string | null {
  const count = params.messageCount;
  if (count <= 0) {
    return null;
  }
  if (!params.oldSessionFile || !fs.existsSync(params.oldSessionFile)) {
    log.warn("old session file not found, skipping seed");
    return null;
  }
  const formatted = readRecentChatMessages(params.oldSessionFile, count);
  if (!formatted) {
    log.warn("no messages to carry over");
    return null;
  }
  return (
    `[Previous session context — last ${count} messages]\n\n` +
    `${formatted}\n\n` +
    `[End of previous session context. Continue the conversation naturally.]`
  );
}
