#!/usr/bin/env bun
/**
 * Quality A/B: gpt-image-2 low/medium/high on 3 representative scenes.
 *
 * Probes speed vs visual-quality trade-off. high is ~120-150s/$0.165,
 * too slow for production messaging. If medium/low is "good enough" we
 * can drop latency 3-5x.
 *
 * 3 scenes × 3 qualities = 9 calls. Same prompt + same 5 face refs, only
 * the `quality` param varies. Output grouped per scene for easy diffing.
 *
 * Output: ~/tmp/gpt-image-2-test/quality-<stamp>/<scene>/<quality>.png
 *
 * Usage:
 *   OPENAI_API_KEY=sk-proj-... bun scripts/selfie-test/gpt-image-2-quality.ts
 *   OPENAI_API_KEY=sk-proj-... bun scripts/selfie-test/gpt-image-2-quality.ts --concurrency 3
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/images/edits";
const OPENAI_MODEL = "gpt-image-2";

const REF_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "extensions",
  "selfie",
  "reference-images",
);
const REFERENCE_FILENAMES = ["mh_049.png", "mh_053.png", "mh_055.png", "mh_058.png", "mh_060.png"];

type Quality = "low" | "medium" | "high";
const QUALITIES: Quality[] = ["low", "medium", "high"];

type Style = "cozy" | "glam";
type Scene = { id: string; style: Style; prompt: string };

const SCENES: Scene[] = [
  {
    id: "C1-couch-hoodie-laptop",
    style: "cozy",
    prompt:
      "Candid home selfie on the couch. Wearing an oversized cream hoodie with the hood down and comfy grey shorts, curled up with a laptop on her lap, blanket half-draped. Messy bun, bare face, soft warm lamp light from a floor lamp, blurred bookshelf behind. iPhone front camera shot, slight smile, one hand on the laptop keys. No makeup, relaxed Sunday evening vibe.",
  },
  {
    id: "G2-rooftop-sunset-blouse",
    style: "glam",
    prompt:
      "On a residential apartment rooftop at golden hour, skyline in soft focus behind. Wearing a flowy long-sleeve cream silk blouse buttoned up normally with a mandarin collar, tucked into wide-leg camel-colored trousers with a thin brown belt. Long hair loose and moving slightly in a gentle breeze, small delicate gold earrings. 3/4 angle, one hand lightly tucking hair behind her ear, soft warm sunset glow catching her face. Relaxed peaceful smile, polished iPhone portrait quality, warm VSCO color grading.",
  },
  {
    id: "G3-restaurant-table-dress-long-sleeve",
    style: "glam",
    prompt:
      "Seated at a warmly-lit restaurant table for two with a small flickering candle and a glass of red wine on the table. Wearing a modest long-sleeve midi-length black knit dress with a small round crew neckline (no cleavage), subtle gold necklace. Long wavy hair styled and polished, warm soft makeup, glossy lips. 3/4 angle leaning slightly forward with elbows on the table and chin resting on her folded hands. Dim warm restaurant lighting with bokeh from other tables. Polished dinner-date vibe, closed-lip smile.",
  },
];

// mirror vs-gemini prompt builder (same body prose as zhuzhu plugin)
function buildPrompt(scenePrompt: string, style: Style): string {
  const face = [
    "=== CRITICAL PRIORITY #1 — IDENTITY LOCK ===",
    "The reference photos show ONE specific woman. She must appear in the output as THE SAME RECOGNIZABLE PERSON.",
    "- Face shape, jaw, cheekbones, chin, forehead: match refs exactly",
    "- Eyes: same shape, color, eyelid fold, distance apart",
    "- Nose: same bridge height, tip shape, nostril width",
    "- Lips: same natural shape and thickness, same philtrum",
    "- Brows: same shape and density",
    "- Hair: same natural color and texture (unless scene explicitly changes it)",
    "- Skin tone: identical to references, including undertones",
    "Do NOT generate a generic 'pretty Chinese/Korean influencer' face.",
    "Do NOT drift toward a standard beauty template or smoothed beauty-app face.",
    "If the output face is not immediately recognizable as this exact woman, generation HAS FAILED.",
  ];
  const body = [
    "BODY CONSISTENCY: same signature body across generations.",
    "Adult woman (23), fit-curvy hourglass: full bust, narrow waist, wide hips, round glutes, toned thighs, athletic but soft.",
    "Preserve a clear hourglass silhouette even in casual scenes.",
    "Prefer framing that shows proportions (torso turn, slight 3/4 side angle) when it matches the scene.",
    "Do NOT flatten into slim/petite/flat-chested or bulky bodybuilder shape.",
    "Preserve believable proportions consistently.",
  ];
  const styleNotes =
    style === "glam"
      ? "STYLE: 小红书/抖音 influencer selfie, iPhone quality, subtle beauty filter, warm VSCO tones."
      : "STYLE: real unfiltered candid at home, iPhone front camera, no filter, natural light.";
  return [
    ...face,
    "",
    ...body,
    "",
    "IDENTITY LOCK: same woman from the reference face photos every generation.",
    "",
    styleNotes,
    "",
    `Scene: ${scenePrompt}`,
  ].join("\n");
}

type RunResult = { ok: true; bytes: Buffer; ms: number } | { ok: false; error: string; ms: number };

async function callOpenAI(
  prompt: string,
  refs: Array<{ name: string; buf: Buffer }>,
  apiKey: string,
  quality: Quality,
): Promise<RunResult> {
  const t0 = Date.now();
  try {
    const form = new FormData();
    form.append("model", OPENAI_MODEL);
    form.append("prompt", prompt);
    form.append("n", "1");
    form.append("size", "1024x1536");
    form.append("quality", quality);
    form.append("moderation", "low");
    form.append("output_format", "png");
    for (const r of refs) {
      form.append(
        "image[]",
        new Blob([r.buf as unknown as ArrayBuffer], { type: "image/png" }),
        r.name,
      );
    }
    const resp = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(240_000),
    });
    if (!resp.ok) {
      return {
        ok: false,
        error: `HTTP ${resp.status}: ${(await resp.text()).slice(0, 400)}`,
        ms: Date.now() - t0,
      };
    }
    const data = (await resp.json()) as {
      data?: Array<{ b64_json?: string }>;
      error?: { code?: string; message?: string };
    };
    if (data.error) {
      return { ok: false, error: `${data.error.code}: ${data.error.message}`, ms: Date.now() - t0 };
    }
    const first = data.data?.[0];
    if (!first?.b64_json) {
      return { ok: false, error: "no image", ms: Date.now() - t0 };
    }
    return { ok: true, bytes: Buffer.from(first.b64_json, "base64"), ms: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    };
  }
}

async function loadRefs() {
  return Promise.all(
    REFERENCE_FILENAMES.map(async (name) => ({
      name,
      buf: await fs.readFile(path.join(REF_DIR, name)),
    })),
  );
}

function parseArgs(argv: string[]) {
  let concurrency = 3;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--concurrency") {
      concurrency = Number(argv[++i]);
      if (!Number.isFinite(concurrency) || concurrency < 1) {
        throw new Error("bad --concurrency");
      }
    }
  }
  return { concurrency };
}

async function withLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) {
        return;
      }
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const { concurrency } = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set");
  }

  const outRoot = path.join(os.homedir(), "tmp", "gpt-image-2-test");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(outRoot, `quality-${stamp}`);
  await fs.mkdir(runDir, { recursive: true });

  const jobs: Array<{ scene: Scene; quality: Quality }> = [];
  for (const scene of SCENES) {
    for (const quality of QUALITIES) {
      jobs.push({ scene, quality });
    }
  }

  console.log(`[quality] jobs=${jobs.length} concurrency=${concurrency}`);
  console.log(`[quality] out=${runDir}`);

  const refs = await loadRefs();

  const results: Array<{
    scene: string;
    quality: Quality;
    result: string;
    ms: number;
    kb: number;
  }> = [];

  await withLimit(jobs, concurrency, async ({ scene, quality }) => {
    const sceneDir = path.join(runDir, scene.id);
    await fs.mkdir(sceneDir, { recursive: true });
    const prompt = buildPrompt(scene.prompt, scene.style);
    if (quality === QUALITIES[0]) {
      await fs.writeFile(path.join(sceneDir, "prompt.txt"), prompt);
    }
    console.log(`[${scene.id}/${quality}] start`);
    const res = await callOpenAI(prompt, refs, apiKey, quality);
    if (res.ok) {
      const outPath = path.join(sceneDir, `${quality}.png`);
      await fs.writeFile(outPath, res.bytes);
      const kb = res.bytes.length / 1024;
      results.push({ scene: scene.id, quality, result: "OK", ms: res.ms, kb });
      console.log(`[${scene.id}/${quality}] OK ${(res.ms / 1000).toFixed(1)}s ${kb.toFixed(0)}KB`);
    } else {
      await fs.writeFile(path.join(sceneDir, `${quality}.error.txt`), res.error);
      results.push({ scene: scene.id, quality, result: "FAIL", ms: res.ms, kb: 0 });
      console.log(
        `[${scene.id}/${quality}] FAIL ${(res.ms / 1000).toFixed(1)}s: ${res.error.slice(0, 150)}`,
      );
    }
  });

  // sort: scene asc then quality asc (low→medium→high display order)
  const qOrder: Record<Quality, number> = { low: 0, medium: 1, high: 2 };
  results.sort((a, b) => {
    const s = a.scene.localeCompare(b.scene);
    if (s !== 0) {
      return s;
    }
    return qOrder[a.quality] - qOrder[b.quality];
  });

  const lines = [
    `# gpt-image-2 Quality Compare`,
    ``,
    `stamp: ${stamp}`,
    ``,
    `| scene | quality | result | latency (s) | size (KB) |`,
    `|---|---|---|---|---|`,
    ...results.map(
      (r) =>
        `| ${r.scene} | ${r.quality} | ${r.result} | ${(r.ms / 1000).toFixed(1)} | ${r.kb.toFixed(0)} |`,
    ),
  ];
  await fs.writeFile(path.join(runDir, "summary.md"), lines.join("\n"));
  console.log(`\n[quality] done`);
  console.log(lines.join("\n"));
  console.log(`\nopen ${runDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
