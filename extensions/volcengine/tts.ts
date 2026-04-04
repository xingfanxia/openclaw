/**
 * Volcano Engine TTS API call — HTTP POST to the unidirectional streaming endpoint.
 *
 * Supports both v1 (seed-tts-1.0) and v2 (seed-icl-2.0 / Clone 2.0) resources.
 * v2 adds `context_texts` for per-sentence emotion/prosody control and `model_type: 4`.
 *
 * Response is newline-delimited JSON with base64-encoded audio chunks.
 */

const VOLCANO_TTS_ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";

export async function volcanoTTS(params: {
  text: string;
  appId: string;
  accessKey: string;
  resourceId: string;
  speaker: string;
  timeoutMs: number;
  /** v2 emotion context — passed as `context_texts` in additions. */
  contextTexts?: string[];
  /** Whether this is a v2 resource (adds model_type: 4 in additions). */
  isV2?: boolean;
}): Promise<Buffer> {
  const { text, appId, accessKey, resourceId, speaker, timeoutMs, contextTexts, isV2 } = params;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const additions: Record<string, unknown> = {};
    if (contextTexts?.length) {
      additions.context_texts = contextTexts;
    }
    if (isV2) {
      additions.model_type = 4;
    }

    const response = await fetch(VOLCANO_TTS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-App-Id": appId,
        "X-Api-Access-Key": accessKey,
        "X-Api-Resource-Id": resourceId,
      },
      body: JSON.stringify({
        user: { uid: "openclaw-tts" },
        req_params: {
          text,
          speaker,
          audio_params: {
            format: "mp3",
            sample_rate: 24000,
          },
          ...(Object.keys(additions).length > 0 ? { additions: JSON.stringify(additions) } : {}),
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Volcano TTS API error (${response.status})`);
    }

    const body = await response.text();
    const chunks: Buffer[] = [];

    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let parsed: { code: number; data: string | null };
      try {
        parsed = JSON.parse(trimmed) as { code: number; data: string | null };
      } catch {
        continue;
      }
      if (parsed.code === 0 && parsed.data) {
        chunks.push(Buffer.from(parsed.data, "base64"));
      } else if (parsed.code === 20000000) {
        // End-of-stream marker
        break;
      } else if (parsed.code !== 0) {
        throw new Error(`Volcano TTS stream error (code ${parsed.code})`);
      }
    }

    if (chunks.length === 0) {
      throw new Error("Volcano TTS returned no audio data");
    }

    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timeout);
  }
}
