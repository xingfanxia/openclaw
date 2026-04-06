#!/usr/bin/env bun
/**
 * Quick Seedream 4.5 vs 5.0 face-fidelity comparison.
 * One scene, 1K size to speed things up, full base64 refs.
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

async function loadRefs(): Promise<Ref[]> {
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
  return cfg.plugins?.entries?.selfie?.config?.doubaoApiKey ?? "";
}

async function call(
  model: string,
  prompt: string,
  refs: Ref[],
): Promise<{ ok: true; bytes: Buffer; ms: number } | { ok: false; error: string; ms: number }> {
  const t0 = Date.now();
  try {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ARK_KEY}` },
      signal: AbortSignal.timeout(360_000),
      body: JSON.stringify({
        model,
        prompt,
        image: refs.map((r) => `data:${r.mimeType};base64,${r.data}`),
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
  if (!ARK_KEY) {
    throw new Error("no ARK key");
  }

  const outRoot = path.join(os.homedir(), "tmp", "doubao-selfie-test");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(outRoot, `sd45-vs-50-${stamp}`);
  await fs.mkdir(outDir, { recursive: true });
  console.log(`[quick] out: ${outDir}`);

  const refs = await loadRefs();
  const prompt = [
    "=== IDENTITY LOCK ===",
    "The reference photos show ONE specific woman. Output must be the SAME recognizable person.",
    "Match face shape, eyes, nose, lips, and hair. Do NOT drift to a generic long-wavy-hair influencer template.",
    "",
    "BODY: sexy fit-curvy hourglass, full bust, narrow waist, wide hips, round peach glutes.",
    "",
    "Scene: Kneeling on damp sand at the edge of the ocean, wearing a tight wet dark-grey scoop-neck tank + wet high-waist biker shorts. Wet hair, water droplets, bright smile, looking into camera. Soft waves behind.",
    "",
    "Style: photorealistic Chinese 小红书 aesthetic, iPhone quality.",
  ].join("\n");

  const variants = [
    { name: "sd45-1ref", model: "doubao-seedream-4-5-251128", refCount: 1 },
    { name: "sd45-2ref", model: "doubao-seedream-4-5-251128", refCount: 2 },
    { name: "sd50-5ref", model: "doubao-seedream-5-0-260128", refCount: 5 },
  ];

  // run in parallel
  await Promise.all(
    variants.map(async (v) => {
      console.log(`[${v.name}] starting (model=${v.model}, refs=${v.refCount})`);
      const res = await call(v.model, prompt, refs.slice(0, v.refCount));
      if (res.ok) {
        await fs.writeFile(path.join(outDir, `${v.name}.jpeg`), res.bytes);
        console.log(`[${v.name}] OK ${(res.ms / 1000).toFixed(1)}s`);
      } else {
        await fs.writeFile(path.join(outDir, `${v.name}.error.txt`), res.error);
        console.log(`[${v.name}] FAIL ${(res.ms / 1000).toFixed(1)}s: ${res.error.slice(0, 200)}`);
      }
    }),
  );

  console.log(`\n[done] ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
