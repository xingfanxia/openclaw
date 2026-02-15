import type { MessagingToolSend } from "../../agents/pi-embedded-runner.js";
import type { ReplyToMode } from "../../config/types.js";
import type { OriginatingChannelType } from "../templating.js";
import type { ReplyPayload } from "../types.js";
import { isMessagingToolDuplicate } from "../../agents/pi-embedded-helpers.js";
import { normalizeTargetForProvider } from "../../infra/outbound/target-normalization.js";
import { extractReplyToTag } from "./reply-tags.js";
import { createReplyToModeFilterForChannel } from "./reply-threading.js";

export function applyReplyTagsToPayload(
  payload: ReplyPayload,
  currentMessageId?: string,
): ReplyPayload {
  if (typeof payload.text !== "string") {
    if (!payload.replyToCurrent || payload.replyToId) {
      return payload;
    }
    return {
      ...payload,
      replyToId: currentMessageId?.trim() || undefined,
    };
  }
  const shouldParseTags = payload.text.includes("[[");
  if (!shouldParseTags) {
    if (!payload.replyToCurrent || payload.replyToId) {
      return payload;
    }
    return {
      ...payload,
      replyToId: currentMessageId?.trim() || undefined,
      replyToTag: payload.replyToTag ?? true,
    };
  }
  const { cleaned, replyToId, replyToCurrent, hasTag } = extractReplyToTag(
    payload.text,
    currentMessageId,
  );
  return {
    ...payload,
    text: cleaned ? cleaned : undefined,
    replyToId: replyToId ?? payload.replyToId,
    replyToTag: hasTag || payload.replyToTag,
    replyToCurrent: replyToCurrent || payload.replyToCurrent,
  };
}

export function isRenderablePayload(payload: ReplyPayload): boolean {
  return Boolean(
    payload.text ||
    payload.mediaUrl ||
    (payload.mediaUrls && payload.mediaUrls.length > 0) ||
    payload.audioAsVoice ||
    payload.channelData,
  );
}

export function applyReplyThreading(params: {
  payloads: ReplyPayload[];
  replyToMode: ReplyToMode;
  replyToChannel?: OriginatingChannelType;
  currentMessageId?: string;
}): ReplyPayload[] {
  const { payloads, replyToMode, replyToChannel, currentMessageId } = params;
  const applyReplyToMode = createReplyToModeFilterForChannel(replyToMode, replyToChannel);
  return payloads
    .map((payload) => applyReplyTagsToPayload(payload, currentMessageId))
    .filter(isRenderablePayload)
    .map(applyReplyToMode);
}

export function filterMessagingToolDuplicates(params: {
  payloads: ReplyPayload[];
  sentTexts: string[];
}): ReplyPayload[] {
  const { payloads, sentTexts } = params;
  if (sentTexts.length === 0) {
    return payloads;
  }
  return payloads.filter((payload) => !isMessagingToolDuplicate(payload.text ?? "", sentTexts));
}

const MESSAGING_TOOL_ACK_TEXTS = new Set([
  "ok",
  "okay",
  "kk",
  "k",
  "got it",
  "roger",
  "done",
  "sent",
  "message sent",
  "收到",
  "已收到",
  "好的",
  "好",
  "行",
  "明白",
  "知道了",
]);

function normalizeAckText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[\s"'`([{<]+/, "")
    .replace(/[\s"'`)\]}>.!?,;:~。！？、…]+$/g, "");
}

function isMessagingToolAckOnlyPayload(payload: ReplyPayload): boolean {
  if (
    payload.mediaUrl ||
    (payload.mediaUrls && payload.mediaUrls.length > 0) ||
    payload.channelData
  ) {
    return false;
  }
  if (payload.audioAsVoice) {
    return false;
  }
  const text = payload.text?.trim();
  if (!text) {
    return false;
  }
  const normalized = normalizeAckText(text);
  if (!normalized) {
    return false;
  }
  return MESSAGING_TOOL_ACK_TEXTS.has(normalized);
}

export function filterMessagingToolAckPayloads(params: {
  payloads: ReplyPayload[];
  didSendViaMessagingTool: boolean;
}): ReplyPayload[] {
  const { payloads, didSendViaMessagingTool } = params;
  if (!didSendViaMessagingTool || payloads.length === 0) {
    return payloads;
  }
  return payloads.filter((payload) => !isMessagingToolAckOnlyPayload(payload));
}

function normalizeAccountId(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

export function shouldSuppressMessagingToolReplies(params: {
  messageProvider?: string;
  messagingToolSentTargets?: MessagingToolSend[];
  originatingTo?: string;
  accountId?: string;
}): boolean {
  const provider = params.messageProvider?.trim().toLowerCase();
  if (!provider) {
    return false;
  }
  const originTarget = normalizeTargetForProvider(provider, params.originatingTo);
  if (!originTarget) {
    return false;
  }
  const originAccount = normalizeAccountId(params.accountId);
  const sentTargets = params.messagingToolSentTargets ?? [];
  if (sentTargets.length === 0) {
    return false;
  }
  return sentTargets.some((target) => {
    if (!target?.provider) {
      return false;
    }
    if (target.provider.trim().toLowerCase() !== provider) {
      return false;
    }
    const targetKey = normalizeTargetForProvider(provider, target.to);
    if (!targetKey) {
      return false;
    }
    const targetAccount = normalizeAccountId(target.accountId);
    if (originAccount && targetAccount && originAccount !== targetAccount) {
      return false;
    }
    return targetKey === originTarget;
  });
}
