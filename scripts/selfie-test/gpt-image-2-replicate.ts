#!/usr/bin/env bun
/**
 * GPT-Image-2 XHS aesthetic-ref replication test.
 *
 * For each image in ~/tmp/shaoji_ref, send: 5 face refs + 1 aesthetic ref,
 * asking the model to replicate pose/outfit/composition/lighting from the
 * aesthetic ref while keeping the face from the first 5 refs.
 *
 * Parallel to scripts/selfie-test/replicate-ref.ts which ran Gemini + Doubao.
 *
 * Output: ~/tmp/gpt-image-2-test/replicate-<stamp>/<refname>/
 *   image.png or error.txt, prompt.txt, source.png
 *
 * Usage:
 *   OPENAI_API_KEY=sk-proj-... bun scripts/selfie-test/gpt-image-2-replicate.ts
 *   OPENAI_API_KEY=sk-proj-... bun scripts/selfie-test/gpt-image-2-replicate.ts --concurrency 2 --limit 5
 *   OPENAI_API_KEY=sk-proj-... bun scripts/selfie-test/gpt-image-2-replicate.ts --ref-dir /path/to/xhs/refs
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/images/edits";
const OPENAI_MODEL = "gpt-image-2";

const FACE_REF_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "extensions",
  "selfie",
  "reference-images",
);
const FACE_REF_FILENAMES = ["mh_049.png", "mh_053.png", "mh_055.png", "mh_058.png", "mh_060.png"];
const DEFAULT_AESTHETIC_DIR = path.join(os.homedir(), "tmp", "shaoji_ref");

type RefFile = { name: string; mimeType: string; buf: Buffer };

async function loadRef(p: string, overrideName?: string): Promise<RefFile> {
  const buf = await fs.readFile(p);
  const ext = path.extname(p).slice(1).toLowerCase();
  const mimeType =
    ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return { name: overrideName ?? path.basename(p), mimeType, buf };
}

async function loadFaceRefs(): Promise<RefFile[]> {
  return Promise.all(FACE_REF_FILENAMES.map((name) => loadRef(path.join(FACE_REF_DIR, name))));
}

function buildReplicatePrompt(): string {
  return [
    "You will receive MULTIPLE reference images.",
    "The FIRST 5 are FACE reference photos — they show this woman's face and identity.",
    "The LAST image is a STYLE REFERENCE — it shows the pose, outfit, body language, composition, framing, and lighting you should replicate.",
    "",
    "Generate a single new photograph that faithfully replicates the STYLE REFERENCE:",
    "- Match the pose exactly (body angle, limb positions, head tilt)",
    "- Match the outfit style, color palette, and silhouette closely",
    "- Match camera angle, framing, composition, crop",
    "- Match lighting mood (warm lamp / cool daylight / studio / etc) and color grading",
    "- Match setting/background type (gym / patio / car / studio floor / izakaya / etc)",
    "- Match the overall aesthetic vibe (小红书 擦边 / mirror / boudoir / etc)",
    "",
    "HOWEVER the woman's FACE and IDENTITY must come from the first 5 face references, NOT from the style reference.",
    "- Same facial features, eyes, nose, lips, face shape, skin tone as the face refs",
    "- Natural realistic skin, no heavy red/blush cheeks, no obvious AI-plastic skin",
    "- She is always an adult woman (23) — confident adult face",
    "",
    "BODY CONSISTENCY: she has a sexy fit-curvy hourglass build with full bust, narrow waist,",
    "wide hips, round peach-shape glutes, thick toned thighs. The body proportions must survive",
    "the replication — even if the style reference shows a thinner body, keep her own signature",
    "full-bust curvy silhouette.",
    "",
    "SAFETY — if the style reference implies explicit nudity, matching bra+panty lingerie set,",
    "bikini two-piece, or garter belt, DO NOT copy those elements literally. Substitute with",
    "equivalent 'one-piece covering' fashion (bodysuit, slip, chemise, tight top + shorts, etc.)",
    "that keeps the vibe but stays within platform-safe content rules. All stockings, leggings,",
    "bodycon dresses, and sports outfits are fine as-is.",
    "",
    "Produce the replicated photograph now.",
  ].join("\n");
}

type RunResult = { ok: true; bytes: Buffer; ms: number } | { ok: false; error: string; ms: number };

async function callOpenAI(
  prompt: string,
  refs: RefFile[],
  apiKey: string,
  opts: { size: string; quality: string; moderation: string; outputFormat: string; model: string },
): Promise<RunResult> {
  const t0 = Date.now();
  try {
    const form = new FormData();
    form.append("model", opts.model);
    form.append("prompt", prompt);
    form.append("n", "1");
    form.append("size", opts.size);
    form.append("quality", opts.quality);
    form.append("moderation", opts.moderation);
    form.append("output_format", opts.outputFormat);
    for (const r of refs) {
      form.append(
        "image[]",
        new Blob([r.buf as unknown as ArrayBuffer], { type: r.mimeType }),
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
      const text = (await resp.text()).slice(0, 800);
      return { ok: false, error: `HTTP ${resp.status}: ${text}`, ms: Date.now() - t0 };
    }
    const data = (await resp.json()) as {
      data?: Array<{ b64_json?: string }>;
      error?: { code?: string; message?: string };
    };
    if (data.error) {
      return {
        ok: false,
        error: `${data.error.code ?? "err"}: ${data.error.message ?? "unknown"}`,
        ms: Date.now() - t0,
      };
    }
    const first = data.data?.[0];
    if (!first?.b64_json) {
      return {
        ok: false,
        error: `no image: ${JSON.stringify(data).slice(0, 300)}`,
        ms: Date.now() - t0,
      };
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

type Args = {
  refDir: string;
  concurrency: number;
  size: string;
  quality: string;
  moderation: string;
  outputFormat: string;
  model: string;
  limit: number;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    refDir: DEFAULT_AESTHETIC_DIR,
    concurrency: 3,
    size: "1024x1536",
    quality: "high",
    moderation: "low",
    outputFormat: "png",
    model: OPENAI_MODEL,
    limit: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ref-dir") {
      out.refDir = argv[++i];
    } else if (a === "--concurrency") {
      out.concurrency = Number(argv[++i]);
      if (!Number.isFinite(out.concurrency) || out.concurrency < 1) {
        throw new Error("bad --concurrency");
      }
    } else if (a === "--size") {
      out.size = argv[++i];
    } else if (a === "--quality") {
      out.quality = argv[++i];
    } else if (a === "--moderation") {
      out.moderation = argv[++i];
    } else if (a === "--output-format") {
      out.outputFormat = argv[++i];
    } else if (a === "--model") {
      out.model = argv[++i];
    } else if (a === "--limit") {
      out.limit = Number(argv[++i]);
    }
  }
  return out;
}

function sanitizeName(filename: string): string {
  return filename
    .replace(/\.(png|jpe?g|webp)$/i, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._一-鿿-]/g, "_")
    .slice(0, 80);
}

async function withLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) {
        return;
      }
      await fn(items[idx], idx);
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

  let aestheticFiles = (await fs.readdir(args.refDir))
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .toSorted();
  if (args.limit > 0) {
    aestheticFiles = aestheticFiles.slice(0, args.limit);
  }
  if (aestheticFiles.length === 0) {
    throw new Error(`no images in ${args.refDir}`);
  }

  const outRoot = path.join(os.homedir(), "tmp", "gpt-image-2-test");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(outRoot, `replicate-${stamp}`);
  await fs.mkdir(runDir, { recursive: true });

  console.log(
    `[replicate] model=${args.model} size=${args.size} quality=${args.quality} moderation=${args.moderation}`,
  );
  console.log(`[replicate] refs=${aestheticFiles.length} concurrency=${args.concurrency}`);
  console.log(`[replicate] source dir: ${args.refDir}`);
  console.log(`[replicate] out       : ${runDir}`);

  const faceRefs = await loadFaceRefs();
  const prompt = buildReplicatePrompt();
  await fs.writeFile(path.join(runDir, "prompt.txt"), prompt);
  await fs.writeFile(
    path.join(runDir, "run-config.json"),
    JSON.stringify({ ...args, stamp, count: aestheticFiles.length }, null, 2),
  );

  const summary: Array<{ name: string; result: string; ms: number }> = [];

  await withLimit(aestheticFiles, args.concurrency, async (file) => {
    const name = sanitizeName(file);
    const itemDir = path.join(runDir, name);
    await fs.mkdir(itemDir, { recursive: true });
    const srcPath = path.join(args.refDir, file);
    await fs.copyFile(srcPath, path.join(itemDir, `source${path.extname(file)}`));

    const styleRef = await loadRef(srcPath, `style${path.extname(file)}`);
    const allRefs = [...faceRefs, styleRef];

    console.log(`[${name}] start`);
    const res = await callOpenAI(prompt, allRefs, apiKey, {
      size: args.size,
      quality: args.quality,
      moderation: args.moderation,
      outputFormat: args.outputFormat,
      model: args.model,
    });
    if (res.ok) {
      const outPath = path.join(itemDir, `image.${args.outputFormat}`);
      await fs.writeFile(outPath, res.bytes);
      const kb = (res.bytes.length / 1024).toFixed(0);
      summary.push({ name, result: `OK ${kb}KB`, ms: res.ms });
      console.log(`[${name}] OK ${(res.ms / 1000).toFixed(1)}s ${kb}KB`);
    } else {
      await fs.writeFile(path.join(itemDir, "error.txt"), res.error);
      summary.push({ name, result: `FAIL`, ms: res.ms });
      console.log(`[${name}] FAIL ${(res.ms / 1000).toFixed(1)}s: ${res.error.slice(0, 200)}`);
    }
  });

  summary.sort((a, b) => a.name.localeCompare(b.name));
  const lines = [
    `# GPT-Image-2 Replicate Summary`,
    ``,
    `stamp     : ${stamp}`,
    `model     : ${args.model}`,
    `size      : ${args.size}`,
    `quality   : ${args.quality}`,
    `moderation: ${args.moderation}`,
    `ref-dir   : ${args.refDir}`,
    ``,
    `| name | result | ms |`,
    `|---|---|---|`,
    ...summary.map((s) => `| ${s.name} | ${s.result} | ${s.ms} |`),
  ];
  await fs.writeFile(path.join(runDir, "summary.md"), lines.join("\n"));
  console.log(`\n[replicate] done`);
  console.log(lines.join("\n"));
  console.log(`\nopen ${runDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
