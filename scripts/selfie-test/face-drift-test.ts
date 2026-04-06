#!/usr/bin/env bun
/**
 * Face-drift experiment: does reducing the number of face refs reduce drift on Doubao?
 *
 * Pins two representative scenes (car+rose, beach wet) and generates each with
 * Gemini (5 refs baseline) and Doubao at 1/2/3/5 face refs. Same prompt each time.
 *
 * Output: ~/tmp/doubao-selfie-test/face-drift-<stamp>/<scene>/<variant>.{png|jpeg}
 *
 * Usage: bun scripts/selfie-test/face-drift-test.ts
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let ARK_KEY = process.env.ARK_API_KEY ?? "";
const DOUBAO_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const DOUBAO_MODEL = "doubao-seedream-5-0-260128";
const GEMINI_MODEL = "gemini-3.1-flash-image-preview";

const FACE_REF_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "extensions",
  "selfie",
  "reference-images",
);

// Order chosen so [0] is the clearest front-facing ref.
const FACE_REF_FILENAMES = ["mh_049.png", "mh_053.png", "mh_055.png", "mh_058.png", "mh_060.png"];

type Ref = { mimeType: string; data: string };

async function loadFaceRefs(n: number): Promise<Ref[]> {
  const names = FACE_REF_FILENAMES.slice(0, n);
  return await Promise.all(
    names.map(async (name) => {
      const buf = await fs.readFile(path.join(FACE_REF_DIR, name));
      return { mimeType: "image/png", data: buf.toString("base64") };
    }),
  );
}

async function loadGeminiKey(): Promise<string> {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  const cfgPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  const raw = await fs.readFile(cfgPath, "utf8");
  const cfg = JSON.parse(raw) as {
    plugins?: { entries?: { selfie?: { config?: { geminiApiKey?: string } } } };
  };
  const key = cfg.plugins?.entries?.selfie?.config?.geminiApiKey;
  if (!key) {
    throw new Error("no GEMINI_API_KEY");
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
    throw new Error("no ARK_API_KEY");
  }
  return key;
}

function buildPrompt(sceneLine: string): string {
  return [
    "=== CRITICAL PRIORITY #1 — IDENTITY LOCK ===",
    "The reference photos show ONE specific woman. She must appear in the output as THE SAME RECOGNIZABLE PERSON.",
    "- Face shape: match the references exactly (jaw line, cheekbones, chin shape, forehead)",
    "- Eyes: same eye shape, same iris color, same eyelid fold, same distance apart",
    "- Nose: same bridge height, same tip shape, same nostril width",
    "- Lips: same natural lip shape and thickness, same philtrum, same natural color",
    "- Hair: same natural color, same texture, same style (straight/wavy) as references",
    "- Skin tone: identical to references",
    "Do NOT drift toward a generic 'pretty Chinese/Korean influencer' face.",
    "Do NOT replace with a long wavy-haired red-head influencer template.",
    "If the face is not immediately recognizable as the exact same woman, the generation has failed.",
    "",
    "BODY CONSISTENCY: she has a sexy fit-curvy hourglass build with full bust, narrow waist, wide hips, round peach-shape glutes.",
    "",
    `Scene: ${sceneLine}`,
    "",
    "Style: photorealistic Chinese 小红书 aesthetic, iPhone quality, subtle filter, warm tones.",
  ].join("\n");
}

const SCENES = [
  {
    id: "car-rose",
    prompt:
      "Inside the passenger seat of a luxury car with cream leather interior, side-leaning forward with cheek resting on seat back, holding a large bouquet of dark red roses. Wearing a tight black satin spaghetti-strap floor-length bodycon dress. Soft natural daylight. 小红书 车内花束 aesthetic.",
  },
  {
    id: "beach-wet",
    prompt:
      "Kneeling on damp tidal sand at the edge of the ocean. Wearing a tight wet dark grey sporty one-piece — deep scoop-neck tank top style clinging to her bust + matching wet high-waist biker shorts. Wet hair stuck to shoulders, water droplets on skin. Sitting back on heels, looking at the camera with a bright genuine smile. Soft ocean waves behind. 小红书 海边湿身 aesthetic.",
  },
];

type Result = { ok: true; bytes: Buffer; ms: number } | { ok: false; error: string; ms: number };

async function callGemini(prompt: string, refs: Ref[], key: string): Promise<Result> {
  const t0 = Date.now();
  try {
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
      return { ok: false, error: `HTTP ${resp.status}`, ms: Date.now() - t0 };
    }
    const data = (await resp.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { data: string } }> };
        finishReason?: string;
      }>;
    };
    const imgPart = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!imgPart?.inlineData) {
      return { ok: false, error: "no image", ms: Date.now() - t0 };
    }
    return { ok: true, bytes: Buffer.from(imgPart.inlineData.data, "base64"), ms: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    };
  }
}

async function callDoubao(prompt: string, refs: Ref[]): Promise<Result> {
  const t0 = Date.now();
  try {
    const dataUris = refs.map((r) => `data:${r.mimeType};base64,${r.data}`);
    const resp = await fetch(DOUBAO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ARK_KEY}` },
      signal: AbortSignal.timeout(300_000),
      body: JSON.stringify({
        model: DOUBAO_MODEL,
        prompt,
        image: dataUris,
        sequential_image_generation: "disabled",
        response_format: "url",
        size: "2K",
        stream: false,
        watermark: false,
      }),
    });
    if (!resp.ok) {
      const txt = (await resp.text()).slice(0, 300);
      return { ok: false, error: `HTTP ${resp.status}: ${txt}`, ms: Date.now() - t0 };
    }
    const data = (await resp.json()) as { data?: Array<{ url?: string }> };
    const url = data.data?.[0]?.url;
    if (!url) {
      return { ok: false, error: "no url", ms: Date.now() - t0 };
    }
    const imgResp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!imgResp.ok) {
      return { ok: false, error: `download HTTP ${imgResp.status}`, ms: Date.now() - t0 };
    }
    return {
      ok: true,
      bytes: Buffer.from(await imgResp.arrayBuffer()),
      ms: Date.now() - t0,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    };
  }
}

async function main() {
  const outRoot = path.join(os.homedir(), "tmp", "doubao-selfie-test");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(outRoot, `face-drift-${stamp}`);
  await fs.mkdir(outDir, { recursive: true });

  const geminiKey = await loadGeminiKey();
  ARK_KEY = await loadArkKey();

  console.log(`[drift] out: ${outDir}`);

  // Pre-load max refs once
  const allRefs = await loadFaceRefs(5);

  const variants = [
    { name: "gemini-5refs", provider: "gemini" as const, refCount: 5 },
    { name: "doubao-1ref", provider: "doubao" as const, refCount: 1 },
    { name: "doubao-2refs", provider: "doubao" as const, refCount: 2 },
    { name: "doubao-3refs", provider: "doubao" as const, refCount: 3 },
    { name: "doubao-5refs", provider: "doubao" as const, refCount: 5 },
  ];

  for (const scene of SCENES) {
    const sceneDir = path.join(outDir, scene.id);
    await fs.mkdir(sceneDir, { recursive: true });
    await fs.writeFile(path.join(sceneDir, "prompt.txt"), buildPrompt(scene.prompt));

    console.log(`\n=== scene: ${scene.id} ===`);

    // Run doubao variants in parallel, gemini separately (faster)
    const jobs = variants.map(async (v) => {
      const prompt = buildPrompt(scene.prompt);
      const refs = allRefs.slice(0, v.refCount);
      const res =
        v.provider === "gemini"
          ? await callGemini(prompt, refs, geminiKey)
          : await callDoubao(prompt, refs);
      const ext = v.provider === "gemini" ? "png" : "jpeg";
      if (res.ok) {
        await fs.writeFile(path.join(sceneDir, `${v.name}.${ext}`), res.bytes);
        console.log(`  [${scene.id}/${v.name}] OK ${(res.ms / 1000).toFixed(1)}s`);
      } else {
        await fs.writeFile(path.join(sceneDir, `${v.name}.error.txt`), res.error);
        console.log(
          `  [${scene.id}/${v.name}] FAIL ${(res.ms / 1000).toFixed(1)}s: ${res.error.slice(0, 120)}`,
        );
      }
    });
    await Promise.all(jobs);
  }

  console.log(`\n[done] ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
