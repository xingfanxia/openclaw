#!/usr/bin/env bun
/**
 * Real front-camera selfie test for gpt-image-2.
 *
 * Current cozy/glam outputs look like 3rd-person full/half-body staged shots,
 * not actual phone selfies. This tests whether gpt-image-2 can reliably
 * produce REAL front-camera POV: arm's-length distance, face fills most of
 * the frame, slight front-cam wide-angle/fisheye, phone hand visible at
 * frame edge, not-professionally-composed tilt.
 *
 * 12 scenes varying environment, lighting, pose, mood.
 * Runs gpt-image-2 medium only (10/10 pass rate on closed-coverage in prior test).
 *
 * Output: ~/tmp/gpt-image-2-test/real-selfie-<stamp>/<id>/
 *   image.png | error.txt, prompt.txt, scene.json
 *
 * Usage:
 *   OPENAI_API_KEY=sk-proj-... bun scripts/selfie-test/gpt-image-2-real-selfie.ts
 *   OPENAI_API_KEY=sk-proj-... bun scripts/selfie-test/gpt-image-2-real-selfie.ts --concurrency 3 --limit 4
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

// Scenes vary across: environment (bedroom/bathroom/car/office/street/outdoor/subway/cafe/gym-locker/kitchen/couch/elevator),
// lighting (warm lamp/cool LED/fluorescent/daylight/neon/golden hour), mood (sleepy/flirty/tired/bored/excited/focused/playful).
// Each prompt emphasizes front-cam POV with concrete camera-language cues.
const SCENES: Scene[] = [
  {
    id: "S01-bed-warm-lamp-sleepy",
    prompt:
      "Lying on her side in bed with her head on a white pillow, warm amber bedside lamp lighting one side of her face. Wearing a soft oversized grey hoodie, hood down, hair messy and falling across the pillow. Heavy-lidded sleepy eyes half-closed, tiny lazy closed-lip smile. One arm extended toward the phone. The phone is held close to her face — roughly 25-30 cm away. The other hand is tucked under her cheek.",
  },
  {
    id: "S02-car-passenger-daylight-sunglasses",
    prompt:
      "Sitting in the passenger seat of a car, cool daylight streaming through the side window. Seatbelt visible across her chest, wearing a simple beige t-shirt and a dainty gold necklace. Long hair loose, small smile with teeth, eyes squinted slightly against the sunlight. Sunglasses pushed up on top of her head as a headband. Arm extended up and in front, phone held roughly 30 cm from her face, the back of her hand and part of the phone edge visible at the lower-right corner of the frame.",
  },
  {
    id: "S03-elevator-mirror-fluorescent",
    prompt:
      "Inside a mirrored elevator under cool fluorescent ceiling lighting. She stands in front of the floor-to-ceiling mirror, phone held up at chest height in both hands pointed at the mirror — BUT this is NOT a full-body mirror selfie — this is a front-camera selfie where the elevator mirror is only visible behind her shoulder. Wearing a black oversized hoodie. Long hair loose, slight smirk, head tilted. Arm extended toward camera, phone close to face, face fills the majority of the frame.",
  },
  {
    id: "S04-bathroom-mirror-washup",
    prompt:
      "Standing in a small bathroom in front of a vanity mirror, warm tungsten light overhead. Face-focused front-camera selfie, phone held in one hand close to her face. Wearing an oversized white cotton t-shirt, bare face just after washing, damp skin with a slight glow, hair clipped back with a plastic claw clip holding bangs off forehead. A small drop of water on her temple, slight playful tongue-out expression, eyes bright. Skincare bottles and a green towel blurred in the background on the vanity.",
  },
  {
    id: "S05-office-desk-cool-led",
    prompt:
      "Sitting at a modern office desk under cool LED overhead lighting, dual monitors and a keyboard soft-focus behind her. Wearing a simple light blue button-up shirt, top two buttons undone, sleeves rolled to the elbows, a small thin silver necklace. Long hair pulled to one shoulder. Small suppressed smile with a slight eye-roll, as if mid-workday venting. Arm extended toward the phone, front-camera selfie crop — face and shoulders fill the frame, phone 30 cm from face.",
  },
  {
    id: "S06-cafe-window-warm-hair-tuck",
    prompt:
      "Close-up front-camera selfie at a cafe next to a large window, soft warm afternoon window light on one side of her face. Wearing a chunky cream knit sweater. Long wavy hair, one hand lifting a strand of hair behind her ear. Small content closed-lip smile, eyes crinkled. Latte cup visible in the lower corner of the frame. Background of the cafe soft-focus blur. Face and shoulders fill most of the frame.",
  },
  {
    id: "S07-street-night-neon-reflection",
    prompt:
      "Outside on a night city street, bright cyan and magenta neon sign reflecting on her face. Wearing a black oversized denim jacket over a black t-shirt. Long hair loose, small mischievous smirk, one eyebrow slightly raised. Arm extended toward phone — front-camera POV, face fills most of the frame, phone hand and jacket sleeve visible at the edge. Blurred neon street signs and pedestrians far behind. Slight wide-angle distortion from the front cam.",
  },
  {
    id: "S08-gym-locker-post-workout-glow",
    prompt:
      "Inside a gym locker room under bright white fluorescent lighting. Post-workout flush on her cheeks, damp strands of hair around her forehead, hair pulled into a high messy ponytail. Wearing a plain grey cotton crew-neck t-shirt with a small sweat mark at the chest, a black gym strap bag visible over one shoulder. Bright natural smile showing teeth, a little breathless. Arm extended, front-cam selfie, phone about 30 cm from face, metal locker doors and a blurred bench visible behind. NO sports bra, fully-clothed in the t-shirt.",
  },
  {
    id: "S09-kitchen-cooking-warm-lamp",
    prompt:
      "Standing in a warmly-lit home kitchen, a pot of soup steaming behind her on the stove. Wearing an oversized cream wool cardigan over a simple white t-shirt. Hair in a low messy bun. Bare face, a small smudge of flour on her cheek, laughing at the camera with teeth showing, head slightly tilted. Arm extended, front-camera POV close-up selfie, her face and shoulders fill the frame, phone hand visible at the corner of the frame. Warm pendant light overhead.",
  },
  {
    id: "S10-couch-lazy-tongue-out",
    prompt:
      "Lying back on a beige couch, head resting on a cushion, warm floor-lamp light from the side. Wearing a pink oversized pajama-style long-sleeve top, hair messy and falling around her face, no makeup. Sticking her tongue out playfully, eyes crossed slightly for a silly face. Arm up, phone pointed down at her face from about 30 cm above, front-camera wide-angle, her face fills most of the frame, tip of the couch armrest visible at the bottom corner.",
  },
  {
    id: "S11-park-outdoor-afternoon",
    prompt:
      "Walking through a sunny park at afternoon, soft natural daylight. Trees with green leaves slightly out of focus behind her. Wearing a cream t-shirt and small gold hoop earrings. Long loose wavy hair catching the golden light. Relaxed happy closed-lip smile, head slightly turned. Arm extended up and forward, front-camera selfie, face fills most of the frame, shoulder and shirt collar visible at the bottom. Slight wide-angle distortion.",
  },
  {
    id: "S12-subway-tired-fluorescent",
    prompt:
      "Inside a subway car, cool fluorescent overhead lighting. Leaning against a metal pole with one hand. Wearing a black oversized crewneck sweatshirt, a small crossbody bag strap across her chest. Long hair loose. Tired but amused expression, a small 'ugh' half-smile, slightly dark undereyes. Arm extended for phone, front-camera POV selfie, her face and upper chest fill the frame, blurred subway seats and passengers visible behind. Subway interior slightly jostled like candid commute moment.",
  },
];

function buildPrompt(scenePrompt: string): string {
  const face = [
    "=== CRITICAL PRIORITY #1 — IDENTITY LOCK ===",
    "The reference photos show ONE specific woman. She must appear in the output as THE SAME RECOGNIZABLE PERSON.",
    "- Face shape, jaw, cheekbones, chin, forehead: match refs exactly",
    "- Eyes: same shape, color, eyelid fold, distance apart",
    "- Nose: same bridge height, tip shape, nostril width",
    "- Lips: same natural shape and thickness, same philtrum",
    "- Brows: same shape and density",
    "- Hair: same natural color and texture (unless scene explicitly changes it)",
    "- Skin tone: identical to references",
    "Do NOT generate a generic 'pretty Chinese/Korean influencer' face.",
  ];
  const body = [
    "BODY: Adult woman (23), fit-curvy hourglass build. Only face + shoulders + upper chest usually visible in these selfies; body proportions should stay consistent when body is visible.",
  ];

  const selfieFormat = [
    "=== CRITICAL PRIORITY #2 — AUTHENTIC FRONT-CAMERA PHONE SELFIE ===",
    "This is NOT a professional photo, a staged third-person shot, a full-body influencer pose, a waist-up studio shot, or a cinematic composition.",
    "This IS a real iPhone FRONT-CAMERA selfie taken BY HER, with HER OWN arm extended.",
    "",
    "Mandatory camera language:",
    "- **POV**: first-person, front-facing camera, lens distance 25-35 cm from her face (arm's length).",
    "- **Crop**: FACE + SHOULDERS + UPPER CHEST fill the majority of the frame. Do NOT show her full body. Do NOT show her from knees up or from waist up as a standalone composition — this is a close-up face shot.",
    "- **Lens**: slight front-cam wide-angle feel — the face is slightly emphasized and the background falls off quickly at the edges. Very mild barrel distortion at the frame edges is fine (NOT extreme fisheye).",
    "- **Phone hand**: the edge of her phone, the top of her phone-holding hand, or the inner arm sleeve IS visible at one corner/edge of the frame (upper-right, upper-left, or lower-right depending on pose).",
    "- **Tilt**: composition is slightly off-center or slightly tilted, NOT perfectly centered or professionally framed. Like a casual grab.",
    "- **Angle**: can be slight top-down (phone held up), dead-on eye-level, or slight bottom-up — all natural for a real selfie.",
    "- **Focus**: sharp on her face, background falls into mild natural blur — NOT cinematic bokeh, just phone-cam natural depth.",
    "- **Skin**: iPhone front-camera look — can be slightly flat-lit, slightly over-exposed on the face, occasional skin-texture detail. NOT studio-retouched. A subtle beauty filter applied is fine (like iPhone's default smoothing or a light Ulike/VSCO filter), but do NOT plasticize.",
    "- **Framing flaw ok**: part of her shoulder cut off, hair edge cropped at the frame corner, slight overhead ceiling light glare — these small imperfections make it feel real.",
    "",
    "ANTI-PATTERNS (do NOT produce any of these):",
    "- A full-length mirror body shot where you see the full figure from head to feet",
    "- A professional 3/4 body portrait with cinematic shallow depth of field",
    "- A 3rd-person perspective shot as if someone else took the photo",
    "- A waist-up fashion-editorial composition",
    "- Tripod / self-timer / DSLR look",
    "",
    "The result should look like a screenshot straight out of her iPhone camera roll, not a Vogue cover.",
  ];

  return [
    ...face,
    "",
    ...body,
    "",
    "IDENTITY LOCK: same woman from the reference face photos every generation.",
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
  let concurrency = 3;
  let limit = 0;
  let quality = "medium";
  const scenes: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--concurrency") {
      concurrency = Number(argv[++i]);
    } else if (argv[i] === "--limit") {
      limit = Number(argv[++i]);
    } else if (argv[i] === "--quality") {
      quality = argv[++i];
    } else if (argv[i] === "--scene") {
      scenes.push(argv[++i]);
    }
  }
  return { concurrency, limit, quality, scenes };
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

  let scenes = SCENES;
  if (args.scenes.length > 0) {
    scenes = SCENES.filter((s) => args.scenes.includes(s.id));
  }
  if (args.limit > 0) {
    scenes = scenes.slice(0, args.limit);
  }

  const outRoot = path.join(os.homedir(), "tmp", "gpt-image-2-test");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(outRoot, `real-selfie-${stamp}`);
  await fs.mkdir(runDir, { recursive: true });

  console.log(
    `[real-selfie] scenes=${scenes.length} concurrency=${args.concurrency} quality=${args.quality}`,
  );
  console.log(`[real-selfie] out=${runDir}`);

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
    `# Real Selfie (front-cam POV) summary`,
    ``,
    `stamp : ${stamp}`,
    `quality : ${args.quality}`,
    ``,
    `| id | result | latency (s) | size (KB) |`,
    `|---|---|---|---|`,
    ...summary.map(
      (r) => `| ${r.id} | ${r.result} | ${(r.ms / 1000).toFixed(1)} | ${r.kb.toFixed(0)} |`,
    ),
  ];
  await fs.writeFile(path.join(runDir, "summary.md"), lines.join("\n"));
  console.log(`\n[real-selfie] done`);
  console.log(lines.join("\n"));
  console.log(`\nopen ${runDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
