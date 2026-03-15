import { randomUUID } from "node:crypto";
import type { AudioTranscriptionRequest, AudioTranscriptionResult } from "../../types.js";
import { normalizeBaseUrl, requireTranscriptionText } from "../shared.js";

const DEFAULT_VOLCENGINE_ASR_BASE_URL = "https://openspeech.bytedance.com/api/v3";
const DEFAULT_VOLCENGINE_ASR_RESOURCE_ID = "volc.seedasr.auc";
const DEFAULT_VOLCENGINE_ASR_MODEL = "bigmodel";

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

/**
 * Volcengine Seed ASR bigmodel file-recognition API.
 *
 * Two-step submit-then-poll flow. The request ID sent in the submit headers
 * doubles as the task ID for polling — the submit response body is empty `{}`.
 *
 * @see https://console.volcengine.com — 豆包语音 → 录音文件识别大模型
 */
export async function transcribeVolcengineAudio(
  params: AudioTranscriptionRequest,
): Promise<AudioTranscriptionResult> {
  const fetchFn = params.fetchFn ?? fetch;
  const baseUrl = normalizeBaseUrl(params.baseUrl, DEFAULT_VOLCENGINE_ASR_BASE_URL);
  const model = resolveModel(params.model);

  const appId = params.headers?.["X-Api-App-Id"] ?? process.env.DOUBAO_STT_APP_ID ?? "";
  const accessKey =
    params.headers?.["X-Api-Access-Key"] ?? params.apiKey ?? process.env.DOUBAO_STT_ACCESS_KEY;
  const resourceId = params.headers?.["X-Api-Resource-Id"] ?? DEFAULT_VOLCENGINE_ASR_RESOURCE_ID;

  if (!appId) {
    throw new Error("Volcengine ASR requires X-Api-App-Id header or DOUBAO_STT_APP_ID env var");
  }
  if (!accessKey) {
    throw new Error(
      "Volcengine ASR requires X-Api-Access-Key header, provider apiKey, or DOUBAO_STT_ACCESS_KEY env var",
    );
  }

  const audioBase64 = Buffer.from(params.buffer).toString("base64");
  const requestId = randomUUID();

  // Auth headers per bigmodel v3 API: X-Api-App-Key + X-Api-Access-Key + X-Api-Resource-Id.
  // X-Api-Request-Id doubles as the task ID for polling.
  const commonHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-App-Key": appId,
    "X-Api-Access-Key": accessKey,
    "X-Api-Resource-Id": resourceId,
    "X-Api-Request-Id": requestId,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 60_000);

  try {
    // Step 1: Submit — body is { user, audio }; response is HTTP 200 with empty `{}`
    const submitUrl = `${baseUrl}/auc/${model}/submit`;
    const submitRes = await fetchFn(submitUrl, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({
        user: { uid: "openclaw-stt" },
        audio: {
          data: audioBase64,
          format: resolveAudioFormat(params.mime),
        },
      }),
      signal: controller.signal,
    });

    // The bigmodel API returns status via X-Api-Status-Code header when present,
    // or just HTTP 200 with empty body on success.
    const submitStatus = submitRes.headers.get("X-Api-Status-Code");
    if (submitStatus && submitStatus !== "20000000") {
      const message = submitRes.headers.get("X-Api-Message") ?? (await readBodyMessage(submitRes));
      throw new Error(`Volcengine ASR submit failed (status ${submitStatus}): ${message}`);
    }
    if (!submitRes.ok) {
      const message = await readBodyMessage(submitRes);
      throw new Error(`Volcengine ASR submit failed (HTTP ${submitRes.status}): ${message}`);
    }
    // Consume body to release connection
    await submitRes.text();

    // Step 2: Poll for result using the same request ID.
    // Response is `{}` while processing, full result object once complete.
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

      if (queryStatus && queryStatus !== "20000000") {
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

/**
 * Map MIME type to Doubao audio format string.
 * @see Doubao STT integration guide — Supported Audio Formats
 */
function resolveAudioFormat(mime?: string): string {
  if (!mime) {
    return "mp3";
  }
  const lower = mime.toLowerCase();
  if (lower.includes("ogg") || lower.includes("opus")) {
    return "ogg";
  }
  if (lower.includes("mp3") || lower.includes("mpeg")) {
    return "mp3";
  }
  if (lower.includes("wav") || lower.includes("x-wav")) {
    return "wav";
  }
  if (lower.includes("mp4") || lower.includes("m4a") || lower.includes("x-m4a")) {
    return "m4a";
  }
  return "mp3";
}
