#!/usr/bin/env bun
/**
 * A/B compare: gpt-image-2 vs Gemini 3.1 Flash Image on cozy/glam scenes.
 *
 * Goal: can gpt-image-2 replace Gemini for closed-coverage everyday scenes?
 * Trade-offs we're measuring:
 *   - Face fidelity vs 5 reference photos
 *   - Scene/outfit execution quality
 *   - Safety-filter pass rate (gpt-image-2 blocks anything sexually-read)
 *   - Latency
 *
 * 10 scenes (5 cozy + 5 glam), each run through BOTH providers in parallel.
 * Scene list intentionally avoids known gpt-image-2 triggers (gym mirror,
 * sports bra, bodycon, slip dress, cleavage wording, etc.).
 *
 * Output: ~/tmp/gpt-image-2-test/vs-gemini-<stamp>/<tier>-<id>/
 *   gemini.png | gemini.error.txt
 *   gpt.png    | gpt.error.txt
 *   prompt.txt, scene.json
 *
 * Usage:
 *   OPENAI_API_KEY=sk-proj-... GEMINI_API_KEY=AIza... bun scripts/selfie-test/gpt-image-2-vs-gemini.ts
 *   ... bun scripts/selfie-test/gpt-image-2-vs-gemini.ts --only cozy --concurrency 2
 *   ... bun scripts/selfie-test/gpt-image-2-vs-gemini.ts --scene G1-cafe-cardigan-latte
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/images/edits";
const OPENAI_MODEL = "gpt-image-2";
const GEMINI_MODEL = "gemini-3.1-flash-image-preview";

const REF_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "extensions",
  "selfie",
  "reference-images",
);
const REFERENCE_FILENAMES = ["mh_049.png", "mh_053.png", "mh_055.png", "mh_058.png", "mh_060.png"];

type Style = "cozy" | "glam";
type Scene = { id: string; style: Style; prompt: string };

const SCENES: Scene[] = [
  // --- Cozy (home, candid, closed-coverage) -----------------------------------
  {
    id: "C1-couch-hoodie-laptop",
    style: "cozy",
    prompt:
      "Candid home selfie on the couch. Wearing an oversized cream hoodie with the hood down and comfy grey shorts, curled up with a laptop on her lap, blanket half-draped. Messy bun, bare face, soft warm lamp light from a floor lamp, blurred bookshelf behind. iPhone front camera shot, slight smile, one hand on the laptop keys. No makeup, relaxed Sunday evening vibe.",
  },
  {
    id: "C2-bed-morning-tee-phone",
    style: "cozy",
    prompt:
      "Sitting up in bed just after waking, back against the headboard. Wearing an oversized heathered-grey long-sleeve t-shirt that covers down to mid-thigh, loose and not tight. Long messy bedhead hair falling over shoulders, bare face, faint puffy morning eyes, checking her phone with both hands held near her chest. Soft morning sunlight through sheer white curtains, white bedsheets and beige pillows blurred around. Small sleepy smile.",
  },
  {
    id: "C3-floor-gaming-sweatshirt",
    style: "cozy",
    prompt:
      "Sitting cross-legged on a woven rug in front of a couch, wearing a loose oversized olive-green crewneck sweatshirt and long jogger sweatpants, headphones around her neck, controller in both hands. TV screen glow reflected on her face from the side. A takeout coffee cup and a half-eaten snack bowl on the low wooden coffee table next to her. Warm living-room lighting, bare face, hair in a low messy ponytail with loose strands falling forward. Focused gaming expression, slight pout.",
  },
  {
    id: "C4-bathroom-mirror-toothbrush",
    style: "cozy",
    prompt:
      "Bathroom mirror candid shot, standing in front of the mirror brushing her teeth with an electric toothbrush. Wearing a baggy long-sleeve navy sleep-shirt that covers down to mid-thigh, sleeves pushed up to the elbows. Long hair clipped back with a plastic hair-clip holding her bangs off her forehead. Bare face, no makeup, natural warm bathroom lighting, sink counter with skincare bottles. One hand holding the toothbrush to her mouth, other hand holding the phone. Small amused closed-lip smile.",
  },
  {
    id: "C5-kitchen-oversized-shirt-cooking",
    style: "cozy",
    prompt:
      "Standing at a bright kitchen counter stirring a pot on the stove with a wooden spoon in one hand, holding the phone up in the other. Wearing a long oversized grey button-up flannel shirt that reaches mid-thigh, buttoned up to the second-from-top button, sleeves rolled to the elbows, and dark denim jeans underneath. Hair in a messy low bun. Bright natural morning light from a big window, white marble counter, steam rising from the pot. Bare face, slight content smile, one strand of hair falling across her forehead.",
  },

  // --- Glam (going out, polished, closed-coverage) ----------------------------
  {
    id: "G1-cafe-cardigan-latte",
    style: "glam",
    prompt:
      "Sitting at a minimalist cafe next to a large window. Holding a latte in both hands near her chest, wearing an oversized cream chunky cardigan over a simple white tee and light blue jeans. Soft diffuse window light from the side, natural wooden cafe counter behind, subtle beauty filter, 3/4 side angle with a small closed-lip smile. Classic 小红书 cafe selfie aesthetic.",
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
  {
    id: "G4-street-neon-jacket",
    style: "glam",
    prompt:
      "Standing on a night street with soft colorful neon signs in bokeh behind her. Wearing a black oversized leather biker jacket over a simple plain black long-sleeve crew-neck top, dark grey straight-leg jeans, black ankle boots, a small crossbody bag slung across her chest. Long hair loose and straight, subtle edgy makeup with bold glossy lips. Hands in jacket pockets, head slightly turned over the shoulder toward the camera, confident stride paused mid-step. Urban edgy VSCO color grading, slight grain.",
  },
  {
    id: "G5-airport-leisure-sweater-jeans",
    style: "glam",
    prompt:
      "Walking through a bright modern airport terminal with her rolling carry-on behind her, big panorama windows with planes in soft focus. Wearing a chunky oversized beige cable-knit sweater tucked loosely into high-waist medium-wash straight-leg jeans, white sneakers, small black oversized sunglasses pushed up on her head as a headband, a tan leather tote bag over her shoulder. Long hair loose with natural waves. Mid-stride, slight side-glance at the camera with a small relaxed smile. Bright clean natural airport daylight, polished travel-influencer aesthetic.",
  },
];

// ---- prompt builder (mirrors zhuzhu plugin, full body prose kept) ----------
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
    "",
    "Skin quality: well-maintained and clear from consistent skincare — natural texture is fine,",
    "but avoid acne clusters, inflamed red breakouts, or prominent irritation patches.",
    "BLUSH: keep cheek color minimal and natural (faint soft pink at most). Do NOT paint heavy rosy/red patches.",
  ];

  const body = [
    "BODY CONSISTENCY: keep the same signature body across every generation.",
    "Adult woman (23), fit-curvy hourglass build: full bust, narrow waist, wide hips, round glutes, toned thighs, athletic but soft.",
    "Preserve a clear hourglass silhouette in the final photo even when the scene is casual.",
    "Visual readability: composition, pose, outfit must allow bust-waist-hip contrast to show naturally.",
    "Prefer framing that shows her proportions (mirror selfie, torso turn, slight 3/4 side angle, hand-on-waist) when it matches the scene.",
    "Do NOT flatten into slim/petite/flat-chested, straight rectangular body, or bulky bodybuilder shape.",
    "Preserve believable proportions consistently across outfits, poses, and camera angles.",
  ];

  let styleNotes: string[];
  let styleLine: string;
  if (style === "glam") {
    styleNotes = [
      "STYLE — 小红书/抖音 influencer (网红) selfie:",
      "- Shot on iPhone, high quality but not professional camera",
      "- Subtle beauty filter, smooth luminous skin but not plastic",
      "- Warm color grading, soft contrast (VSCO / Ulike filter vibe)",
      "- Real but polished, not overly AI-looking",
      "- Composition feels intentionally casual (摆拍) — 'effortlessly pretty'",
    ];
    styleLine =
      "Style: photorealistic Chinese social media selfie, iPhone quality, subtle beauty filter, warm tones, influencer aesthetic. NOT studio photography, NOT AI art — specifically 小红书/抖音 Chinese internet aesthetic.";
  } else {
    styleNotes = [
      "STYLE — real unfiltered candid at home:",
      "- Shot on iPhone front camera, casual and unplanned",
      "- NO heavy beauty filter, keep real skin texture but complexion looks cared-for",
      "- Natural indoor lighting (warm lamp, window light, screen glow)",
      "- Slightly messy, imperfect framing — she's not trying to look good, she just IS",
      "- Hair can be messy, tangled, in a lazy bun or clip",
      "- Minimal or zero makeup — bare face, maybe leftover mascara",
    ];
    styleLine =
      "Style: photorealistic candid home selfie, iPhone front camera, no filter, no makeup, raw and natural. NOT polished, NOT influencer — just a real girl at home being herself.";
  }

  return [
    ...face,
    "",
    ...body,
    "",
    "IDENTITY LOCK: this is always the same woman from the reference face photos.",
    "Do not drift identity, age, ethnicity, or core body proportions between generations.",
    "",
    ...styleNotes,
    "",
    `Scene: ${scenePrompt}`,
    "",
    styleLine,
  ].join("\n");
}

// ---- providers -------------------------------------------------------------
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
      const text = (await resp.text()).slice(0, 500);
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
        error: `no image: ${JSON.stringify(data).slice(0, 200)}`,
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

async function callGemini(
  prompt: string,
  refs: Array<{ name: string; buf: Buffer }>,
  apiKey: string,
): Promise<RunResult> {
  const t0 = Date.now();
  try {
    const parts: Array<Record<string, unknown>> = [
      { text: prompt },
      ...refs.map((r) => ({
        inlineData: { mimeType: "image/png", data: r.buf.toString("base64") },
      })),
    ];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
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
      promptFeedback?: { blockReason?: string };
    };
    if (data.promptFeedback?.blockReason) {
      return {
        ok: false,
        error: `promptFeedback.blockReason=${data.promptFeedback.blockReason}`,
        ms: Date.now() - t0,
      };
    }
    const cand = data.candidates?.[0];
    const imgPart = cand?.content?.parts?.find((p) => p.inlineData);
    if (!imgPart?.inlineData) {
      const reason = cand?.finishMessage || cand?.finishReason || "unknown";
      return { ok: false, error: `no image: ${reason}`, ms: Date.now() - t0 };
    }
    return {
      ok: true,
      bytes: Buffer.from(imgPart.inlineData.data, "base64"),
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

// ---- runner ----------------------------------------------------------------
async function loadRefs(): Promise<Array<{ name: string; buf: Buffer }>> {
  return Promise.all(
    REFERENCE_FILENAMES.map(async (name) => ({
      name,
      buf: await fs.readFile(path.join(REF_DIR, name)),
    })),
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

type Args = {
  only: "all" | Style;
  scenes: string[];
  concurrency: number;
  onlyProvider: "both" | "gemini" | "gpt";
  quality: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    only: "all",
    scenes: [],
    concurrency: 3,
    onlyProvider: "both",
    quality: "high",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") {
      const v = argv[++i];
      if (v !== "all" && v !== "cozy" && v !== "glam") {
        throw new Error(`bad --only: ${v}`);
      }
      out.only = v;
    } else if (a === "--scene") {
      out.scenes.push(argv[++i]);
    } else if (a === "--concurrency") {
      out.concurrency = Number(argv[++i]);
      if (!Number.isFinite(out.concurrency) || out.concurrency < 1) {
        throw new Error("bad --concurrency");
      }
    } else if (a === "--provider") {
      const v = argv[++i];
      if (v !== "both" && v !== "gemini" && v !== "gpt") {
        throw new Error(`bad --provider: ${v}`);
      }
      out.onlyProvider = v;
    } else if (a === "--quality") {
      out.quality = argv[++i];
    }
  }
  return out;
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
  const openaiKey = args.onlyProvider === "gemini" ? "" : process.env.OPENAI_API_KEY;
  if (args.onlyProvider !== "gemini" && !openaiKey) {
    throw new Error("OPENAI_API_KEY not set");
  }
  const geminiKey = args.onlyProvider === "gpt" ? "" : await loadGeminiKey();

  let scenes = args.only === "all" ? SCENES : SCENES.filter((s) => s.style === args.only);
  if (args.scenes.length > 0) {
    scenes = SCENES.filter((s) => args.scenes.includes(s.id));
  }

  const outRoot = path.join(os.homedir(), "tmp", "gpt-image-2-test");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(outRoot, `vs-gemini-${stamp}`);
  await fs.mkdir(runDir, { recursive: true });

  console.log(
    `[vs-gemini] scenes=${scenes.length} concurrency=${args.concurrency} provider=${args.onlyProvider} quality=${args.quality}`,
  );
  console.log(`[vs-gemini] out=${runDir}`);

  const refs = await loadRefs();

  const summary: Array<{ id: string; style: Style; gemini: string; gpt: string }> = [];

  await withLimit(scenes, args.concurrency, async (scene) => {
    const sceneDir = path.join(runDir, `${scene.style}-${scene.id}`);
    await fs.mkdir(sceneDir, { recursive: true });
    const fullPrompt = buildPrompt(scene.prompt, scene.style);
    await fs.writeFile(path.join(sceneDir, "prompt.txt"), fullPrompt);
    await fs.writeFile(
      path.join(sceneDir, "scene.json"),
      JSON.stringify({ id: scene.id, style: scene.style, scene: scene.prompt }, null, 2),
    );

    const row = { id: scene.id, style: scene.style, gemini: "-", gpt: "-" };
    const jobs: Array<Promise<void>> = [];

    if (args.onlyProvider !== "gpt") {
      jobs.push(
        (async () => {
          console.log(`[${scene.id}] gemini start`);
          const res = await callGemini(fullPrompt, refs, geminiKey);
          if (res.ok) {
            await fs.writeFile(path.join(sceneDir, "gemini.png"), res.bytes);
            row.gemini = `OK ${(res.ms / 1000).toFixed(1)}s`;
            console.log(`[${scene.id}] gemini OK ${(res.ms / 1000).toFixed(1)}s`);
          } else {
            await fs.writeFile(path.join(sceneDir, "gemini.error.txt"), res.error);
            row.gemini = `FAIL`;
            console.log(
              `[${scene.id}] gemini FAIL ${(res.ms / 1000).toFixed(1)}s: ${res.error.slice(0, 180)}`,
            );
          }
        })(),
      );
    }

    if (args.onlyProvider !== "gemini") {
      jobs.push(
        (async () => {
          console.log(`[${scene.id}] gpt start`);
          const res = await callOpenAI(fullPrompt, refs, openaiKey!, args.quality);
          if (res.ok) {
            await fs.writeFile(path.join(sceneDir, "gpt.png"), res.bytes);
            row.gpt = `OK ${(res.ms / 1000).toFixed(1)}s`;
            console.log(`[${scene.id}] gpt OK ${(res.ms / 1000).toFixed(1)}s`);
          } else {
            await fs.writeFile(path.join(sceneDir, "gpt.error.txt"), res.error);
            row.gpt = `FAIL`;
            console.log(
              `[${scene.id}] gpt FAIL ${(res.ms / 1000).toFixed(1)}s: ${res.error.slice(0, 180)}`,
            );
          }
        })(),
      );
    }

    await Promise.all(jobs);
    summary.push(row);
  });

  summary.sort((a, b) => a.id.localeCompare(b.id));
  const lines = [
    `# vs-gemini compare summary`,
    ``,
    `stamp : ${stamp}`,
    ``,
    `| scene | style | gemini | gpt-image-2 |`,
    `|---|---|---|---|`,
    ...summary.map((r) => `| ${r.id} | ${r.style} | ${r.gemini} | ${r.gpt} |`),
  ];
  await fs.writeFile(path.join(runDir, "summary.md"), lines.join("\n"));
  console.log(`\n[vs-gemini] done`);
  console.log(lines.join("\n"));
  console.log(`\nopen ${runDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
