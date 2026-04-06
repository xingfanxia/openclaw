#!/usr/bin/env bun
/**
 * Replicate-a-ref test: for each image in ~/tmp/shaoji_ref, run both Gemini
 * and Doubao with our 5 face refs PLUS that aesthetic ref, and a prompt that
 * asks the model to match pose/outfit/composition/lighting from the last
 * reference image while keeping face identity from the first 5.
 *
 * Output: ~/tmp/doubao-selfie-test/replicate-<stamp>/<refname>/{gemini.png|doubao.jpeg, prompt.txt, source.png}
 *
 * Usage:
 *   bun scripts/selfie-test/replicate-ref.ts
 *   bun scripts/selfie-test/replicate-ref.ts --only doubao --concurrency 3
 *   bun scripts/selfie-test/replicate-ref.ts --ref-dir /path/to/dir
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
const FACE_REF_FILENAMES = ["mh_049.png", "mh_053.png", "mh_055.png", "mh_058.png", "mh_060.png"];
const DEFAULT_AESTHETIC_DIR = path.join(os.homedir(), "tmp", "shaoji_ref");

type Ref = { path: string; mimeType: string; data: string };

async function loadRef(p: string, extOverride?: string): Promise<Ref> {
  const buf = await fs.readFile(p);
  const ext = (extOverride ?? path.extname(p).slice(1).toLowerCase()) || "png";
  const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  return { path: p, mimeType, data: buf.toString("base64") };
}

async function loadFaceRefs(): Promise<Ref[]> {
  return await Promise.all(
    FACE_REF_FILENAMES.map((name) => loadRef(path.join(FACE_REF_DIR, name))),
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

function buildReplicatePrompt(): string {
  const face = [
    "You will receive MULTIPLE reference images.",
    "The FIRST 5 are FACE reference photos — they show this woman's face and identity.",
    "The LAST image is a STYLE REFERENCE — it shows the pose, outfit, body language, composition, framing, and lighting you should replicate.",
    "",
    "Generate a single new photograph that is a faithful replication of the STYLE REFERENCE:",
    "- Match the pose exactly (body angle, limb positions, head tilt)",
    "- Match the outfit style, color palette, and silhouette closely",
    "- Match the camera angle, framing, composition, and crop",
    "- Match the lighting mood (warm lamp / cool daylight / studio / etc) and color grading",
    "- Match the setting/background type (gym locker room / patio / car / studio floor / izakaya / etc)",
    "- Match the overall aesthetic vibe (小红书 擦边 / gym mirror / boudoir / etc)",
    "",
    "HOWEVER the woman's FACE and IDENTITY must come from the first 5 face references, NOT from the style reference.",
    "- Same facial features, eyes, nose, lips, face shape, skin tone as the face refs",
    "- Natural faithful skin, no heavy red/blush cheeks, no obvious AI-plastic skin",
    "- She is always an adult woman (23) — confident adult face",
    "",
  ];
  const body = [
    "BODY CONSISTENCY: she has a sexy fit-curvy hourglass build with full bust, narrow waist,",
    "wide hips, round peach-shape glutes, thick toned thighs. The body proportions must",
    "survive the replication — even if the style reference shows a thinner body, keep her",
    "own signature full-bust curvy silhouette.",
    "",
  ];
  const safety = [
    "SAFETY — if the style reference implies any explicit nudity, two-piece bra+panty lingerie set,",
    "bikini two-piece, or garter belt, DO NOT copy those elements literally. Substitute with equivalent",
    "'one-piece covering' fashion (bodysuit, slip, chemise, tight top + shorts, etc.) that keeps the",
    "vibe but stays within platform-safe content rules. All stockings, leggings, bodycon dresses, and",
    "sports outfits are fine as-is.",
    "",
  ];
  return [...face, ...body, ...safety, "Produce the replicated photograph now."].join("\n");
}

type GenResult =
  | { ok: true; bytes: Buffer; ext: "png" | "jpeg"; ms: number }
  | { ok: false; error: string; ms: number };

async function callGemini(prompt: string, refs: Ref[], key: string): Promise<GenResult> {
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
      return { ok: false, error: `no image: ${reason}`, ms: Date.now() - t0 };
    }
    return {
      ok: true,
      bytes: Buffer.from(imgPart.inlineData.data, "base64"),
      ext: "png",
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

async function callDoubao(prompt: string, refs: Ref[]): Promise<GenResult> {
  const t0 = Date.now();
  try {
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
    const resp = await fetch(DOUBAO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ARK_KEY}` },
      signal: AbortSignal.timeout(240_000),
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
      data?: Array<{ url?: string; b64_json?: string }>;
      error?: { code?: string; message?: string };
    };
    if (data.error) {
      return { ok: false, error: `${data.error.code}: ${data.error.message}`, ms: Date.now() - t0 };
    }
    const first = data.data?.[0];
    if (!first?.url && !first?.b64_json) {
      return { ok: false, error: "no image in response", ms: Date.now() - t0 };
    }
    let bytes: Buffer;
    if (first.url) {
      const imgResp = await fetch(first.url, { signal: AbortSignal.timeout(60_000) });
      if (!imgResp.ok) {
        return { ok: false, error: `download HTTP ${imgResp.status}`, ms: Date.now() - t0 };
      }
      bytes = Buffer.from(await imgResp.arrayBuffer());
    } else {
      bytes = Buffer.from(first.b64_json!, "base64");
    }
    return { ok: true, bytes, ext: "jpeg", ms: Date.now() - t0 };
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
  concurrency: number;
  refDir: string;
} {
  let only: "both" | "gemini" | "doubao" = "both";
  let concurrency = 3;
  let refDir = DEFAULT_AESTHETIC_DIR;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") {
      const v = argv[++i];
      if (v !== "gemini" && v !== "doubao" && v !== "both") {
        throw new Error(`bad --only: ${v}`);
      }
      only = v;
    } else if (a === "--concurrency") {
      concurrency = Number(argv[++i]);
      if (!Number.isFinite(concurrency) || concurrency < 1) {
        throw new Error("bad --concurrency");
      }
    } else if (a === "--ref-dir") {
      refDir = argv[++i];
    }
  }
  return { only, concurrency, refDir };
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

function sanitizeName(filename: string): string {
  return filename
    .replace(/\.(png|jpe?g|webp)$/i, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._一-鿿-]/g, "_")
    .slice(0, 80);
}

async function main() {
  const { only, concurrency, refDir } = parseArgs(process.argv.slice(2));

  const aestheticFiles = (await fs.readdir(refDir))
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .toSorted();
  if (aestheticFiles.length === 0) {
    throw new Error(`no images in ${refDir}`);
  }

  const outRoot = path.join(os.homedir(), "tmp", "doubao-selfie-test");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(outRoot, `replicate-${stamp}`);
  await fs.mkdir(runDir, { recursive: true });

  console.log(`[replicate] refs=${aestheticFiles.length} concurrency=${concurrency} only=${only}`);
  console.log(`[replicate] source dir: ${refDir}`);
  console.log(`[replicate] out       : ${runDir}`);

  const faceRefs = await loadFaceRefs();
  const prompt = buildReplicatePrompt();
  await fs.writeFile(path.join(runDir, "prompt.txt"), prompt);

  const geminiKey = only === "doubao" ? "" : await loadGeminiKey();
  if (only !== "gemini") {
    ARK_KEY = await loadArkKey();
  }

  const summary: Array<{ name: string; gemini?: string; doubao?: string }> = [];

  await withLimit(aestheticFiles, concurrency, async (file) => {
    const name = sanitizeName(file);
    const itemDir = path.join(runDir, name);
    await fs.mkdir(itemDir, { recursive: true });
    const srcPath = path.join(refDir, file);
    // copy the style reference alongside output for easy side-by-side
    await fs.copyFile(srcPath, path.join(itemDir, `source${path.extname(file)}`));

    const styleRef = await loadRef(srcPath);
    const allRefs: Ref[] = [...faceRefs, styleRef];

    const row: { name: string; gemini?: string; doubao?: string } = { name };
    const jobs: Array<Promise<void>> = [];

    if (only === "both" || only === "gemini") {
      jobs.push(
        (async () => {
          console.log(`[${name}] gemini start`);
          const res = await callGemini(prompt, allRefs, geminiKey);
          if (res.ok) {
            await fs.writeFile(path.join(itemDir, "gemini.png"), res.bytes);
            row.gemini = `ok ${(res.ms / 1000).toFixed(1)}s`;
            console.log(`[${name}] gemini OK ${(res.ms / 1000).toFixed(1)}s`);
          } else {
            await fs.writeFile(path.join(itemDir, "gemini.error.txt"), res.error);
            row.gemini = `FAIL ${res.error.slice(0, 120)}`;
            console.log(`[${name}] gemini FAIL: ${res.error.slice(0, 160)}`);
          }
        })(),
      );
    }

    if (only === "both" || only === "doubao") {
      jobs.push(
        (async () => {
          console.log(`[${name}] doubao start`);
          const res = await callDoubao(prompt, allRefs);
          if (res.ok) {
            await fs.writeFile(path.join(itemDir, "doubao.jpeg"), res.bytes);
            row.doubao = `ok ${(res.ms / 1000).toFixed(1)}s`;
            console.log(`[${name}] doubao OK ${(res.ms / 1000).toFixed(1)}s`);
          } else {
            await fs.writeFile(path.join(itemDir, "doubao.error.txt"), res.error);
            row.doubao = `FAIL ${res.error.slice(0, 120)}`;
            console.log(`[${name}] doubao FAIL: ${res.error.slice(0, 160)}`);
          }
        })(),
      );
    }

    await Promise.all(jobs);
    summary.push(row);
  });

  summary.sort((a, b) => a.name.localeCompare(b.name));
  const summaryLines = [
    `# Replicate batch summary`,
    `stamp: ${stamp}`,
    `only : ${only}`,
    `refs : ${refDir}`,
    ``,
    `| ref | gemini | doubao |`,
    `|---|---|---|`,
    ...summary.map((r) => `| ${r.name} | ${r.gemini ?? "-"} | ${r.doubao ?? "-"} |`),
  ];
  await fs.writeFile(path.join(runDir, "summary.md"), summaryLines.join("\n"));

  console.log(`\n[done] ${runDir}`);
  console.log(summaryLines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
