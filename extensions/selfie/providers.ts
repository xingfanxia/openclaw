// Provider-call functions extracted from index.ts for cleaner module
// boundaries (same pattern as prompt-assembly.ts in the 2026-04-23 redesign).
// dispatch.ts imports from here; index.ts re-exports for back-compat.
//
// gpt-image-2 has TWO endpoints: Azure OpenAI (default, 10 RPM) and OpenAI
// direct (fallback). callGptImage2 tries Azure first when configured and
// transparently falls back to direct on rate-limit errors (429 or
// "rate limit" in the message). The routing layer (provider-routing.ts)
// sees a single "gpt-image-2" provider and doesn't know about the internal
// fallback — intentional separation.

import { Buffer } from "node:buffer";
import sharp from "sharp";

export const GEMINI_MODEL = "gemini-3.1-flash-image-preview";
export const DOUBAO_MODEL = "doubao-seedream-5-0-260128";
export const DOUBAO_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
export const OPENAI_DIRECT_MODEL = "gpt-image-2";
export const OPENAI_DIRECT_ENDPOINT = "https://api.openai.com/v1/images/edits";
export const AZURE_DEFAULT_DEPLOYMENT = "gpt-image-2-1";

export interface RefImage {
  mimeType: string;
  data: string; // base64
}

export type GenResult =
  | { ok: true; bytes: Buffer; ext: "png" | "jpeg"; mimeType: string }
  | { ok: false; softReason: string; hardReason?: string };

// Only tune SEXUALLY_EXPLICIT. Leave harassment / hate / dangerous at default —
// safety-matrix showed opening all 4 didn't add pass rate, and we don't want to
// weaken categories that aren't the bottleneck for 擦边 content.
// NOTE: Google still enforces a model-level "Prohibited Use Policy" hard filter
// that safetySettings cannot disable. This only opens the medium-sexual band.
const GEMINI_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
];

export async function callGemini(
  prompt: string,
  refs: RefImage[],
  apiKey: string,
): Promise<GenResult> {
  const parts: Array<Record<string, unknown>> = [
    { text: prompt },
    ...refs.map((r) => ({ inlineData: { mimeType: r.mimeType, data: r.data } })),
  ];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
        safetySettings: GEMINI_SAFETY_SETTINGS,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      softReason: "Image generation timed out or failed to connect.",
      hardReason: err instanceof Error ? err.message : String(err),
    };
  }
  if (!resp.ok) {
    const text = (await resp.text()).slice(0, 300);
    return {
      ok: false,
      softReason: "Image generation service returned an error.",
      hardReason: `HTTP ${resp.status}: ${text}`,
    };
  }
  const data = (await resp.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
      };
      finishReason?: string;
      finishMessage?: string;
    }>;
  };
  const cand = data.candidates?.[0];
  const imgPart = cand?.content?.parts?.find((p) => p.inlineData);
  if (!imgPart?.inlineData) {
    const reason = cand?.finishMessage || cand?.finishReason || "unknown";
    return {
      ok: false,
      softReason:
        "Image generation failed — the scene prompt was likely blocked by safety filters.",
      hardReason: `no image: ${reason}`,
    };
  }
  const rawBytes = Buffer.from(imgPart.inlineData.data, "base64");
  // Gemini returns PNG by default and has no output_format control. Convert
  // to JPEG (quality 90) so output ext matches Doubao + gpt-image-2 (unified
  // jpeg pipeline).
  try {
    const jpegBytes = await sharp(rawBytes).jpeg({ quality: 90 }).toBuffer();
    return { ok: true, bytes: jpegBytes, ext: "jpeg", mimeType: "image/jpeg" };
  } catch {
    // Conversion fail → fall back to original bytes with detected mime.
    const returnedMime = imgPart.inlineData.mimeType;
    const isJpeg = returnedMime === "image/jpeg" || rawBytes[0] === 0xff;
    return {
      ok: true,
      bytes: rawBytes,
      ext: isJpeg ? "jpeg" : "png",
      mimeType: isJpeg ? "image/jpeg" : "image/png",
    };
  }
}

export async function callDoubao(
  prompt: string,
  refs: RefImage[],
  apiKey: string,
): Promise<GenResult> {
  const dataUris = refs.map((r) => `data:${r.mimeType};base64,${r.data}`);
  const body = {
    model: DOUBAO_MODEL,
    prompt,
    image: dataUris,
    sequential_image_generation: "disabled",
    response_format: "url",
    size: "2K",
    stream: false,
    watermark: false,
  };
  let resp: Response;
  try {
    resp = await fetch(DOUBAO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      softReason: "Image generation timed out or failed to connect.",
      hardReason: err instanceof Error ? err.message : String(err),
    };
  }
  if (!resp.ok) {
    const text = (await resp.text()).slice(0, 400);
    const sensitive =
      text.includes("OutputImageSensitiveContentDetected") || text.includes("SensitiveContent");
    return {
      ok: false,
      softReason: sensitive
        ? "Image generation blocked — scene was too spicy for the content filter. Try a less explicit variant."
        : "Image generation service returned an error.",
      hardReason: `HTTP ${resp.status}: ${text}`,
    };
  }
  const data = (await resp.json()) as {
    data?: Array<{ url?: string; b64_json?: string }>;
    error?: { code?: string; message?: string };
  };
  if (data.error) {
    return {
      ok: false,
      softReason: "Image generation service returned an error.",
      hardReason: `${data.error.code ?? "err"}: ${data.error.message ?? "unknown"}`,
    };
  }
  const first = data.data?.[0];
  if (!first?.url && !first?.b64_json) {
    return {
      ok: false,
      softReason: "Image generation returned no image.",
      hardReason: "no image in response",
    };
  }
  let bytes: Buffer;
  let ext: "png" | "jpeg" = "jpeg";
  let mimeType = "image/jpeg";
  if (first.b64_json) {
    bytes = Buffer.from(first.b64_json, "base64");
  } else {
    const imgResp = await fetch(first.url!, { signal: AbortSignal.timeout(60_000) });
    if (!imgResp.ok) {
      return {
        ok: false,
        softReason: "Image generation succeeded but download failed.",
        hardReason: `download HTTP ${imgResp.status}`,
      };
    }
    bytes = Buffer.from(await imgResp.arrayBuffer());
  }
  // Detect png vs jpeg from the first byte of the image bytes (FFD8 = JPEG, 8950 = PNG).
  if (bytes[0] === 0x89) {
    ext = "png";
    mimeType = "image/png";
  }
  return { ok: true, bytes, ext, mimeType };
}

export interface AzureGptImage2Creds {
  /**
   * Base URL of the Azure OpenAI / AI Services resource, e.g.
   * "https://xingf-mnqrf4mc-eastus2.services.ai.azure.com". Any trailing
   * "/openai/v1" path is stripped — we build the legacy deployment-scoped
   * path internally.
   */
  endpoint: string;
  apiKey: string;
  /** Deployment name, e.g. "gpt-image-2-1". Appears in the URL, NOT as a form field. */
  deployment: string;
  /**
   * Azure API version for the images/edits REST path. Default: 2025-04-01-preview.
   * (The /openai/v1/ compat surface doesn't expose images/edits — only the
   * legacy deployment-scoped path with api-version works for image-edit.)
   */
  apiVersion?: string;
}

export interface GptImage2Creds {
  /** Azure OpenAI credentials. Tried first when set. */
  azure?: AzureGptImage2Creds;
  /** OpenAI direct API key. Used when azure is absent or hits rate-limit. */
  direct?: string;
}

const DEFAULT_AZURE_API_VERSION = "2025-04-01-preview";

// Handle the response body shape shared by both Azure and OpenAI direct
// (b64_json or url). Caller decides the ext/mime based on output_format.
async function decodeGptImage2Response(
  resp: Response,
  outExt: "png" | "jpeg",
  outMime: string,
): Promise<GenResult> {
  if (!resp.ok) {
    const text = (await resp.text()).slice(0, 400);
    const moderated =
      /moderation/i.test(text) || /safety/i.test(text) || /content_policy/i.test(text);
    return {
      ok: false,
      softReason: moderated
        ? "Image generation blocked by content filter — try a less explicit variant."
        : "Image generation service returned an error.",
      hardReason: `HTTP ${resp.status}: ${text}`,
    };
  }
  const data = (await resp.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    error?: { code?: string; message?: string };
  };
  if (data.error) {
    return {
      ok: false,
      softReason: "Image generation service returned an error.",
      hardReason: `${data.error.code ?? "err"}: ${data.error.message ?? "unknown"}`,
    };
  }
  const first = data.data?.[0];
  if (!first?.b64_json && !first?.url) {
    return {
      ok: false,
      softReason: "Image generation returned no image.",
      hardReason: "no image in response",
    };
  }
  let bytes: Buffer;
  if (first.b64_json) {
    bytes = Buffer.from(first.b64_json, "base64");
  } else {
    const imgResp = await fetch(first.url!, { signal: AbortSignal.timeout(60_000) });
    if (!imgResp.ok) {
      return {
        ok: false,
        softReason: "Image generation succeeded but download failed.",
        hardReason: `download HTTP ${imgResp.status}`,
      };
    }
    bytes = Buffer.from(await imgResp.arrayBuffer());
  }
  return { ok: true, bytes, ext: outExt, mimeType: outMime };
}

// OpenAI direct /v1/images/edits: Bearer auth, `model` form field, `image[]`
// for refs, `output_format=jpeg` to match Doubao/Azure defaults.
async function callGptImage2Direct(
  prompt: string,
  refs: RefImage[],
  apiKey: string,
): Promise<GenResult> {
  const form = new FormData();
  form.set("model", OPENAI_DIRECT_MODEL);
  form.set("prompt", prompt);
  form.set("size", "1024x1536");
  form.set("quality", "medium");
  form.set("moderation", "low");
  form.set("output_format", "jpeg");
  form.set("n", "1");
  for (const [i, ref] of refs.entries()) {
    const bytes = Buffer.from(ref.data, "base64");
    const ext = ref.mimeType === "image/png" ? "png" : "jpg";
    const blob = new Blob([bytes], { type: ref.mimeType });
    form.append("image[]", blob, `ref_${i}.${ext}`);
  }
  let resp: Response;
  try {
    resp = await fetch(OPENAI_DIRECT_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(180_000),
      body: form,
    });
  } catch (err) {
    return {
      ok: false,
      softReason: "Image generation timed out or failed to connect.",
      hardReason: err instanceof Error ? err.message : String(err),
    };
  }
  return decodeGptImage2Response(resp, "jpeg", "image/jpeg");
}

// Azure `/openai/deployments/{deployment}/images/edits?api-version=...`.
// Differs from OpenAI direct in three ways:
//   - `api-key` header (NOT Authorization: Bearer)
//   - no `model` form field (deployment is in the URL)
//   - requires `api-version` query param
// The /openai/v1/ compat surface does NOT expose images/edits — only the
// legacy deployment-scoped path works for image-edit on Azure. Ref:
// internal smoke test + Azure AI Foundry playground.
async function callGptImage2Azure(
  prompt: string,
  refs: RefImage[],
  creds: AzureGptImage2Creds,
): Promise<GenResult> {
  const base = creds.endpoint.replace(/\/$/, "").replace(/\/openai\/v1$/i, "");
  const apiVersion = creds.apiVersion ?? DEFAULT_AZURE_API_VERSION;
  const url = `${base}/openai/deployments/${creds.deployment}/images/edits?api-version=${apiVersion}`;

  const form = new FormData();
  form.set("prompt", prompt);
  form.set("size", "1024x1536");
  form.set("output_format", "jpeg");
  form.set("n", "1");
  for (const [i, ref] of refs.entries()) {
    const bytes = Buffer.from(ref.data, "base64");
    const ext = ref.mimeType === "image/png" ? "png" : "jpg";
    const blob = new Blob([bytes], { type: ref.mimeType });
    form.append("image[]", blob, `ref_${i}.${ext}`);
  }
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "api-key": creds.apiKey },
      signal: AbortSignal.timeout(180_000),
      body: form,
    });
  } catch (err) {
    return {
      ok: false,
      softReason: "Image generation timed out or failed to connect.",
      hardReason: err instanceof Error ? err.message : String(err),
    };
  }
  return decodeGptImage2Response(resp, "jpeg", "image/jpeg");
}

// Rate-limit heuristic — triggers fallback from Azure → direct.
export function isRateLimitResult(res: GenResult): boolean {
  if (res.ok) {
    return false;
  }
  const hard = (res.hardReason ?? "").toLowerCase();
  return (
    hard.includes("http 429") ||
    hard.includes("rate limit") ||
    hard.includes("ratelimit") ||
    hard.includes("too many requests") ||
    hard.includes("quota")
  );
}

// Unified gpt-image-2 caller. Tries Azure first when configured; on
// rate-limit response (429 / "rate limit" / quota), falls through to OpenAI
// direct if its key is configured. Other Azure errors (content filter,
// 5xx, network) propagate without fallback to avoid silently spending
// direct-API quota on non-rate-limit failures.
export async function callGptImage2(
  prompt: string,
  refs: RefImage[],
  creds: GptImage2Creds,
): Promise<GenResult> {
  if (creds.azure) {
    const res = await callGptImage2Azure(prompt, refs, creds.azure);
    if (res.ok) {
      return res;
    }
    if (!isRateLimitResult(res)) {
      return res;
    }
    if (!creds.direct) {
      return res; // rate-limited but no direct fallback configured
    }
    // fall through to direct
  }
  if (creds.direct) {
    return callGptImage2Direct(prompt, refs, creds.direct);
  }
  return {
    ok: false,
    softReason: "No gpt-image-2 provider configured.",
    hardReason: "neither azure nor direct openai credentials present",
  };
}

// Backwards-compat alias — callOpenAI was the previous name for the direct
// OpenAI path. It now routes through the unified callGptImage2 with only
// `direct` set, preserving behavior for callers that don't have Azure creds.
export async function callOpenAI(
  prompt: string,
  refs: RefImage[],
  apiKey: string,
): Promise<GenResult> {
  return callGptImage2(prompt, refs, { direct: apiKey });
}
