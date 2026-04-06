import fs from "node:fs";

/**
 * Read recent chat messages from a session transcript JSONL file.
 * Returns a formatted string with "User:" and "Assistant:" prefixes,
 * or null if no messages found.
 */
export function readRecentChatMessages(filePath: string, count: number): string | null {
  if (count <= 0) {
    return null;
  }
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n").filter((line) => line.trim());
  const chatMessages: Array<{ role: string; text: string }> = [];

  for (const line of lines) {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (record.type !== "message") {
      continue;
    }
    const message = record.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") {
      continue;
    }
    const role = message.role as string | undefined;
    if (role !== "user" && role !== "assistant") {
      continue;
    }

    let text: string | undefined;
    const rawContent = message.content;
    if (typeof rawContent === "string") {
      text = rawContent;
    } else if (Array.isArray(rawContent)) {
      // Extract text from content blocks
      const textParts: string[] = [];
      for (const block of rawContent) {
        if (
          block &&
          typeof block === "object" &&
          block.type === "text" &&
          typeof block.text === "string"
        ) {
          textParts.push(block.text);
        }
      }
      text = textParts.join("\n");
    }

    if (!text?.trim()) {
      continue;
    }

    // Skip slash commands
    if (role === "user" && text.trim().startsWith("/")) {
      continue;
    }

    const label = role === "user" ? "User" : "Assistant";
    chatMessages.push({ role, text: `${label}: ${text.trim()}` });
  }

  if (chatMessages.length === 0) {
    return null;
  }

  // Take only the last `count` messages
  const recent = chatMessages.slice(-count);
  return recent.map((m) => m.text).join("\n");
}

/**
 * Build a seed context prefix from a previous session transcript.
 * Returns a formatted string to prepend to the first message in a new session,
 * or null if no usable content found.
 */
export function buildSeedContextPrefix(params: {
  oldSessionFile: string;
  messageCount: number;
}): string | null {
  const chatHistory = readRecentChatMessages(params.oldSessionFile, params.messageCount);
  if (!chatHistory) {
    return null;
  }

  return [
    `[Previous session context -- last ${params.messageCount} messages]`,
    chatHistory,
    "[End of previous session context]",
  ].join("\n");
}
