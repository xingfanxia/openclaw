import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
import type { SpeechProviderConfig, SpeechProviderPlugin } from "openclaw/plugin-sdk/speech-core";
import { volcanoTTS } from "./tts.js";

const DEFAULT_VOLCANO_SPEAKER = "zh_female_linzhiling_mars_bigtts";
const DEFAULT_VOLCANO_RESOURCE_ID = "seed-tts-1.0";
const DEFAULT_VOLCANO_V2_RESOURCE_ID = "seed-icl-2.0";

const VOLCANO_V2_RESOURCE_PATTERNS = ["seedicl", "seed-tts-2.0", "seed-icl-2.0"];

type VolcanoProviderConfig = {
  appId?: string;
  accessKey?: string;
  resourceId: string;
  speaker: string;
  version?: "v1" | "v2";
};

function trimToUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isV2Resource(resourceId: string): boolean {
  const lower = resourceId.toLowerCase();
  return VOLCANO_V2_RESOURCE_PATTERNS.some((p) => lower.includes(p));
}

function resolveIsV2(config: VolcanoProviderConfig): boolean {
  return config.version === "v2" || isV2Resource(config.resourceId);
}

function normalizeVolcanoProviderConfig(rawConfig: Record<string, unknown>): VolcanoProviderConfig {
  const providers = asObject(rawConfig.providers);
  const raw = asObject(providers?.volcano) ?? asObject(rawConfig.volcano);
  const version = trimToUndefined(raw?.version) as "v1" | "v2" | undefined;
  return {
    appId: normalizeResolvedSecretInputString({
      value: raw?.appId,
      path: "messages.tts.providers.volcano.appId",
    }),
    accessKey: normalizeResolvedSecretInputString({
      value: raw?.accessKey,
      path: "messages.tts.providers.volcano.accessKey",
    }),
    resourceId:
      trimToUndefined(raw?.resourceId) ??
      (version === "v2" ? DEFAULT_VOLCANO_V2_RESOURCE_ID : DEFAULT_VOLCANO_RESOURCE_ID),
    speaker: trimToUndefined(raw?.speaker) ?? DEFAULT_VOLCANO_SPEAKER,
    version,
  };
}

function readVolcanoProviderConfig(config: SpeechProviderConfig): VolcanoProviderConfig {
  const defaults = normalizeVolcanoProviderConfig({});
  const version = (trimToUndefined(config.version) as "v1" | "v2" | undefined) ?? defaults.version;
  return {
    appId: trimToUndefined(config.appId) ?? defaults.appId,
    accessKey: trimToUndefined(config.accessKey) ?? defaults.accessKey,
    resourceId:
      trimToUndefined(config.resourceId) ??
      (version === "v2" ? DEFAULT_VOLCANO_V2_RESOURCE_ID : DEFAULT_VOLCANO_RESOURCE_ID),
    speaker: trimToUndefined(config.speaker) ?? defaults.speaker,
    version,
  };
}

function resolveAppId(config: VolcanoProviderConfig): string | undefined {
  return config.appId || process.env.DOUBAO_TTS_APP_ID || process.env.VOLC_TTS_APP_ID;
}

function resolveAccessKey(config: VolcanoProviderConfig): string | undefined {
  return config.accessKey || process.env.DOUBAO_TTS_ACCESS_KEY || process.env.VOLC_TTS_ACCESS_TOKEN;
}

export function buildVolcanoSpeechProvider(): SpeechProviderPlugin {
  return {
    id: "volcano",
    label: "Volcano Engine",
    aliases: ["volcengine-tts", "doubao-tts"],
    autoSelectOrder: 35,
    isConfigured: ({ providerConfig }) => {
      const config = readVolcanoProviderConfig(providerConfig);
      return Boolean(resolveAppId(config) && resolveAccessKey(config));
    },
    resolveConfig: ({ rawConfig }) => normalizeVolcanoProviderConfig(rawConfig),
    synthesize: async (req) => {
      const config = readVolcanoProviderConfig(req.providerConfig);
      const appId = resolveAppId(config);
      const accessKey = resolveAccessKey(config);
      if (!appId || !accessKey) {
        throw new Error("Volcano TTS requires appId and accessKey");
      }

      const overrides = req.providerOverrides ?? {};
      const speaker = trimToUndefined(overrides.speaker) ?? config.speaker;
      const resourceId = trimToUndefined(overrides.resourceId) ?? config.resourceId;
      const version =
        (trimToUndefined(overrides.version) as "v1" | "v2" | undefined) ?? config.version;
      const effectiveConfig = { ...config, resourceId, version };
      const v2 = resolveIsV2(effectiveConfig);

      const contextTexts = Array.isArray(overrides.contextTexts)
        ? (overrides.contextTexts as string[])
        : undefined;

      const audioBuffer = await volcanoTTS({
        text: req.text,
        appId,
        accessKey,
        resourceId,
        speaker,
        timeoutMs: req.timeoutMs,
        contextTexts,
        isV2: v2,
      });

      return {
        audioBuffer,
        outputFormat: "mp3",
        fileExtension: ".mp3",
        voiceCompatible: v2 || req.target === "voice-note",
      };
    },
  };
}
