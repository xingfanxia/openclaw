#!/usr/bin/env bun
/**
 * Compare Gemini vs Doubao Seedream for selfie generation.
 *
 * Uses the same 5 reference face images + same prompt builder as the
 * selfie plugin, generates one image from each model in parallel, and
 * writes them side-by-side to ~/tmp/doubao-selfie-test/<timestamp>/.
 *
 * Usage:
 *   bun scripts/selfie-test/compare-selfie.ts cozy "Lying on couch, oversized hoodie, warm lamp"
 *   bun scripts/selfie-test/compare-selfie.ts glam "Cafe, oversized cream cardigan, latte"
 *   bun scripts/selfie-test/compare-selfie.ts --only doubao cozy "..."
 *   bun scripts/selfie-test/compare-selfie.ts --only gemini glam "..."
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Reads from env first, then falls back to plugins.entries.selfie.config.doubaoApiKey in ~/.openclaw/openclaw.json (see loadArkKey()).
let ARK_KEY = process.env.ARK_API_KEY ?? "";
const DOUBAO_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const DOUBAO_MODEL = "doubao-seedream-5-0-260128";

const GEMINI_MODEL = "gemini-3.1-flash-image-preview";

const REF_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "extensions",
  "selfie",
  "reference-images",
);
const REFERENCE_FILENAMES = ["mh_049.png", "mh_053.png", "mh_055.png", "mh_058.png", "mh_060.png"];

type SelfieStyle = "cozy" | "glam";

// Mirrors extensions/selfie/index.ts buildPrompt exactly so comparison is apples-to-apples.
function buildPrompt(scenePrompt: string, style: SelfieStyle): string {
  const face = [
    "These reference photos show the person's FACE — preserve her exact facial features,",
    "eyes, nose, lips, face shape, skin tone, and hair.",
    "Skin quality should look well-maintained and clear from consistent skincare: natural texture is fine,",
    "but avoid obvious acne clusters, inflamed red breakouts, or prominent irritation patches on the face.",
    "BLUSH/REDNESS: keep cheek color minimal and natural — at most a very faint, soft pink flush.",
    "Do NOT paint heavy rosy/red patches on the cheeks; it looks like sunburn or allergic reaction, not cute.",
    "Her skin tone is even and clear, not ruddy. If the scene is warm/post-workout, a subtle healthy glow is fine but no bright red cheeks.",
  ];

  const body = [
    "CRITICAL BODY CONSISTENCY: keep the same signature body across every generation.",
    "She is an adult woman (23) with a sexy fit-curvy hourglass build: very full bust, narrow waist,",
    "wide hips, round glutes, thick toned thighs, athletic but soft.",
    "This body must read obviously busty and curvy (大胸、大屁股、蜜桃臀、S曲线) while staying photorealistic.",
    "PRIORITY RULE: preserve a clear hourglass silhouette in the final photo even when the scene is casual.",
    "Bust projection and glute/hip volume should remain visually prominent in framing, outfit fit, and pose.",
    "WARDROBE PREFERENCE: she knows her body is attractive and naturally picks outfits that show her shape.",
    "Even in casual/home scenes, prefer comfy but curve-aware pieces (fitted tank/tee, cropped top, leggings, shorts, body-skimming loungewear).",
    "VISUAL READABILITY: composition, pose, and outfit must clearly show bust-waist-hip contrast in the final photo.",
    "Prefer framing and angles that make curves obvious (e.g., mirror selfie, slight torso turn, hand-on-waist, natural hip emphasis, 3/4 side angle).",
    "Avoid loose/boxy straight-cut outfits or flat front-facing poses that hide the silhouette unless explicitly requested in the scene.",
    "Do NOT flatten into slim/petite/flat-chested, straight rectangular body, under-emphasized hips/glutes, or bulky bodybuilder shape.",
    "If a requested angle would hide curves, keep the same scene but adjust to a nearby angle that preserves body readability.",
    "Preserve believable proportions and keep shape consistent across outfits, poses, and camera angles.",
  ];

  const styleNotes =
    style === "glam"
      ? [
          "IMPORTANT STYLE NOTES — this must look like a Chinese social media influencer (网红) selfie:",
          "- Shot on iPhone, high quality but not professional camera",
          "- Subtle beauty filter applied — skin is smooth and luminous but not plastic",
          "- Warm color grading, slightly lifted shadows, soft contrast (like a VSCO or Ulike filter)",
          "- NOT overly edited or AI-looking — it should look real but polished",
          "- The composition should feel intentionally casual (摆拍) — 'effortlessly pretty'",
          "- Outfit should be intentionally figure-flattering and curve-emphasizing",
          "- She is photogenic and knows her angles",
        ]
      : [
          "IMPORTANT STYLE NOTES — this must look like a real, unfiltered, candid moment at home:",
          "- Shot on iPhone front camera, casual and unplanned",
          "- NO heavy beauty filter — keep real skin texture, but complexion should still look clear and cared-for",
          "- Natural indoor lighting (warm lamp, window light, screen glow) — not flattering, just real",
          "- Slightly messy, imperfect framing — she's not trying to look good, she just IS",
          "- Hair can be messy, tangled, in a lazy bun or clip",
          "- Minimal or zero makeup — bare face, maybe leftover mascara",
          "- Casual outfit can be relaxed, but still naturally body-flattering (not baggy/shape-hiding by default)",
          "- Use cozy but curve-friendly framing (mirror, seated twist, slight side angle) so chest/waist/hips stay visible",
          "- The vibe is 'boyfriend's POV' or 'sent this to my bf without thinking'",
        ];

  const styleLine =
    style === "glam"
      ? "Style: photorealistic Chinese social media selfie, iPhone quality, subtle beauty filter, warm tones, influencer aesthetic. NOT studio photography, NOT AI art — specifically 小红书/抖音 Chinese internet aesthetic."
      : "Style: photorealistic candid home selfie, iPhone front camera, no filter, no makeup, raw and natural. NOT polished, NOT influencer — just a real girl at home being herself.";

  return [
    ...face,
    "",
    ...body,
    "",
    "IDENTITY LOCK: this is always the same woman from the reference face photos.",
    "Do not drift identity, age, ethnicity, or core body proportions between generations.",
    "",
    ...styleNotes,
    "",
    `Scene: ${scenePrompt}`,
    "",
    styleLine,
  ].join("\n");
}

async function loadRefsAsBase64(): Promise<
  Array<{ mimeType: string; data: string; path: string }>
> {
  return await Promise.all(
    REFERENCE_FILENAMES.map(async (name) => {
      const p = path.join(REF_DIR, name);
      const buf = await fs.readFile(p);
      return { mimeType: "image/png", data: buf.toString("base64"), path: p };
    }),
  );
}

async function loadGeminiKey(): Promise<string> {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  // Pull from openclaw.json (plugins.entries.selfie.config.geminiApiKey)
  const cfgPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  const raw = await fs.readFile(cfgPath, "utf8");
  const cfg = JSON.parse(raw) as {
    plugins?: { entries?: { selfie?: { config?: { geminiApiKey?: string } } } };
  };
  const key = cfg.plugins?.entries?.selfie?.config?.geminiApiKey;
  if (!key) {
    throw new Error("No GEMINI_API_KEY env and no selfie.geminiApiKey in openclaw.json");
  }
  return key;
}

async function loadArkKey(): Promise<string> {
  if (process.env.ARK_API_KEY) {
    return process.env.ARK_API_KEY;
  }
  const cfgPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  const raw = await fs.readFile(cfgPath, "utf8");
  const cfg = JSON.parse(raw) as {
    plugins?: { entries?: { selfie?: { config?: { doubaoApiKey?: string } } } };
  };
  const key = cfg.plugins?.entries?.selfie?.config?.doubaoApiKey;
  if (!key) {
    throw new Error("No ARK_API_KEY env and no selfie.doubaoApiKey in openclaw.json");
  }
  return key;
}

type ProviderResult =
  | { ok: true; file: string; ms: number }
  | { ok: false; error: string; ms: number };

async function runGemini(
  prompt: string,
  refs: Array<{ mimeType: string; data: string }>,
  outFile: string,
): Promise<ProviderResult> {
  const t0 = Date.now();
  try {
    const key = await loadGeminiKey();
    const parts: Array<Record<string, unknown>> = [
      { text: prompt },
      ...refs.map((r) => ({ inlineData: { mimeType: r.mimeType, data: r.data } })),
    ];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
    });
    if (!resp.ok) {
      return {
        ok: false,
        error: `HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`,
        ms: Date.now() - t0,
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
      return { ok: false, error: `no image in response (${reason})`, ms: Date.now() - t0 };
    }
    await fs.writeFile(outFile, Buffer.from(imgPart.inlineData.data, "base64"));
    return { ok: true, file: outFile, ms: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    };
  }
}

async function runDoubao(
  prompt: string,
  refs: Array<{ mimeType: string; data: string }>,
  outFile: string,
): Promise<ProviderResult> {
  const t0 = Date.now();
  try {
    const dataUris = refs.map((r) => `data:${r.mimeType};base64,${r.data}`);
    // Multi-ref -> single image: pass `image` as array of data URIs
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
    const resp = await fetch(DOUBAO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ARK_KEY}`,
      },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      return {
        ok: false,
        error: `HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`,
        ms: Date.now() - t0,
      };
    }
    const data = (await resp.json()) as {
      data?: Array<{ url?: string; b64_json?: string; size?: string }>;
      error?: { message?: string; code?: string };
    };
    if (data.error) {
      return {
        ok: false,
        error: `${data.error.code ?? "err"}: ${data.error.message ?? "unknown"}`,
        ms: Date.now() - t0,
      };
    }
    const first = data.data?.[0];
    if (!first?.url && !first?.b64_json) {
      return {
        ok: false,
        error: `no image in response: ${JSON.stringify(data).slice(0, 300)}`,
        ms: Date.now() - t0,
      };
    }
    let bytes: Buffer;
    if (first.url) {
      const imgResp = await fetch(first.url, { signal: AbortSignal.timeout(60_000) });
      if (!imgResp.ok) {
        return { ok: false, error: `download failed: HTTP ${imgResp.status}`, ms: Date.now() - t0 };
      }
      bytes = Buffer.from(await imgResp.arrayBuffer());
    } else {
      bytes = Buffer.from(first.b64_json!, "base64");
    }
    await fs.writeFile(outFile, bytes);
    return { ok: true, file: outFile, ms: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    };
  }
}

function parseArgs(argv: string[]): {
  only: "both" | "gemini" | "doubao";
  style: SelfieStyle;
  scene: string;
} {
  let only: "both" | "gemini" | "doubao" = "both";
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") {
      const v = argv[++i];
      if (v !== "gemini" && v !== "doubao" && v !== "both") {
        throw new Error(`--only must be gemini|doubao|both, got: ${v}`);
      }
      only = v;
    } else {
      positional.push(a);
    }
  }
  const [rawStyle, ...sceneParts] = positional;
  if (!rawStyle || (rawStyle !== "cozy" && rawStyle !== "glam")) {
    throw new Error(
      "usage: compare-selfie.ts [--only gemini|doubao|both] <cozy|glam> <scene prompt>",
    );
  }
  const scene = sceneParts.join(" ").trim();
  if (!scene) {
    throw new Error("scene prompt is required");
  }
  return { only, style: rawStyle, scene };
}

async function main() {
  const argv = process.argv.slice(2);
  const { only, style, scene } = parseArgs(argv);

  if (only !== "gemini") {
    ARK_KEY = await loadArkKey();
  }

  const outRoot = path.join(os.homedir(), "tmp", "doubao-selfie-test");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(outRoot, `${stamp}-${style}`);
  await fs.mkdir(runDir, { recursive: true });

  const prompt = buildPrompt(scene, style);
  await fs.writeFile(path.join(runDir, "prompt.txt"), prompt);
  await fs.writeFile(
    path.join(runDir, "meta.json"),
    JSON.stringify(
      {
        style,
        scene,
        only,
        promptChars: prompt.length,
        model: { gemini: GEMINI_MODEL, doubao: DOUBAO_MODEL },
      },
      null,
      2,
    ),
  );

  console.log(`[compare] scene: ${scene}`);
  console.log(`[compare] style: ${style}`);
  console.log(`[compare] only : ${only}`);
  console.log(`[compare] out  : ${runDir}`);

  console.log(`[compare] loading 5 reference images from ${REF_DIR}`);
  const refs = await loadRefsAsBase64();
  console.log(
    `[compare] refs loaded (total ${(refs.reduce((a, r) => a + r.data.length, 0) / 1024 / 1024).toFixed(1)} MB base64)`,
  );

  const jobs: Array<Promise<void>> = [];

  if (only === "both" || only === "gemini") {
    jobs.push(
      (async () => {
        console.log(`[gemini] starting…`);
        const res = await runGemini(prompt, refs, path.join(runDir, "gemini.png"));
        if (res.ok) {
          console.log(`[gemini] ok: ${res.file} (${(res.ms / 1000).toFixed(1)}s)`);
        } else {
          console.log(`[gemini] FAIL (${(res.ms / 1000).toFixed(1)}s): ${res.error}`);
        }
      })(),
    );
  }

  if (only === "both" || only === "doubao") {
    jobs.push(
      (async () => {
        console.log(`[doubao] starting…`);
        const res = await runDoubao(prompt, refs, path.join(runDir, "doubao.jpeg"));
        if (res.ok) {
          console.log(`[doubao] ok: ${res.file} (${(res.ms / 1000).toFixed(1)}s)`);
        } else {
          console.log(`[doubao] FAIL (${(res.ms / 1000).toFixed(1)}s): ${res.error}`);
        }
      })(),
    );
  }

  await Promise.all(jobs);
  console.log(`\n[done] files in ${runDir}`);
  console.log(`  open ${runDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
