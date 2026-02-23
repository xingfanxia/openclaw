import { isMessagingToolDuplicate } from "../../agents/pi-embedded-helpers.js";
import type { MessagingToolSend } from "../../agents/pi-embedded-runner.js";
import type { ReplyToMode } from "../../config/types.js";
import { normalizeTargetForProvider } from "../../infra/outbound/target-normalization.js";
import { normalizeOptionalAccountId } from "../../routing/account-id.js";
import type { OriginatingChannelType } from "../templating.js";
import type { ReplyPayload } from "../types.js";
import { extractReplyToTag } from "./reply-tags.js";
import { createReplyToModeFilterForChannel } from "./reply-threading.js";

function resolveReplyThreadingForPayload(params: {
  payload: ReplyPayload;
  implicitReplyToId?: string;
  currentMessageId?: string;
}): ReplyPayload {
  const implicitReplyToId = params.implicitReplyToId?.trim() || undefined;
  const currentMessageId = params.currentMessageId?.trim() || undefined;

  // 1) Apply implicit reply threading first (replyToMode will strip later if needed).
  let resolved: ReplyPayload =
    params.payload.replyToId || params.payload.replyToCurrent === false || !implicitReplyToId
      ? params.payload
      : { ...params.payload, replyToId: implicitReplyToId };

  // 2) Parse explicit reply tags from text (if present) and clean them.
  if (typeof resolved.text === "string" && resolved.text.includes("[[")) {
    const { cleaned, replyToId, replyToCurrent, hasTag } = extractReplyToTag(
      resolved.text,
      currentMessageId,
    );
    resolved = {
      ...resolved,
      text: cleaned ? cleaned : undefined,
      replyToId: replyToId ?? resolved.replyToId,
      replyToTag: hasTag || resolved.replyToTag,
      replyToCurrent: replyToCurrent || resolved.replyToCurrent,
    };
  }

  // 3) If replyToCurrent was set out-of-band (e.g. tags already stripped upstream),
  // ensure replyToId is set to the current message id when available.
  if (resolved.replyToCurrent && !resolved.replyToId && currentMessageId) {
    resolved = {
      ...resolved,
      replyToId: currentMessageId,
    };
  }

  return resolved;
}

// Backward-compatible helper: apply explicit reply tags/directives to a single payload.
// This intentionally does not apply implicit threading.
export function applyReplyTagsToPayload(
  payload: ReplyPayload,
  currentMessageId?: string,
): ReplyPayload {
  return resolveReplyThreadingForPayload({ payload, currentMessageId });
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
  const implicitReplyToId = currentMessageId?.trim() || undefined;
  return payloads
    .map((payload) =>
      resolveReplyThreadingForPayload({ payload, implicitReplyToId, currentMessageId }),
    )
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

export function filterMessagingToolMediaDuplicates(params: {
  payloads: ReplyPayload[];
  sentMediaUrls: string[];
}): ReplyPayload[] {
  const normalizeMediaForDedupe = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    if (!trimmed.toLowerCase().startsWith("file://")) {
      return trimmed;
    }
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "file:") {
        return decodeURIComponent(parsed.pathname || "");
      }
    } catch {
      // Keep fallback below for non-URL-like inputs.
    }
    return trimmed.replace(/^file:\/\//i, "");
  };

  const { payloads, sentMediaUrls } = params;
  if (sentMediaUrls.length === 0) {
    return payloads;
  }
  const sentSet = new Set(sentMediaUrls.map(normalizeMediaForDedupe).filter(Boolean));
  return payloads.map((payload) => {
    const mediaUrl = payload.mediaUrl;
    const mediaUrls = payload.mediaUrls;
    const stripSingle = mediaUrl && sentSet.has(normalizeMediaForDedupe(mediaUrl));
    const filteredUrls = mediaUrls?.filter((u) => !sentSet.has(normalizeMediaForDedupe(u)));
    if (!stripSingle && (!mediaUrls || filteredUrls?.length === mediaUrls.length)) {
      return payload; // No change
    }
    return {
      ...payload,
      mediaUrl: stripSingle ? undefined : mediaUrl,
      mediaUrls: filteredUrls?.length ? filteredUrls : undefined,
    };
  });
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
  const originAccount = normalizeOptionalAccountId(params.accountId);
  const sentTargets = params.messagingToolSentTargets ?? [];
  if (sentTargets.length === 0) {
    return false;
  }
  return sentTargets.some((target) => {
    if (!target?.provider) {
      return false;
    }
    const sentProvider = target.provider.trim().toLowerCase();
    const providerMatches =
      sentProvider === provider || (target.tool === "message" && sentProvider === "message");
    if (!providerMatches) {
      return false;
    }
    const targetAccount = normalizeOptionalAccountId(target.accountId);
    if (originAccount && targetAccount && originAccount !== targetAccount) {
      return false;
    }
    // Message tool sends can rely on implicit current-target routing (no explicit "to").
    // In that case provider/account match is enough to suppress duplicate final payloads.
    if (!target.to) {
      return true;
    }
    const targetKey = normalizeTargetForProvider(provider, target.to);
    if (!targetKey) {
      return false;
    }
    return targetKey === originTarget;
  });
}
