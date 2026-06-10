// Telegram plugin module implements lane delivery text deliverer behavior.
import {
  createPreviewMessageReceipt,
  type MessageReceipt,
} from "openclaw/plugin-sdk/channel-outbound";
import {
  isPotentialTruncatedFinal,
  selectLongerFinalText,
} from "openclaw/plugin-sdk/channel-outbound";
import {
  buildTtsSupplementMediaPayload,
  getReplyPayloadTtsSupplement,
  resolveSendableOutboundReplyParts,
} from "openclaw/plugin-sdk/reply-payload";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import type { TelegramInlineButtons } from "./button-types.js";
import type { TelegramDraftStream } from "./draft-stream.js";

export type LaneName = "answer" | "reasoning";

export type DraftLaneState = {
  stream: TelegramDraftStream | undefined;
  lastPartialText: string;
  hasStreamedMessage: boolean;
  finalized: boolean;
  activeChunkIndex: number;
};

type LanePreviewFinalizedDelivery = {
  content: string;
  promptContextContent?: string;
  messageId: number;
  buttonsAttached?: boolean;
  receipt: MessageReceipt;
};

type LanePreviewFinalizedDeliveryInput = Omit<LanePreviewFinalizedDelivery, "receipt"> & {
  receipt?: MessageReceipt;
};

export type LaneDeliveryResult =
  | {
      kind: "preview-finalized";
      delivery: LanePreviewFinalizedDelivery;
    }
  | { kind: "preview-retained" | "preview-updated" | "sent" | "skipped" };

type CreateLaneTextDelivererParams = {
  lanes: Record<LaneName, DraftLaneState>;
  draftMaxChars: number;
  applyTextToPayload: (payload: ReplyPayload, text: string) => ReplyPayload;
  applyTextToFollowUpPayload?: (payload: ReplyPayload, text: string) => ReplyPayload;
  splitFinalTextForPreview?: (text: string) => readonly string[];
  sendPayload: (payload: ReplyPayload) => Promise<boolean>;
  flushDraftLane: (lane: DraftLaneState) => Promise<void>;
  stopDraftLane: (lane: DraftLaneState) => Promise<void>;
  clearDraftLane: (lane: DraftLaneState) => Promise<void>;
  editStreamMessage: (params: {
    laneName: LaneName;
    messageId: number;
    text: string;
    buttons?: TelegramInlineButtons;
  }) => Promise<void>;
  resolveFinalTextCandidate?: (params: {
    finalText: string;
    laneName: LaneName;
  }) => Promise<string | undefined> | string | undefined;
  log: (message: string) => void;
  markDelivered: () => void;
};

type DeliverLaneTextParams = {
  laneName: LaneName;
  text: string;
  payload: ReplyPayload;
  infoKind: string;
  previewButtons?: TelegramInlineButtons;
  allowPreviewUpdateForNonFinal?: boolean;
};

type TryUpdatePreviewParams = {
  lane: DraftLaneState;
  laneName: LaneName;
  text: string;
  previewButtons?: TelegramInlineButtons;
  stopBeforeEdit?: boolean;
  updateLaneSnapshot?: boolean;
  skipRegressive: RegressiveSkipMode;
  context: "final" | "update";
  previewMessageId?: number;
  previewTextSnapshot?: string;
};

type PreviewEditResult = "edited" | "retained" | "regressive-skipped" | "fallback";

type ConsumeArchivedAnswerPreviewParams = {
  lane: DraftLaneState;
  text: string;
  payload: ReplyPayload;
  previewButtons?: TelegramInlineButtons;
  canEditViaPreview: boolean;
};

type PreviewUpdateContext = "final" | "update";
type RegressiveSkipMode = "always" | "existingOnly" | "never";

type ResolvePreviewTargetParams = {
  lane: DraftLaneState;
  previewMessageIdOverride?: number;
  stopBeforeEdit: boolean;
  context: PreviewUpdateContext;
};

type PreviewTargetResolution = {
  hadPreviewMessage: boolean;
  previewMessageId: number | undefined;
  stopCreatesFirstPreview: boolean;
};

function result(
  kind: LaneDeliveryResult["kind"],
  delivery?: LanePreviewFinalizedDeliveryInput,
): LaneDeliveryResult {
  if (kind === "preview-finalized") {
    const finalized = delivery!;
    return {
      kind,
      delivery: {
        ...finalized,
        receipt: finalized.receipt ?? createPreviewMessageReceipt({ id: finalized.messageId }),
      },
    };
  }
  return { kind };
}

function compactChunks(chunks: readonly string[]): string[] {
  const out: string[] = [];
  let whitespace = "";
  for (const chunk of chunks) {
    if (!chunk) {
      continue;
    }
    if (chunk.trim().length === 0) {
      whitespace += chunk;
      continue;
    }
    out.push(`${whitespace}${chunk}`);
    whitespace = "";
  }
  if (whitespace && out.length > 0) {
    out[out.length - 1] = `${out[out.length - 1]}${whitespace}`;
  }
  return out;
}

function isDeliveredPrefix(params: { deliveredText: string | undefined; finalText: string }) {
  if (!params.deliveredText || params.deliveredText.length === 0) {
    return false;
  }
  if (args.skipRegressive === "never") {
    return false;
  }
  return (
    params.finalText === params.deliveredText || params.finalText.startsWith(params.deliveredText)
  );
}

function isLongLivedPreview(visibleSinceMs: number | undefined, nowMs: number): boolean {
  return (
    typeof visibleSinceMs === "number" &&
    Number.isFinite(visibleSinceMs) &&
    nowMs - visibleSinceMs >= LONG_LIVED_PREVIEW_FRESH_FINAL_AFTER_MS
  );
}

function compactPreviewFinalChunks(chunks: readonly string[]): string[] {
  const result: string[] = [];
  let pendingWhitespace = "";
  for (const chunk of chunks) {
    if (!chunk) {
      continue;
    }
    if (chunk.trim().length === 0) {
      pendingWhitespace += chunk;
      continue;
    }
    result.push(`${pendingWhitespace}${chunk}`);
    pendingWhitespace = "";
  }
  if (pendingWhitespace && result.length > 0) {
    result[result.length - 1] = `${result[result.length - 1]}${pendingWhitespace}`;
  }
  return result;
}

function resolvePreviewTarget(params: ResolvePreviewTargetParams): PreviewTargetResolution {
  const lanePreviewMessageId = params.lane.stream?.messageId();
  const previewMessageId =
    typeof params.previewMessageIdOverride === "number"
      ? params.previewMessageIdOverride
      : lanePreviewMessageId;
  const hadPreviewMessage =
    typeof params.previewMessageIdOverride === "number" || typeof lanePreviewMessageId === "number";
  return {
    hadPreviewMessage,
    previewMessageId: typeof previewMessageId === "number" ? previewMessageId : undefined,
    stopCreatesFirstPreview:
      params.stopBeforeEdit && !hadPreviewMessage && params.context === "final",
  };
}

export function createLaneTextDeliverer(params: CreateLaneTextDelivererParams) {
  const followUpPayload = (payload: ReplyPayload, text: string) =>
    params.applyTextToFollowUpPayload
      ? params.applyTextToFollowUpPayload(payload, text)
      : params.applyTextToPayload(payload, text);
  const textOnlyPayload = (payload: ReplyPayload): ReplyPayload => {
    const {
      mediaUrl: _mediaUrl,
      mediaUrls: _mediaUrls,
      audioAsVoice: _audioAsVoice,
      spokenText: _spokenText,
      ...rest
    } = payload;
    return rest;
  };
  const mediaChannelData = (
    channelData: ReplyPayload["channelData"],
    options?: { stripButtons?: boolean },
  ): ReplyPayload["channelData"] => {
    if (!options?.stripButtons) {
      return channelData;
    }
    const telegramData = channelData?.telegram;
    if (!telegramData || typeof telegramData !== "object" || Array.isArray(telegramData)) {
      return channelData;
    }
    const { buttons: _buttons, ...telegramRest } = telegramData as Record<string, unknown>;
    if (_buttons === undefined) {
      return channelData;
    }
    const next: Record<string, unknown> = { ...channelData };
    if (Object.keys(telegramRest).length > 0) {
      next.telegram = telegramRest;
    } else {
      delete next.telegram;
    }
    return Object.keys(next).length > 0 ? next : undefined;
  };
  const withMediaChannelData = (
    payload: ReplyPayload,
    options?: { stripButtons?: boolean },
  ): ReplyPayload => {
    const channelData = mediaChannelData(payload.channelData, options);
    if (channelData === payload.channelData) {
      return payload;
    }
    if (channelData) {
      return { ...payload, channelData };
    }
    const { channelData: _channelData, ...rest } = payload;
    return rest;
  };
  const withFallbackTelegramButtons = (
    payload: ReplyPayload,
    buttons?: TelegramInlineButtons,
  ): ReplyPayload => {
    if (!buttons) {
      return payload;
    }
    const channelData = payload.channelData ?? {};
    const telegramData = channelData.telegram;
    if (
      telegramData &&
      typeof telegramData === "object" &&
      !Array.isArray(telegramData) &&
      "buttons" in telegramData
    ) {
      return payload;
    }
    const telegramRest =
      telegramData && typeof telegramData === "object" && !Array.isArray(telegramData)
        ? (telegramData as Record<string, unknown>)
        : {};
    return {
      ...payload,
      channelData: {
        ...channelData,
        telegram: {
          ...telegramRest,
          buttons,
        },
      },
    };
  };
  const mediaOnlyPayload = (
    payload: ReplyPayload,
    text: string,
    options?: { stripButtons?: boolean; fallbackButtons?: TelegramInlineButtons },
  ): ReplyPayload => {
    if (getReplyPayloadTtsSupplement(payload)) {
      return withFallbackTelegramButtons(
        withMediaChannelData(
          buildTtsSupplementMediaPayload(params.applyTextToPayload(payload, text)),
          options,
        ),
        options?.fallbackButtons,
      );
    }
    if (payload.audioAsVoice === true) {
      const {
        text: _text,
        presentation: _presentation,
        interactive: _interactive,
        btw: _btw,
        spokenText: _spokenText,
        ...voicePayload
      } = params.applyTextToPayload(payload, text);
      return withFallbackTelegramButtons(
        withMediaChannelData({ ...voicePayload, spokenText: text }, options),
        options?.fallbackButtons,
      );
    }
    const {
      text: _text,
      presentation: _presentation,
      interactive: _interactive,
      btw: _btw,
      ...rest
    } = payload;
    return withFallbackTelegramButtons(
      withMediaChannelData(rest, options),
      options?.fallbackButtons,
    );
  };
  const shouldUseFreshFinalForPreview = (lane: DraftLaneState, visibleSinceMs?: number) =>
    isMessagePreviewLane(lane) &&
    (isLongLivedPreview(visibleSinceMs, readNow()) || wasVisiblyOverwrittenSince(visibleSinceMs));
  const buildFollowUpPayload = (payload: ReplyPayload, text: string) =>
    params.applyTextToFollowUpPayload
      ? params.applyTextToFollowUpPayload(payload, text)
      : params.applyTextToPayload(payload, text);
  const clearActivePreviewAfterFreshFinal = async (lane: DraftLaneState, laneName: LaneName) => {
    try {
      await lane.stream?.clear();
    } catch (err) {
      params.log(`telegram: ${laneName} fresh final preview cleanup failed: ${String(err)}`);
    }
    await params.clearDraftLane(lane);
    lane.lastPartialText = "";
    lane.hasStreamedMessage = false;
  };
  const tryDeliverLongFinalThroughPreview = async (args: {
    lane: DraftLaneState;
    laneName: LaneName;
    text: string;
    payload: ReplyPayload;
    previewButtons?: TelegramInlineButtons;
  }): Promise<LaneDeliveryResult | undefined> => {
    if (
      !args.lane.stream ||
      args.previewButtons !== undefined ||
      params.activePreviewLifecycleByLane[args.laneName] !== "transient"
    ) {
      return undefined;
    }
    const chunks = compactPreviewFinalChunks(params.splitFinalTextForPreview?.(args.text) ?? []);
    const [firstChunk, ...remainingChunks] = chunks;
    if (!firstChunk || remainingChunks.length === 0 || firstChunk.length > params.draftMaxChars) {
      return undefined;
    }
    await params.flushDraftLane(args.lane);
    const previewMessageId = args.lane.stream.messageId();
    if (typeof previewMessageId !== "number") {
      return undefined;
    }
    const finalized = await tryUpdatePreviewForLane({
      lane: args.lane,
      laneName: args.laneName,
      text: firstChunk,
      stopBeforeEdit: true,
      updateLaneSnapshot: true,
      skipRegressive: "never",
      context: "final",
    });
    if (finalized === "fallback") {
      return undefined;
    }
    if (finalized === "retained") {
      markActivePreviewComplete(args.laneName);
      return result("preview-retained");
    }
    markActivePreviewComplete(args.laneName);
    const remainingText = remainingChunks.join("");
    if (remainingText.trim().length > 0) {
      await params.sendPayload(buildFollowUpPayload(args.payload, remainingText));
    }
    return result("preview-finalized", {
      content: args.text,
      messageId: previewMessageId,
    });
  };

  const streamText = async (
    laneName: LaneName,
    lane: DraftLaneState,
    text: string,
    payload: ReplyPayload,
    isFinal: boolean,
    buttons?: TelegramInlineButtons,
  ): Promise<LaneDeliveryResult | undefined> => {
    const stream = lane.stream;
    if (!stream || text.length === 0 || payload.isError) {
      return undefined;
    }

    const chunks =
      text.length > params.draftMaxChars
        ? compactChunks(params.splitFinalTextForStream?.(text) ?? [])
        : [text];

    const clampActiveChunkIndex = () =>
      Math.min(lane.activeChunkIndex, Math.max(0, chunks.length - 1));
    const activeChunkIndex = clampActiveChunkIndex();
    const activeChunk = chunks[activeChunkIndex];
    const remainingChunks = chunks.slice(activeChunkIndex + 1);

    if (!activeChunk || activeChunk.length > params.draftMaxChars) {
      return undefined;
    }

    const activeFullText = chunks.slice(activeChunkIndex).join("");
    const finalText = activeFullText.trimEnd();
    const deliveredStreamTextBeforeUpdate = stream.lastDeliveredText?.();
    const deliveredPrefixBeforeUpdate =
      isFinal &&
      deliveredStreamTextBeforeUpdate !== undefined &&
      isDeliveredPrefix({
        deliveredText: deliveredStreamTextBeforeUpdate,
        finalText,
      }) &&
      deliveredStreamTextBeforeUpdate.length > activeChunk.trimEnd().length;

    const finalizeDeliveredPrefix = async (
      deliveredStreamText: string,
      messageId: number,
    ): Promise<LaneDeliveryResult> => {
      lane.finalized = true;
      params.markDelivered();
      let buttonsAttached = false;
      if (buttons) {
        const deliveredChunks = compactChunks(
          params.splitFinalTextForStream?.(deliveredStreamText) ?? [],
        );
        const currentChunk = deliveredChunks.at(-1);
        if (currentChunk && currentChunk.length <= params.draftMaxChars) {
          try {
            await params.editStreamMessage({ laneName, messageId, text: currentChunk, buttons });
            buttonsAttached = true;
          } catch (err) {
            params.log(`telegram: ${laneName} stream button edit failed: ${String(err)}`);
          }
        }
      }
      const suffix = activeFullText.slice(deliveredStreamText.length);
      if (suffix.trim().length > 0) {
        for (const chunk of compactChunks(params.splitFinalTextForStream?.(suffix) ?? [])) {
          if (chunk.trim().length === 0) {
            continue;
          }
          await params.sendPayload(followUpPayload(payload, chunk));
        }
      }
      return result("preview-finalized", {
        content: text,
        promptContextContent: deliveredStreamText,
        messageId,
        buttonsAttached,
      });
    };

    const candidateTexts = [stream.lastDeliveredText?.(), lane.lastPartialText];
    if (isFinal && remainingChunks.length === 0 && isPotentialTruncatedFinal(activeFullText)) {
      const resolvedFullCandidate = await params.resolveFinalTextCandidate?.({
        finalText: text,
        laneName,
      });
      if (resolvedFullCandidate) {
        const resolvedChunks =
          resolvedFullCandidate.length > params.draftMaxChars
            ? compactChunks(params.splitFinalTextForStream?.(resolvedFullCandidate) ?? [])
            : [resolvedFullCandidate];
        candidateTexts.push(resolvedChunks.slice(activeChunkIndex).join(""));
      }
    }

    const retainedPreview =
      isFinal && remainingChunks.length === 0 && isPotentialTruncatedFinal(activeFullText)
        ? selectLongerFinalText({
            finalText: activeFullText,
            candidateTexts,
          })
        : undefined;

    if (retainedPreview && (!buttons || retainedPreview.length <= params.draftMaxChars)) {
      const previewText = retainedPreview;
      lane.lastPartialText = previewText;
      lane.hasStreamedMessage = true;
      await params.stopDraftLane(lane);
      const messageId = stream.messageId();
      if (typeof messageId !== "number") {
        if (stream.sendMayHaveLanded?.()) {
          lane.finalized = true;
          params.markDelivered();
          return result("preview-retained");
        }
        return undefined;
      }
      const deliveredStreamTextAfterStop = stream.lastDeliveredText?.();
      if (
        deliveredStreamTextAfterStop !== undefined &&
        deliveredStreamTextAfterStop !== previewText
      ) {
        return undefined;
      }
      let buttonsAttached = false;
      if (buttons) {
        try {
          await params.editStreamMessage({ laneName, messageId, text: previewText, buttons });
          buttonsAttached = true;
        } catch (err) {
          params.log(`telegram: ${laneName} stream button edit failed: ${String(err)}`);
        }
      }
      for (const chunk of remainingChunks) {
        if (chunk.trim().length === 0) {
          continue;
        }
        await params.sendPayload(followUpPayload(payload, chunk));
      }
      lane.finalized = true;
      params.markDelivered();
      return result("preview-finalized", {
        content: previewText,
        promptContextContent: previewText,
        messageId,
        buttonsAttached,
      });
    }

    if (!deliveredPrefixBeforeUpdate) {
      lane.lastPartialText = activeChunk;
      lane.hasStreamedMessage = true;
      lane.finalized = false;
      stream.update(activeChunk);
    }
    if (isFinal) {
      await params.stopDraftLane(lane);
    } else {
      await params.flushDraftLane(lane);
    }
    const activeChunkIndexAfterStop = isFinal ? clampActiveChunkIndex() : activeChunkIndex;
    const activeChunkAfterStop = chunks[activeChunkIndexAfterStop] ?? activeChunk;
    const remainingChunksAfterStop = chunks.slice(activeChunkIndexAfterStop + 1);

    const messageId = stream.messageId();
    if (typeof messageId !== "number") {
      if (isFinal && stream.sendMayHaveLanded?.()) {
        lane.finalized = true;
        params.markDelivered();
        return result("preview-retained");
      }
      return undefined;
    }

    const deliveredStreamTextAfterStop = stream.lastDeliveredText?.();
    const activeChunkTextAfterStop = activeChunkAfterStop.trimEnd();
    const retainedActiveChunkAfterStop =
      activeChunkIndexAfterStop !== activeChunkIndex &&
      deliveredStreamTextAfterStop === activeChunk.trimEnd();
    if (
      isFinal &&
      deliveredStreamTextAfterStop !== undefined &&
      deliveredStreamTextAfterStop !== activeChunkTextAfterStop &&
      !retainedActiveChunkAfterStop
    ) {
      if (
        isDeliveredPrefix({ deliveredText: deliveredStreamTextAfterStop, finalText }) &&
        deliveredStreamTextAfterStop.length > activeChunkTextAfterStop.length
      ) {
        return await finalizeDeliveredPrefix(deliveredStreamTextAfterStop, messageId);
      }
      return undefined;
    }

    if (deliveredPrefixBeforeUpdate && deliveredStreamTextAfterStop === undefined) {
      return await finalizeDeliveredPrefix(deliveredStreamTextBeforeUpdate, messageId);
    }

    params.markDelivered();
    let buttonsAttached = false;
    if (buttons) {
      try {
        await params.editStreamMessage({
          laneName,
          messageId,
          text: activeChunkAfterStop,
          buttons,
        });
        buttonsAttached = true;
      } catch (err) {
        params.log(`telegram: ${laneName} stream button edit failed: ${String(err)}`);
      }
    }

    if (isFinal) {
      lane.finalized = true;
      for (const chunk of remainingChunksAfterStop) {
        if (chunk.trim().length === 0) {
          continue;
        }
        await params.sendPayload(followUpPayload(payload, chunk));
      }
      return result("preview-finalized", {
        content: text,
        promptContextContent: activeChunkAfterStop,
        messageId,
        buttonsAttached,
      });
    }

    return result("preview-updated");
  };

  return async ({
    laneName,
    text,
    payload,
    infoKind,
    buttons,
  }: DeliverLaneTextParams): Promise<LaneDeliveryResult> => {
    const lane = params.lanes[laneName];
    const reply = resolveSendableOutboundReplyParts(payload, { text });
    const hasMedia = reply.hasMedia;
    const canEditViaPreview =
      !hasMedia && text.length > 0 && text.length <= params.draftMaxChars && !payload.isError;

    if (infoKind === "final") {
      // Transient previews must decide cleanup retention per final attempt.
      // Completed previews intentionally stay retained so later extra payloads
      // do not clear the already-finalized message.
      if (params.activePreviewLifecycleByLane[laneName] === "transient") {
        params.retainPreviewOnCleanupByLane[laneName] = false;
      }
      if (laneName === "answer") {
        const archivedResult = await consumeArchivedAnswerPreviewForFinal({
          lane,
          text,
          payload,
          previewButtons,
          canEditViaPreview,
        });
        if (archivedResult) {
          return archivedResult;
        }
      }
      if (canEditViaPreview && params.activePreviewLifecycleByLane[laneName] === "transient") {
        await params.flushDraftLane(lane);
        if (laneName === "answer") {
          const archivedResultAfterFlush = await consumeArchivedAnswerPreviewForFinal({
            lane,
            text,
            payload,
            previewButtons,
            canEditViaPreview,
          });
          if (archivedResultAfterFlush) {
            return archivedResultAfterFlush;
          }
        }
        if (shouldUseFreshFinalForLane(lane)) {
          await params.stopDraftLane(lane);
          const delivered = await params.sendPayload(params.applyTextToPayload(payload, text));
          if (delivered) {
            await clearActivePreviewAfterFreshFinal(lane, laneName);
            return result("sent");
          }
        }
        const previewMessageId = lane.stream?.messageId();
        const finalized = await tryUpdatePreviewForLane({
          lane,
          laneName,
          text,
          previewButtons,
          stopBeforeEdit: true,
          skipRegressive: "existingOnly",
          context: "final",
        });
        if (finalized === "edited") {
          markActivePreviewComplete(laneName);
          return result("preview-finalized", {
            content: text,
            messageId: previewMessageId ?? lane.stream?.messageId(),
          });
        }
        if (finalized === "regressive-skipped") {
          markActivePreviewComplete(laneName);
          return result("preview-finalized", {
            content: lane.lastPartialText,
            messageId: previewMessageId ?? lane.stream?.messageId(),
          });
        }
        if (finalized === "retained") {
          markActivePreviewComplete(laneName);
          return result("preview-retained");
        }
      } else if (!hasMedia && !payload.isError && text.length > params.draftMaxChars) {
        const longFinalResult = await tryDeliverLongFinalThroughPreview({
          lane,
          laneName,
          text,
          payload,
          previewButtons,
        });
        if (longFinalResult) {
          return longFinalResult;
        }
        params.log(
          `telegram: preview final too long for edit (${text.length} > ${params.draftMaxChars}); falling back to standard send`,
        );
      }
      await params.stopDraftLane(lane);
      const delivered = await params.sendPayload(params.applyTextToPayload(payload, text));
      return delivered ? result("sent") : result("skipped");
    }

    if (
      isFinal &&
      reply.hasMedia &&
      lane.stream &&
      lane.hasStreamedMessage &&
      !lane.finalized &&
      text.trim().length > 0
    ) {
      const finalizedPreview = await streamText(
        laneName,
        lane,
        text,
        textOnlyPayload(payload),
        true,
        buttons,
      );
      if (finalizedPreview) {
        const stripButtons =
          finalizedPreview.kind === "preview-finalized" &&
          finalizedPreview.delivery.buttonsAttached === true;
        const mediaText =
          finalizedPreview.kind === "preview-finalized" ? finalizedPreview.delivery.content : text;
        await params.sendPayload(
          mediaOnlyPayload(payload, mediaText, {
            stripButtons,
            fallbackButtons: stripButtons ? undefined : buttons,
          }),
          {
            durable: true,
          },
        );
        return finalizedPreview;
      }
    }

    if (isFinal) {
      await clearUnfinalizedStream(lane);
    }

    const delivered = await params.sendPayload(params.applyTextToPayload(payload, text), {
      durable: isFinal,
    });
    if (delivered && isFinal) {
      lane.finalized = true;
    }
    return delivered ? result("sent") : result("skipped");
  };
}
