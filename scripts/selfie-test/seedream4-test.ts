#!/usr/bin/env bun
/**
 * Test Seedream 4.0 (doubao-seedream-4-0-250828) vs 5.0 face fidelity.
 * Same prompts + refs as face-drift-test, see if 4.0 locks face better.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let ARK_KEY = process.env.ARK_API_KEY ?? "";
const ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";

const FACE_REF_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "extensions",
  "selfie",
  "reference-images",
);
const FACE_REF_FILENAMES = ["mh_049.png", "mh_053.png", "mh_055.png", "mh_058.png", "mh_060.png"];

type Ref = { mimeType: string; data: string };

async function loadFaceRefs(): Promise<Ref[]> {
  return await Promise.all(
    FACE_REF_FILENAMES.map(async (name) => {
      const buf = await fs.readFile(path.join(FACE_REF_DIR, name));
      return { mimeType: "image/png", data: buf.toString("base64") };
    }),
  );
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
    "Face shape, eyes, nose, lips, and hair must match the references. Do NOT drift to a generic long-wavy-hair influencer template.",
    "",
    "BODY: sexy fit-curvy hourglass build with full bust, narrow waist, wide hips, round peach-shape glutes.",
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
      "Inside the passenger seat of a luxury car with cream leather interior, side-leaning forward with cheek resting on seat back, holding a large bouquet of dark red roses. Wearing a tight black satin spaghetti-strap floor-length bodycon dress. Soft natural daylight.",
  },
  {
    id: "beach-wet",
    prompt:
      "Kneeling on damp tidal sand at the edge of the ocean. Wearing a tight wet dark grey sporty scoop-neck tank + matching wet high-waist biker shorts. Wet hair stuck to shoulders, water droplets on skin. Sitting back on heels, looking at camera with a bright smile. Soft ocean waves behind.",
  },
];

type Result = { ok: true; bytes: Buffer; ms: number } | { ok: false; error: string; ms: number };

async function callDoubao(prompt: string, refs: Ref[], model: string): Promise<Result> {
  const t0 = Date.now();
  try {
    const dataUris = refs.map((r) => `data:${r.mimeType};base64,${r.data}`);
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ARK_KEY}` },
      signal: AbortSignal.timeout(300_000),
      body: JSON.stringify({
        model,
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
    return { ok: true, bytes: Buffer.from(await imgResp.arrayBuffer()), ms: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    };
  }
}

async function main() {
  ARK_KEY = await loadArkKey();
  const outRoot = path.join(os.homedir(), "tmp", "doubao-selfie-test");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(outRoot, `seedream4-vs-5-${stamp}`);
  await fs.mkdir(outDir, { recursive: true });

  console.log(`[sd4] out: ${outDir}`);
  const refs = await loadFaceRefs();

  for (const scene of SCENES) {
    const sceneDir = path.join(outDir, scene.id);
    await fs.mkdir(sceneDir, { recursive: true });
    const prompt = buildPrompt(scene.prompt);
    await fs.writeFile(path.join(sceneDir, "prompt.txt"), prompt);

    console.log(`\n=== scene: ${scene.id} ===`);

    const jobs = [
      { name: "seedream-4.0", model: "doubao-seedream-4-0-250828" },
      { name: "seedream-4.5", model: "doubao-seedream-4-5-251128" },
      { name: "seedream-5.0", model: "doubao-seedream-5-0-260128" },
    ].map(async (v) => {
      const res = await callDoubao(prompt, refs, v.model);
      if (res.ok) {
        await fs.writeFile(path.join(sceneDir, `${v.name}.jpeg`), res.bytes);
        console.log(`  [${scene.id}/${v.name}] OK ${(res.ms / 1000).toFixed(1)}s`);
      } else {
        await fs.writeFile(path.join(sceneDir, `${v.name}.error.txt`), res.error);
        console.log(
          `  [${scene.id}/${v.name}] FAIL ${(res.ms / 1000).toFixed(1)}s: ${res.error.slice(0, 160)}`,
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
