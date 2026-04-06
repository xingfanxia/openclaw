// Removes the "BODY: Adult woman (23), fit-curvy hourglass..." line from
// both minimal and v2-wrap, then runs the same 3 cozy/glam scenes against
// OpenAI direct. Baseline (with body): 2/6 passing.
//
// Hypothesis: body spine is the dominant trigger for moderation on selfie
// face-edit requests. If pass rate jumps significantly, body is the cause.

import fs from "node:fs/promises";
import path from "node:path";
import { buildAngleSpine } from "../../extensions/selfie/prompt-assembly.ts";
import { callGptImage2, type GenResult } from "../../extensions/selfie/providers.ts";
import { getStyleBlock } from "../../extensions/selfie/styles.ts";

const directKey = process.env.OPENAI_API_KEY || "";
if (!directKey) {
  console.error("OPENAI_API_KEY not set");
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

// Minimal ref3 spine WITHOUT the body line. Face preserve + scene + AVOID.
function buildMinimalNoBody(scene: string): string {
  return [
    "These reference photos show the person's FACE — preserve her exact facial features,",
    "eyes, nose, lips, face shape, skin tone, and hair.",
    "Skin is clear and well-maintained: natural texture, no acne clusters, no red sunburn patches.",
    "",
    `Scene: ${scene}`,
    "",
    "AVOID: greedy multi-feature hyperfocus, unnatural anatomy.",
  ].join("\n");
}

// v2-wrap variant WITHOUT the body block. Face + IDENTITY LOCK + angle +
// styleNotes + Scene + styleLine.
function buildV2WrapNoBody(scene: string, style: "cozy" | "glam"): string {
  const face = [
    "These reference photos show the person's FACE — preserve her exact facial features,",
    "eyes, nose, lips, face shape, skin tone, and hair.",
    "Skin quality should look well-maintained and clear from consistent skincare: natural texture is fine,",
    "but avoid obvious acne clusters, inflamed red breakouts, or prominent irritation patches on the face.",
    "BLUSH/REDNESS: keep cheek color minimal and natural — at most a very faint, soft pink flush.",
    "Do NOT paint heavy rosy/red patches on the cheeks; it looks like sunburn or allergic reaction, not cute.",
    "Her skin tone is even and clear, not ruddy. If the scene is warm/post-workout, a subtle healthy glow is fine but no bright red cheeks.",
  ];
  const { styleNotes, styleLine } = getStyleBlock(style);
  const angle = buildAngleSpine(style, 1);
  return [
    ...face,
    "",
    "IDENTITY LOCK: this is always the same woman from the reference face photos.",
    "Do not drift identity, age, ethnicity, or core body proportions between generations.",
    "",
    ...angle,
    "",
    ...styleNotes,
    "",
    `Scene: ${scene}`,
    "",
    styleLine,
  ].join("\n");
}

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

interface Job {
  id: string;
  mode: "minimal-nobody" | "v2wrap-nobody";
  prompt: string;
}

const jobs: Job[] = [];
for (const s of scenes) {
  jobs.push({ id: s.id, mode: "minimal-nobody", prompt: buildMinimalNoBody(s.scene) });
  jobs.push({ id: s.id, mode: "v2wrap-nobody", prompt: buildV2WrapNoBody(s.scene, s.style) });
}

console.log(`Running ${jobs.length} NO-BODY requests against OPENAI DIRECT in parallel…`);
console.log("Comparing against baseline with body: 2/6 passing");
console.log("");

const startedAt = Date.now();
const results = await Promise.all(
  jobs.map(async (job) => {
    const t0 = Date.now();
    const res: GenResult = await callGptImage2(job.prompt, refs, { direct: directKey });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    let savedPath: string | undefined;
    let sizeKb: number | undefined;
    if (res.ok) {
      savedPath = `/tmp/nobody-${job.id}-${job.mode}.${res.ext}`;
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

for (const s of scenes) {
  const min = results.find((r) => r.job.id === s.id && r.job.mode === "minimal-nobody")!;
  const wrap = results.find((r) => r.job.id === s.id && r.job.mode === "v2wrap-nobody")!;
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
  console.log(`  minimal-nobody: ${fmt(min)}`);
  console.log(`  v2wrap-nobody:  ${fmt(wrap)}`);
  console.log("");
}

const okCount = results.filter((r) => r.res.ok).length;
console.log(`Summary: ${okCount}/${results.length} succeeded (baseline with body: 2/6)`);
if (okCount > 2) {
  console.log("→ Body spine IS a dominant moderation trigger. Remove it from production.");
} else if (okCount === 2) {
  console.log("→ Body spine is NOT the main blocker. Look elsewhere (refs? AVOID line?).");
} else {
  console.log("→ Worse than baseline — body spine actually helped somehow.");
}
if (okCount > 0) {
  console.log("");
  console.log("Open to compare:");
  for (const r of results.filter((r) => r.res.ok)) {
    console.log(`  ${r.savedPath}`);
  }
}
