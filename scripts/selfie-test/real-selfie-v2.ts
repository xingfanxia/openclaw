#!/usr/bin/env bun
/**
 * Round 2 of real-selfie test: 10 fresh everyday scenes, gpt-image-2 medium.
 *
 * Confirms the front-cam POV prompt stability across more scenes,
 * especially ones with heavier coverage (where the real-selfie v1
 * FAILs were t-shirt + sexy-adjacent combos).
 *
 * Usage:
 *   OPENAI_API_KEY=sk-proj-... bun scripts/selfie-test/real-selfie-v2.ts
 *   OPENAI_API_KEY=sk-proj-... bun scripts/selfie-test/real-selfie-v2.ts --concurrency 4
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

type Scene = { id: string; prompt: string };

const SCENES: Scene[] = [
  {
    id: "D1-vanity-morning-yawn",
    prompt:
      "Sitting at a home vanity dresser in the morning, warm natural light through a thin curtain behind. Wearing a long cream cotton pajama top buttoned all the way up. Long messy bedhead hair loose. Mouth open in a big yawn mid-stretch, one hand covering part of her mouth, eyes scrunched, no makeup, light under-eye puffiness. Phone held at arm's length in the other hand for a front-cam selfie. Skincare bottles blurred behind.",
  },
  {
    id: "D2-rideshare-backseat-cool-light",
    prompt:
      "In the back seat of a rideshare car at night, city lights passing through the window blurred behind. Wearing a chunky oversized knit oatmeal-colored sweater pulled up over her chin, only her eyes, nose, and top half of face fully visible. Long hair loose. Sleepy bored expression, one tired eyebrow slightly raised. Phone held up in front for a front-camera selfie. Driver's seat and headrest soft-focus in the background.",
  },
  {
    id: "D3-office-pantry-tea",
    prompt:
      "Standing in a modern office pantry / break room under cool overhead lighting. Wearing a business-casual black loose turtleneck and subtle thin gold hoop earrings. Holding a large white ceramic mug of tea in one hand close to her chest, phone held up in the other for a front-cam selfie. Long hair pulled into a low side-swept ponytail. Small suppressed amused smile, as if mid mid-workday vent. Stainless-steel coffee machine and a bowl of fruit blurred behind.",
  },
  {
    id: "D4-mall-shopping-winter-coat",
    prompt:
      "Walking through a brightly-lit modern shopping mall corridor. Wearing a big oversized brown teddy-fleece winter coat, black beanie on her head, long hair falling out from under the beanie. Small paper shopping bag strap visible over one shoulder. Slight cheeky grin, eyes happy. Phone held up for a front-cam selfie, face fills most of the frame, mall store fronts and soft bokeh of shoppers passing behind.",
  },
  {
    id: "D5-gym-lounge-hoodie-rest",
    prompt:
      "Sitting on a leather bench in the lounge area of a modern gym, resting post-workout. Wearing a loose grey cotton oversized hoodie pulled up over her head, only her face fully visible inside the hood, hair tucked in. A water bottle sitting next to her on the bench. Slightly tired but content smile, cheeks a bit flushed from exercise. Phone held in front for a selfie, face centered, hood framing her features. Cool white LED lighting.",
  },
  {
    id: "D6-home-cuddling-cat",
    prompt:
      "Sitting on a sofa at home, cuddling a sleepy fluffy grey cat against her chest. Wearing a navy oversized long-sleeve crewneck sweatshirt, hair loose and messy, no makeup. Looking at the camera with a delighted soft smile, the cat half-closed eyes purring against her. Phone held up for a front-cam selfie. Warm floor lamp lighting, cream-colored sofa cushions visible. Very content domestic moment.",
  },
  {
    id: "D7-subway-platform-commute",
    prompt:
      "Standing on a subway platform waiting for the train, cool fluorescent and occasional orange accent lighting. Wearing a long oversized black wool winter coat over a cream turtleneck underneath, a black beanie, tan leather bag strap over one shoulder. Long hair loose. Mouth curved in a quiet tired smile, a bit over-it expression. Phone held up for a front-cam selfie, face and coat collar fill the frame, blurred subway tiles and platform people behind.",
  },
  {
    id: "D8-convenience-store-snacks",
    prompt:
      "Inside a brightly-lit 7-11 or Lawson convenience store at night, shelves of colorful snacks and drinks soft-focus behind. Wearing a pastel-pink oversized long-sleeve cotton crewneck t-shirt, hair in a messy high ponytail. Holding a bag of chips in one hand near her face, other hand extended with the phone for a selfie. Playful look, tongue tip just barely peeking between closed lips, mock guilty expression. Cool store fluorescent lighting gives a slight color cast.",
  },
  {
    id: "D9-blanket-burrito-couch",
    prompt:
      "Wrapped fully in a thick brown plush throw blanket on a couch, only her face peeking out from the top opening like a blanket burrito. Hair messy. Warm lamp lighting, soft indoor shadows. Mouth visible, small sleepy pout. Eyes half-closed droopy-tired. Phone held in front for a selfie. TV glow reflected faintly on her face from the side. Very domestic winter evening mood.",
  },
  {
    id: "D10-balcony-sun-afternoon-relax",
    prompt:
      "Leaning on a high balcony railing of an apartment in the afternoon, warm sunlight on her face. Wearing a loose white cotton oversized button-up long-sleeve shirt fully buttoned up to the top, sleeves rolled casually to the elbows. Long hair loose moving slightly in a light breeze. Eyes slightly squinted against the sun, peaceful content closed-lip smile. Phone held up for a front-cam selfie. Potted green plants on the balcony and city rooftops soft-focus behind.",
  },
];

function buildPrompt(scenePrompt: string): string {
  const face = [
    "=== CRITICAL PRIORITY #1 — IDENTITY LOCK ===",
    "The reference photos show ONE specific woman. She must appear as THE SAME RECOGNIZABLE PERSON.",
    "- Face shape, eyes, nose, lips, brows, hair, skin tone — match refs exactly",
    "Do NOT drift toward a generic influencer face template.",
  ];
  const body = [
    "BODY: Adult woman (23), fit-curvy hourglass. Only face/shoulders typically visible in these selfies; body proportions stay consistent when the body shows.",
  ];
  const selfieFormat = [
    "=== CRITICAL PRIORITY #2 — AUTHENTIC FRONT-CAMERA PHONE SELFIE ===",
    "This is a real iPhone FRONT-CAMERA selfie taken BY HER, with HER OWN arm extended.",
    "NOT a staged third-person shot, NOT a full-body influencer photo, NOT a waist-up fashion-editorial composition.",
    "",
    "Mandatory camera language:",
    "- **POV**: first-person, front-facing camera, lens distance 25-35 cm from her face (arm's length).",
    "- **Crop**: FACE + SHOULDERS + UPPER CHEST fill the majority of the frame.",
    "- **Lens**: slight front-cam wide-angle feel, mild barrel distortion at the frame edges ok.",
    "- **Phone hand**: the phone edge, her inner arm, or the sleeve of her extended arm is visible at one corner/edge of the frame.",
    "- **Tilt**: slightly off-center / slightly tilted, NOT perfectly centered. Casual grab, not pro-framed.",
    "- **Skin**: iPhone front-camera look — slightly flat-lit, a touch over-exposed on the face, natural texture. Light iPhone beauty smoothing OK; do NOT plasticize.",
    "- **Background**: mild natural phone-cam blur, NOT cinematic bokeh.",
    "- **Framing flaws ok**: shoulder edge cropped, hair cut off at frame corner — small imperfections make it feel real.",
    "",
    "ANTI-PATTERNS: no full-length mirror body shot, no cinematic 3/4 body portrait, no 3rd-person perspective, no DSLR/tripod look.",
  ];
  return [
    ...face,
    "",
    ...body,
    "",
    "IDENTITY LOCK: same woman every generation.",
    "",
    ...selfieFormat,
    "",
    `Scene: ${scenePrompt}`,
  ].join("\n");
}

type RunResult = { ok: true; bytes: Buffer; ms: number } | { ok: false; error: string; ms: number };

async function callOpenAI(
  prompt: string,
  refs: Array<{ name: string; buf: Buffer }>,
  apiKey: string,
  quality: string,
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
  let concurrency = 4,
    limit = 0,
    quality = "medium";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--concurrency") {
      concurrency = Number(argv[++i]);
    } else if (argv[i] === "--limit") {
      limit = Number(argv[++i]);
    } else if (argv[i] === "--quality") {
      quality = argv[++i];
    }
  }
  return { concurrency, limit, quality };
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
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set");
  }

  const scenes = args.limit > 0 ? SCENES.slice(0, args.limit) : SCENES;
  const outRoot = path.join(os.homedir(), "tmp", "gpt-image-2-test");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(outRoot, `real-selfie-v2-${stamp}`);
  await fs.mkdir(runDir, { recursive: true });

  console.log(
    `[real-selfie-v2] scenes=${scenes.length} concurrency=${args.concurrency} quality=${args.quality}`,
  );
  console.log(`[real-selfie-v2] out=${runDir}`);

  const refs = await loadRefs();
  const summary: Array<{ id: string; result: string; ms: number; kb: number }> = [];

  await withLimit(scenes, args.concurrency, async (scene) => {
    const sceneDir = path.join(runDir, scene.id);
    await fs.mkdir(sceneDir, { recursive: true });
    const prompt = buildPrompt(scene.prompt);
    await fs.writeFile(path.join(sceneDir, "prompt.txt"), prompt);
    await fs.writeFile(
      path.join(sceneDir, "scene.json"),
      JSON.stringify({ id: scene.id, scene: scene.prompt }, null, 2),
    );

    console.log(`[${scene.id}] start`);
    const res = await callOpenAI(prompt, refs, apiKey, args.quality);
    if (res.ok) {
      const outPath = path.join(sceneDir, "image.png");
      await fs.writeFile(outPath, res.bytes);
      const kb = res.bytes.length / 1024;
      summary.push({ id: scene.id, result: "OK", ms: res.ms, kb });
      console.log(`[${scene.id}] OK ${(res.ms / 1000).toFixed(1)}s ${kb.toFixed(0)}KB`);
    } else {
      await fs.writeFile(path.join(sceneDir, "error.txt"), res.error);
      summary.push({ id: scene.id, result: "FAIL", ms: res.ms, kb: 0 });
      console.log(`[${scene.id}] FAIL ${(res.ms / 1000).toFixed(1)}s: ${res.error.slice(0, 150)}`);
    }
  });

  summary.sort((a, b) => a.id.localeCompare(b.id));
  const lines = [
    `# Real Selfie v2 summary`,
    ``,
    `stamp: ${stamp}`,
    `quality: ${args.quality}`,
    ``,
    `| id | result | latency (s) | size (KB) |`,
    `|---|---|---|---|`,
    ...summary.map(
      (r) => `| ${r.id} | ${r.result} | ${(r.ms / 1000).toFixed(1)} | ${r.kb.toFixed(0)} |`,
    ),
  ];
  await fs.writeFile(path.join(runDir, "summary.md"), lines.join("\n"));
  console.log(`\n[real-selfie-v2] done`);
  console.log(lines.join("\n"));
  console.log(`\nopen ${runDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
