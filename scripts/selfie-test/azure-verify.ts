// A/B verify: minimal vs v2-wrap prompt on gpt-image-2 (Azure primary) for
// cozy/glam day-to-day scenes. All 6 requests in parallel.
//
// Run:
//   AZURE_OPENAI_API_KEY=... bun scripts/selfie-test/azure-verify.ts

import fs from "node:fs/promises";
import path from "node:path";
import { buildMinimalPrompt, buildV2WrapPrompt } from "../../extensions/selfie/prompt-assembly.ts";
import { callGptImage2, type GenResult } from "../../extensions/selfie/providers.ts";

const apiKey = process.env.AZURE_OPENAI_API_KEY || "";
const endpoint =
  process.env.AZURE_OPENAI_ENDPOINT || "https://xingf-mnqrf4mc-eastus2.services.ai.azure.com";
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-image-2-1";
const directKey = process.env.OPENAI_API_KEY || "";

if (!apiKey) {
  console.error("AZURE_OPENAI_API_KEY not set");
  process.exit(1);
}

const refDir = path.join(process.cwd(), "extensions/selfie/reference-images");
const refFiles = ["mh_049.jpg", "mh_053.jpg", "mh_055.jpg", "mh_058.jpg", "mh_060.jpg"];
const refs = await Promise.all(
  refFiles.map(async (f) => ({
    mimeType: "image/jpeg",
    data: (await fs.readFile(path.join(refDir, f))).toString("base64"),
  })),
);

const scenes: Array<{ id: string; style: "cozy" | "glam"; scene: string }> = [
  {
    id: "cozy-cafe",
    style: "cozy",
    scene:
      "Sitting at a minimalist cafe, holding latte, oversized cream cardigan, soft window light",
  },
  {
    id: "cozy-home",
    style: "cozy",
    scene:
      "Lying on the couch in an oversized hoodie, messy bun, blanket, watching something on laptop, warm lamp light",
  },
  {
    id: "glam-street",
    style: "glam",
    scene:
      "Golden hour on a downtown street, knit beige coat, slight smile, soft bokeh city lights behind",
  },
];

const creds = {
  azure: { endpoint, apiKey, deployment },
  direct: directKey || undefined,
};

interface Job {
  id: string;
  mode: "minimal" | "v2-wrap";
  prompt: string;
  style: "cozy" | "glam";
}

const jobs: Job[] = [];
for (const s of scenes) {
  jobs.push({
    id: s.id,
    mode: "minimal",
    prompt: buildMinimalPrompt(s.scene),
    style: s.style,
  });
  jobs.push({
    id: s.id,
    mode: "v2-wrap",
    prompt: buildV2WrapPrompt(s.scene, s.style, 1),
    style: s.style,
  });
}

console.log(`Running ${jobs.length} requests in parallel (${scenes.length} scenes × 2 modes)…`);
console.log("");

const startedAt = Date.now();
const results = await Promise.all(
  jobs.map(async (job) => {
    const t0 = Date.now();
    const res: GenResult = await callGptImage2(job.prompt, refs, creds);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    let savedPath: string | undefined;
    let sizeKb: number | undefined;
    if (res.ok) {
      savedPath = `/tmp/ab-${job.id}-${job.mode}.${res.ext}`;
      await fs.writeFile(savedPath, res.bytes);
      const stats = await fs.stat(savedPath);
      sizeKb = Math.round(stats.size / 1024);
    }
    return { job, res, elapsed, savedPath, sizeKb };
  }),
);
const totalElapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

console.log("─".repeat(72));
console.log(`Done. Total wall time: ${totalElapsed}s`);
console.log("─".repeat(72));
console.log("");

// Grouped per scene for easy A/B comparison.
for (const s of scenes) {
  const min = results.find((r) => r.job.id === s.id && r.job.mode === "minimal");
  const wrap = results.find((r) => r.job.id === s.id && r.job.mode === "v2-wrap");
  if (!min || !wrap) {
    continue;
  }
  console.log(`▸ ${s.id} (${s.style})`);
  console.log(`  scene: ${s.scene}`);
  const fmt = (r: typeof min) => {
    if (r.res.ok) {
      return `✅ ${r.elapsed}s  ${r.sizeKb}KB  ${r.savedPath}`;
    }
    const hard = r.res.hardReason ?? "";
    const shortHard = hard.length > 140 ? hard.slice(0, 140) + "…" : hard;
    return `❌ ${r.elapsed}s  ${r.res.softReason}\n      hard: ${shortHard}`;
  };
  console.log(`  minimal:  ${fmt(min)}`);
  console.log(`  v2-wrap:  ${fmt(wrap)}`);
  console.log("");
}

// Summary for quick scan
const okCount = results.filter((r) => r.res.ok).length;
console.log(`Summary: ${okCount}/${results.length} succeeded`);
if (okCount > 0) {
  console.log("");
  console.log("Open to compare:");
  for (const r of results.filter((r) => r.res.ok)) {
    console.log(`  ${r.savedPath}`);
  }
}
