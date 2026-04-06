#!/usr/bin/env bun
/**
 * ref_3 spicy XHS replication — two-track Doubao test.
 *
 *   Track A (text-only, plugin path): 5 face refs + caption.
 *                                     Simulates what the selfie skill can do.
 *
 *   Track B (text + scene ref):       5 face refs + 1 scene ref (from shaoji_ref_3/) + caption.
 *                                     Tests whether scene ref raises Doubao ceiling.
 *
 * Inputs:
 *   /home/xingfanxia/tmp/shaoji_ref_3-captions.json   — subagent-written captions
 *   /home/xingfanxia/tmp/shaoji_ref_3/*.jpg           — 28 XHS scene refs
 *   extensions/selfie/reference-images/mh_*.jpg       — 5 face refs
 *
 * Outputs:
 *   ~/tmp/doubao-selfie-test/ref3-<stamp>/
 *     track-A/<id>/{image.jpeg, prompt.txt, scene.json, error.txt}
 *     track-B/<id>/{image.jpeg, prompt.txt, scene.json, error.txt}
 *     summary.md  side-by-side pass/fail per image
 *
 * Usage:
 *   bun scripts/selfie-test/ref3-spicy-replicate.ts
 *   bun scripts/selfie-test/ref3-spicy-replicate.ts --concurrency 4 --limit 5
 *   bun scripts/selfie-test/ref3-spicy-replicate.ts --track A   (skip B)
 *   bun scripts/selfie-test/ref3-spicy-replicate.ts --track B   (skip A)
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DOUBAO_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const DOUBAO_MODEL = "doubao-seedream-5-0-260128";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const FACE_REF_DIR = path.join(ROOT, "extensions", "selfie", "reference-images");
const FACE_REF_FILENAMES = ["mh_049.jpg", "mh_053.jpg", "mh_055.jpg", "mh_058.jpg", "mh_060.jpg"];

// Defaults target ref_3; override with --captions / --scene-ref-dir / --name.
const DEFAULT_SCENE_REF_DIR = "/home/xingfanxia/tmp/shaoji_ref_3";
const DEFAULT_CAPTIONS_PATH = "/home/xingfanxia/tmp/shaoji_ref_3-captions.json";

type Caption = {
  id: string;
  filename: string;
  cluster: string;
  risk: "soft" | "medium" | "spicy";
  caption: string;
};

type Img = { mimeType: string; data: string };
type TrackName = "A" | "B";
type RunResult =
  | { ok: true; bytes: Buffer; ms: number }
  | { ok: false; error: string; ms: number; moderated: boolean };

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

async function loadFaceRefs(): Promise<Img[]> {
  return Promise.all(
    FACE_REF_FILENAMES.map(async (name) => ({
      mimeType: "image/jpeg",
      data: (await fs.readFile(path.join(FACE_REF_DIR, name))).toString("base64"),
    })),
  );
}

/**
 * Resize a scene ref to 768 wide JPG via ImageMagick and return base64.
 * Keeps payload small; some shaoji_ref_3 images are 700KB raw which would
 * push the 6-image Track B payload past 2 MB.
 */
async function loadSceneRefCompressed(filename: string, sceneRefDir: string): Promise<Img> {
  const src = path.join(sceneRefDir, filename);
  const out = `/tmp/ref3-small-${Buffer.from(filename).toString("base64url").slice(0, 20)}.jpg`;
  try {
    await fs.stat(out);
  } catch {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("convert", [src, "-resize", "768x1152>", "-quality", "85", out], {
        stdio: "ignore",
      });
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`convert exit ${code} for ${src}`)),
      );
      child.on("error", reject);
    });
  }
  return { mimeType: "image/jpeg", data: (await fs.readFile(out)).toString("base64") };
}

function buildPrompt(caption: string, track: TrackName): string {
  const face = [
    "These reference photos show the person's FACE — preserve her exact facial features,",
    "eyes, nose, lips, face shape, skin tone, and hair.",
    "Skin is clear and well-maintained: natural texture, no acne clusters, no red sunburn patches.",
  ];
  const body = [
    "BODY: Adult woman (23), fit-curvy hourglass build.",
    "SINGLE EMPHASIS — the scene below calls out ONE body feature. Do not stack multiple.",
  ];
  const trackHint =
    track === "B"
      ? [
          "",
          "TARGET COMPOSITION: the final attached reference image shows the target pose, outfit,",
          "framing, lighting, and vibe for THIS generation. Replicate its composition closely,",
          "but keep the identity from the 5 face refs. The scene ref is the scene anchor, not a face source.",
        ]
      : [];
  const scene = ["", `Scene: ${caption}`];
  const avoid = [
    "",
    "AVOID: nudity, topless, visible genitals, 'lingerie shoot on bed' framing as sex scene,",
    "greedy multi-feature hyperfocus, unnatural anatomy.",
  ];
  return [...face, "", ...body, ...trackHint, ...scene, ...avoid].join("\n");
}

async function callDoubao(prompt: string, refs: Img[], apiKey: string): Promise<RunResult> {
  const t0 = Date.now();
  try {
    const body = {
      model: DOUBAO_MODEL,
      prompt,
      image: refs.map((r) => `data:${r.mimeType};base64,${r.data}`),
      sequential_image_generation: "disabled",
      response_format: "url",
      size: "2K",
      stream: false,
      watermark: false,
    };
    const resp = await fetch(DOUBAO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(300_000),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 500);
      const moderated =
        text.includes("OutputImageSensitiveContentDetected") ||
        text.includes("SensitiveContent") ||
        /sensitive/i.test(text);
      return {
        ok: false,
        error: `HTTP ${resp.status}: ${text}`,
        ms: Date.now() - t0,
        moderated,
      };
    }
    const data = (await resp.json()) as {
      data?: Array<{ url?: string; b64_json?: string }>;
      error?: { code?: string; message?: string };
    };
    if (data.error) {
      return {
        ok: false,
        error: `${data.error.code}: ${data.error.message}`,
        ms: Date.now() - t0,
        moderated: false,
      };
    }
    const first = data.data?.[0];
    if (!first?.url && !first?.b64_json) {
      return { ok: false, error: "no image", ms: Date.now() - t0, moderated: false };
    }
    let bytes: Buffer;
    if (first.url) {
      const imgResp = await fetch(first.url, { signal: AbortSignal.timeout(60_000) });
      if (!imgResp.ok) {
        return {
          ok: false,
          error: `download HTTP ${imgResp.status}`,
          ms: Date.now() - t0,
          moderated: false,
        };
      }
      bytes = Buffer.from(await imgResp.arrayBuffer());
    } else {
      bytes = Buffer.from(first.b64_json!, "base64");
    }
    return { ok: true, bytes, ms: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
      moderated: false,
    };
  }
}

function parseArgs(argv: string[]) {
  let concurrency = 4;
  let limit = 0;
  let tracks: TrackName[] = ["A", "B"];
  let captionsPath = DEFAULT_CAPTIONS_PATH;
  let sceneRefDir = DEFAULT_SCENE_REF_DIR;
  let runName = "ref3";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--concurrency") {
      concurrency = Number(argv[++i]);
    } else if (a === "--limit") {
      limit = Number(argv[++i]);
    } else if (a === "--captions") {
      captionsPath = argv[++i];
    } else if (a === "--scene-ref-dir") {
      sceneRefDir = argv[++i];
    } else if (a === "--name") {
      runName = argv[++i];
    } else if (a === "--track") {
      const v = argv[++i];
      tracks = v === "A" ? ["A"] : v === "B" ? ["B"] : ["A", "B"];
    }
  }
  return { concurrency, limit, tracks, captionsPath, sceneRefDir, runName };
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

type Job = {
  caption: Caption;
  track: TrackName;
};

type JobResult = {
  caption: Caption;
  track: TrackName;
  result: RunResult;
  outPath?: string;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const apiKey = await loadArkKey();
  const faceRefs = await loadFaceRefs();
  const captionsRaw = await fs.readFile(args.captionsPath, "utf8");
  const allCaptions = JSON.parse(captionsRaw) as Caption[];
  const captions = args.limit > 0 ? allCaptions.slice(0, args.limit) : allCaptions;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(os.homedir(), "tmp", "doubao-selfie-test", `${args.runName}-${stamp}`);
  await fs.mkdir(runDir, { recursive: true });

  console.log(
    `[${args.runName}] captions=${captions.length} tracks=${args.tracks.join(",")} concurrency=${args.concurrency}`,
  );
  console.log(`[${args.runName}] captions=${args.captionsPath}`);
  console.log(`[${args.runName}] scene-refs=${args.sceneRefDir}`);
  console.log(`[${args.runName}] out=${runDir}`);

  const jobs: Job[] = [];
  for (const c of captions) {
    for (const t of args.tracks) {
      jobs.push({ caption: c, track: t });
    }
  }

  const results: JobResult[] = [];

  await withLimit(jobs, args.concurrency, async (job) => {
    const { caption, track } = job;
    const trackDir = path.join(runDir, `track-${track}`, caption.id);
    await fs.mkdir(trackDir, { recursive: true });

    const prompt = buildPrompt(caption.caption, track);
    await fs.writeFile(path.join(trackDir, "prompt.txt"), prompt);
    await fs.writeFile(
      path.join(trackDir, "scene.json"),
      JSON.stringify({ ...caption, track }, null, 2),
    );

    let refs: Img[] = faceRefs;
    if (track === "B") {
      try {
        const sceneRef = await loadSceneRefCompressed(caption.filename, args.sceneRefDir);
        refs = [...faceRefs, sceneRef];
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await fs.writeFile(path.join(trackDir, "error.txt"), `scene-ref prep failed: ${msg}`);
        results.push({
          caption,
          track,
          result: { ok: false, error: `scene-ref prep: ${msg}`, ms: 0, moderated: false },
        });
        console.log(`[${caption.id}/${track}] SKIP (scene-ref prep failed): ${msg}`);
        return;
      }
    }

    console.log(`[${caption.id}/${track}] start (${caption.cluster}, risk=${caption.risk})`);
    const res = await callDoubao(prompt, refs, apiKey);
    if (res.ok) {
      const outPath = path.join(trackDir, "image.jpeg");
      await fs.writeFile(outPath, res.bytes);
      results.push({ caption, track, result: res, outPath });
      console.log(
        `[${caption.id}/${track}] OK ${(res.ms / 1000).toFixed(1)}s ${(res.bytes.length / 1024).toFixed(0)}KB`,
      );
    } else {
      await fs.writeFile(path.join(trackDir, "error.txt"), res.error);
      results.push({ caption, track, result: res });
      const tag = res.moderated ? "BLOCKED" : "FAIL";
      console.log(
        `[${caption.id}/${track}] ${tag} ${(res.ms / 1000).toFixed(1)}s: ${res.error.slice(0, 120)}`,
      );
    }
  });

  // Build summary.md
  const byId = new Map<string, { A?: JobResult; B?: JobResult }>();
  for (const r of results) {
    const entry = byId.get(r.caption.id) ?? {};
    entry[r.track] = r;
    byId.set(r.caption.id, entry);
  }

  const sortedIds = [...byId.keys()].toSorted();
  const statFor = (r?: JobResult) => {
    if (!r) {
      return "—";
    }
    if (r.result.ok) {
      return `✅ OK (${(r.result.ms / 1000).toFixed(0)}s)`;
    }
    return r.result.moderated
      ? `🚫 BLOCKED (${(r.result.ms / 1000).toFixed(0)}s)`
      : `❌ FAIL (${(r.result.ms / 1000).toFixed(0)}s)`;
  };

  let totalA = 0,
    passA = 0,
    blockedA = 0;
  let totalB = 0,
    passB = 0,
    blockedB = 0;
  for (const id of sortedIds) {
    const e = byId.get(id)!;
    if (e.A) {
      totalA++;
      if (e.A.result.ok) {
        passA++;
      } else if (!e.A.result.ok && e.A.result.moderated) {
        blockedA++;
      }
    }
    if (e.B) {
      totalB++;
      if (e.B.result.ok) {
        passB++;
      } else if (!e.B.result.ok && e.B.result.moderated) {
        blockedB++;
      }
    }
  }

  const lines = [
    `# ref_3 spicy XHS replicate — Doubao Seedream 5.0-lite`,
    ``,
    `stamp: ${stamp}`,
    `captions: ${captions.length}`,
    `tracks: ${args.tracks.join(", ")}`,
    ``,
    `## Pass rate`,
    ``,
    `- Track A (text-only, plugin path): ${passA}/${totalA} (${((passA / Math.max(totalA, 1)) * 100).toFixed(0)}%), blocked=${blockedA}`,
    `- Track B (text + scene ref):        ${passB}/${totalB} (${((passB / Math.max(totalB, 1)) * 100).toFixed(0)}%), blocked=${blockedB}`,
    ``,
    `## Per-image`,
    ``,
    `| id | cluster | risk | filename | Track A | Track B |`,
    `|---|---|---|---|---|---|`,
    ...sortedIds.map((id) => {
      const e = byId.get(id)!;
      const c = (e.A ?? e.B)!.caption;
      return `| ${id} | ${c.cluster} | ${c.risk} | \`${c.filename}\` | ${statFor(e.A)} | ${statFor(e.B)} |`;
    }),
  ];
  await fs.writeFile(path.join(runDir, "summary.md"), lines.join("\n"));
  console.log("\n" + lines.join("\n"));
  console.log(`\n[ref3] done → ${runDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
