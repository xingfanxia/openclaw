import fs from "node:fs";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { hasInterSessionUserProvenance } from "../../sessions/input-provenance.js";

const log = createSubsystemLogger("session-seed");

const DEFAULT_CARRY_OVER = 50;

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
 * Write a seed context block into a new session file as a user message.
 * The seed is wrapped in markers so the agent knows it's carried-over context.
 */
export function writeSeedContext(
  newSessionFilePath: string,
  formattedMessages: string,
  count: number,
): void {
  const seedText =
    `[Previous session context — last ${count} messages]\n\n` +
    `${formattedMessages}\n\n` +
    `[End of previous session context. Continue the conversation naturally.]`;

  const entry = {
    type: "message",
    message: {
      role: "user",
      content: seedText,
    },
    provenance: "session-seed",
  };

  fs.appendFileSync(newSessionFilePath, `${JSON.stringify(entry)}\n`, "utf-8");
}

/**
 * Seed a new session file with recent chat messages from the old session.
 */
export function seedSessionFromPrevious(params: {
  oldSessionFile: string;
  newSessionFile: string;
  messageCount?: number;
}): void {
  const count = params.messageCount ?? DEFAULT_CARRY_OVER;
  if (count <= 0) {
    return;
  }
  if (!params.oldSessionFile || !fs.existsSync(params.oldSessionFile)) {
    log.warn("old session file not found, skipping seed");
    return;
  }
  if (!params.newSessionFile) {
    log.warn("new session file not specified, skipping seed");
    return;
  }

  const formatted = readRecentChatMessages(params.oldSessionFile, count);
  if (!formatted) {
    log.warn("no messages to carry over");
    return;
  }

  writeSeedContext(params.newSessionFile, formatted, count);
  log.info(
    `seeded new session with recent chat (up to ${count} messages): ${params.newSessionFile}`,
  );
}
