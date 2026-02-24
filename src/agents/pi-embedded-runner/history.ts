import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { OpenClawConfig } from "../../config/config.js";

const THREAD_SUFFIX_REGEX = /^(.*)(?::(?:thread|topic):\d+)$/i;

function stripThreadSuffix(value: string): string {
  const match = value.match(THREAD_SUFFIX_REGEX);
  return match?.[1] ?? value;
}

/**
 * Limits conversation history to the last N user turns (and their associated
 * assistant responses). This reduces token usage for long-running DM sessions.
 */
export function limitHistoryTurns(
  messages: AgentMessage[],
  limit: number | undefined,
): AgentMessage[] {
  if (!limit || limit <= 0 || messages.length === 0) {
    return messages;
  }

  let userCount = 0;
  let lastUserIndex = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userCount++;
      if (userCount > limit) {
        return messages.slice(lastUserIndex);
      }
      lastUserIndex = i;
    }
  }
  return messages;
}

/**
 * Extract provider + user ID from a session key and look up dmHistoryLimit.
 * Supports per-DM overrides and provider defaults.
 * For channel/group sessions, uses historyLimit from provider config.
 */
export function getHistoryLimitFromSessionKey(
  sessionKey: string | undefined,
  config: OpenClawConfig | undefined,
): number | undefined {
  if (!sessionKey || !config) {
    return undefined;
  }

  const parts = sessionKey.split(":").filter(Boolean);
  const providerParts = parts.length >= 3 && parts[0] === "agent" ? parts.slice(2) : parts;

  const provider = providerParts[0]?.toLowerCase();
  if (!provider) {
    return undefined;
  }

  const kind = providerParts[1]?.toLowerCase();
  const userIdRaw = providerParts.slice(2).join(":");
  const userId = stripThreadSuffix(userIdRaw);

  const resolveProviderConfig = (
    cfg: OpenClawConfig | undefined,
    providerId: string,
  ):
    | {
        historyLimit?: number;
        dmHistoryLimit?: number;
        dms?: Record<string, { historyLimit?: number }>;
      }
    | undefined => {
    const channels = cfg?.channels;
    if (!channels || typeof channels !== "object") {
      return undefined;
    }
    const entry = (channels as Record<string, unknown>)[providerId];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    return entry as {
      historyLimit?: number;
      dmHistoryLimit?: number;
      dms?: Record<string, { historyLimit?: number }>;
    };
  };

  const providerConfig = resolveProviderConfig(config, provider);
  if (!providerConfig) {
    return undefined;
  }

  // For DM sessions: per-DM override -> dmHistoryLimit.
  // Accept both "direct" (new) and "dm" (legacy) for backward compat.
  if (kind === "dm" || kind === "direct") {
    if (userId && providerConfig.dms?.[userId]?.historyLimit !== undefined) {
      return providerConfig.dms[userId].historyLimit;
    }
    return providerConfig.dmHistoryLimit;
  }

  // For channel/group sessions: use historyLimit from provider config
  // This prevents context overflow in long-running channel sessions
  if (kind === "channel" || kind === "group") {
    return providerConfig.historyLimit;
  }

  return undefined;
}

/**
 * @deprecated Use getHistoryLimitFromSessionKey instead.
 * Alias for backward compatibility.
 */
export const getDmHistoryLimitFromSessionKey = getHistoryLimitFromSessionKey;

type AssistantContentBlock = Extract<AgentMessage, { role: "assistant" }>["content"][number];

/**
 * Check whether dmStripToolHistory is enabled for the given session key.
 * Only applies to DM sessions (kind === "dm" or "direct").
 */
export function getDmStripToolHistoryFromSessionKey(
  sessionKey: string | undefined,
  config: OpenClawConfig | undefined,
): boolean {
  if (!sessionKey || !config) {
    return false;
  }

  const parts = sessionKey.split(":").filter(Boolean);
  const providerParts = parts.length >= 3 && parts[0] === "agent" ? parts.slice(2) : parts;

  const provider = providerParts[0]?.toLowerCase();
  if (!provider) {
    return false;
  }

  const kind = providerParts[1]?.toLowerCase();
  if (kind !== "dm" && kind !== "direct") {
    return false;
  }

  const channels = config?.channels;
  if (!channels || typeof channels !== "object") {
    return false;
  }
  const entry = (channels as Record<string, unknown>)[provider];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  return Boolean((entry as { dmStripToolHistory?: boolean }).dmStripToolHistory);
}

/**
 * Strip tool history from messages to reduce token usage in DM sessions.
 *
 * Removes:
 * - All `role: "toolResult"` messages
 * - `toolCall` blocks from assistant message content
 * - `thinking` blocks from assistant message content
 *
 * Keeps:
 * - User messages (unchanged)
 * - `text` blocks in assistant messages
 *
 * When an assistant message has all content stripped, a synthetic
 * `{ type: "text", text: "" }` block is inserted to preserve turn structure.
 *
 * Returns the original array reference when nothing was changed.
 */
export function stripToolHistoryFromMessages(messages: AgentMessage[]): AgentMessage[] {
  let touched = false;
  const out: AgentMessage[] = [];

  for (const msg of messages) {
    // Drop toolResult messages entirely.
    if (msg.role === "toolResult") {
      touched = true;
      continue;
    }

    // Only process assistant messages with content arrays.
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
      out.push(msg);
      continue;
    }

    const nextContent: AssistantContentBlock[] = [];
    let changed = false;
    for (const block of msg.content) {
      if (!block || typeof block !== "object") {
        nextContent.push(block);
        continue;
      }
      const blockType = (block as { type?: unknown }).type;
      if (blockType === "toolCall" || blockType === "thinking") {
        touched = true;
        changed = true;
        continue;
      }
      nextContent.push(block);
    }

    if (!changed) {
      out.push(msg);
      continue;
    }

    // Preserve the assistant turn even if all blocks were stripped.
    const content =
      nextContent.length > 0 ? nextContent : [{ type: "text", text: "" } as AssistantContentBlock];
    out.push({ ...msg, content });
  }

  return touched ? out : messages;
}
