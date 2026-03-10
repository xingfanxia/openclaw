import { randomUUID } from "node:crypto";
import type { AudioTranscriptionRequest, AudioTranscriptionResult } from "../../types.js";
import { normalizeBaseUrl, requireTranscriptionText } from "../shared.js";

const DEFAULT_VOLCENGINE_ASR_BASE_URL = "https://openspeech.bytedance.com/api/v3";
const DEFAULT_VOLCENGINE_ASR_RESOURCE_ID = "volc.bigasr.auc";
const DEFAULT_VOLCENGINE_ASR_MODEL = "bigmodel";
const STATUS_OK = "20000000";

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 30;

type QueryResult = {
  audio_info?: { duration?: number };
  result?: {
    text?: string;
    utterances?: Array<{ text?: string }>;
  };
};

function resolveModel(model?: string): string {
  return model?.trim() || DEFAULT_VOLCENGINE_ASR_MODEL;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function transcribeVolcengineAudio(
  params: AudioTranscriptionRequest,
): Promise<AudioTranscriptionResult> {
  const fetchFn = params.fetchFn ?? fetch;
  const baseUrl = normalizeBaseUrl(params.baseUrl, DEFAULT_VOLCENGINE_ASR_BASE_URL);
  const model = resolveModel(params.model);

  const appId = params.headers?.["X-Api-App-Id"] ?? "";
  const accessKey = params.headers?.["X-Api-Access-Key"] ?? params.apiKey;
  const resourceId = params.headers?.["X-Api-Resource-Id"] ?? DEFAULT_VOLCENGINE_ASR_RESOURCE_ID;

  if (!appId) {
    throw new Error("Volcengine ASR requires X-Api-App-Id header");
  }
  if (!accessKey) {
    throw new Error(
      "Volcengine ASR requires an API key (X-Api-Access-Key header or provider apiKey)",
    );
  }

  const audioBase64 = Buffer.from(params.buffer).toString("base64");
  const requestId = randomUUID();

  const commonHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-App-Key": appId,
    "X-Api-Access-Key": accessKey,
    "X-Api-Resource-Id": resourceId,
    "X-Api-Request-Id": requestId,
    "X-Api-Sequence": "-1",
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    // Step 1: Submit transcription task
    const submitUrl = `${baseUrl}/auc/${model}/submit`;
    const submitRes = await fetchFn(submitUrl, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({
        user: { uid: "openclaw-stt" },
        audio: {
          data: audioBase64,
          format: resolveAudioFormat(params.mime),
          codec: resolveAudioCodec(params.mime),
        },
        request: {
          model_name: model,
          enable_itn: true,
          enable_punc: true,
        },
      }),
      signal: controller.signal,
    });

    const submitStatus = submitRes.headers.get("X-Api-Status-Code");
    if (submitStatus !== STATUS_OK) {
      const message = submitRes.headers.get("X-Api-Message") ?? (await readBodyMessage(submitRes));
      throw new Error(`Volcengine ASR submit failed (status ${submitStatus}): ${message}`);
    }
    // Consume body to release connection
    await submitRes.text();

    // Step 2: Poll for result using the same request ID
    const queryUrl = `${baseUrl}/auc/${model}/query`;

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const queryRes = await fetchFn(queryUrl, {
        method: "POST",
        headers: commonHeaders,
        body: JSON.stringify({}),
        signal: controller.signal,
      });

      const queryStatus = queryRes.headers.get("X-Api-Status-Code");
      const body = await queryRes.text();

      if (queryStatus !== STATUS_OK) {
        const message = queryRes.headers.get("X-Api-Message") ?? "unknown error";
        throw new Error(`Volcengine ASR query failed (status ${queryStatus}): ${message}`);
      }

      // Empty body = still processing
      if (!body || body === "{}") {
        continue;
      }

      const parsed = JSON.parse(body) as QueryResult;
      const fullText =
        parsed.result?.text ??
        parsed.result?.utterances
          ?.map((u) => u.text)
          .filter(Boolean)
          .join(" ");

      const text = requireTranscriptionText(fullText, "Volcengine ASR response missing text");
      return { text, model };
    }

    throw new Error(`Volcengine ASR timed out after ${MAX_POLL_ATTEMPTS} poll attempts`);
  } finally {
    clearTimeout(timeout);
  }
}

async function readBodyMessage(res: Response): Promise<string> {
  try {
    const body = await res.text();
    if (!body) {
      return "empty response";
    }
    const parsed = JSON.parse(body) as { header?: { message?: string } };
    return parsed.header?.message ?? body.slice(0, 200);
  } catch {
    return "could not read response";
  }
}

function resolveAudioFormat(mime?: string): string {
  if (!mime) {
    return "wav";
  }
  const lower = mime.toLowerCase();
  if (lower.includes("ogg") || lower.includes("opus")) {
    return "ogg";
  }
  if (lower.includes("mp3") || lower.includes("mpeg")) {
    return "mp3";
  }
  if (lower.includes("mp4") || lower.includes("m4a")) {
    return "m4a";
  }
  if (lower.includes("pcm")) {
    return "pcm";
  }
  return "wav";
}

function resolveAudioCodec(mime?: string): string {
  if (!mime) {
    return "raw";
  }
  const lower = mime.toLowerCase();
  if (lower.includes("opus")) {
    return "opus";
  }
  if (lower.includes("mp3") || lower.includes("mpeg")) {
    return "mp3";
  }
  if (lower.includes("aac") || lower.includes("m4a") || lower.includes("mp4")) {
    return "aac";
  }
  return "raw";
}
