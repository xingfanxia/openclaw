import { Type } from "@sinclair/typebox";
import { SILENT_REPLY_TOKEN } from "../../auto-reply/tokens.js";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import type { TtsProvider } from "../../config/types.tts.js";
import { isVolcanoV2, resolveTtsConfig, stripEmotionMarkers, textToSpeech } from "../../tts/tts.js";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";

const TtsToolSchema = Type.Object({
  text: Type.String({ description: "Text to convert to speech." }),
  channel: Type.Optional(
    Type.String({ description: "Optional channel id to pick output format (e.g. telegram)." }),
  ),
  provider: Type.Optional(
    Type.String({ description: "TTS provider override: 'volcano' (default) or 'fishaudio'." }),
  ),
});

export function createTtsTool(opts?: {
  config?: OpenClawConfig;
  agentChannel?: GatewayMessageChannel;
}): AnyAgentTool {
  return {
    label: "TTS",
    name: "tts",
    description: `Convert text to speech. Audio is delivered automatically — do NOT re-send the audio file via the message tool. After a successful call, reply with ${SILENT_REPLY_TOKEN} only.`,
    parameters: TtsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const text = readStringParam(params, "text", { required: true });
      const channel = readStringParam(params, "channel");
      const providerOverride = readStringParam(params, "provider") as TtsProvider | undefined;
      const cfg = opts?.config ?? loadConfig();
      const result = await textToSpeech({
        text,
        cfg,
        channel: channel ?? opts?.agentChannel,
        overrides: providerOverride ? { provider: providerOverride } : undefined,
      });

      if (result.success && result.audioPath) {
        // Build MEDIA delivery directive (parsed by the framework, NOT by the LLM).
        const mediaLines: string[] = [];
        if (result.voiceCompatible) {
          mediaLines.push("[[audio_as_voice]]");
        }
        mediaLines.push(`MEDIA:${result.audioPath}`);

        // For volcano v2: include stripped display text so the LLM knows
        // what was actually spoken (without [emotion] markers).
        // Check actual provider used (not config default) for emotion marker stripping
        const ttsConfig = resolveTtsConfig(cfg);
        const v2 = result.provider === "volcano" && isVolcanoV2(ttsConfig);
        const displayText = v2 ? stripEmotionMarkers(text) : undefined;

        return {
          content: [
            // MEDIA directive for framework delivery (voice bubble).
            { type: "text", text: mediaLines.join("\n") },
            // LLM-visible result — no file path to prevent re-sending via message tool.
            {
              type: "text",
              text: `Audio delivered (${result.provider ?? "tts"}). Do not re-send.`,
            },
          ],
          details: { audioPath: result.audioPath, provider: result.provider, displayText },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: result.error ?? "TTS conversion failed",
          },
        ],
        details: { error: result.error },
      };
    },
  };
}
