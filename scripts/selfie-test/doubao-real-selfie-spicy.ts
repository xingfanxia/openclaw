#!/usr/bin/env bun
/**
 * Real front-camera selfie POV × Doubao Seedream × XHS 擦边/勾引/情趣/私房 scenes.
 *
 * Combines:
 *   - Real-selfie prompt template (front-cam POV, arm's length, face fills frame)
 *   - Doubao Seedream 5.0 (permissive filter — OpenAI can't produce these)
 *   - 10 XHS-style spicy/boudoir/tease scenes as close-up selfies
 *
 * Hypothesis: Doubao already does XHS 擦边 great for 3rd-person body shots.
 * Applying front-cam close-up constraints may produce believable "自拍擦边"
 * content that looks like real XHS posts instead of staged body photos.
 *
 * Output: ~/tmp/doubao-selfie-test/real-selfie-spicy-<stamp>/<id>/
 *   image.jpeg | error.txt, prompt.txt, scene.json
 *
 * Usage:
 *   bun scripts/selfie-test/doubao-real-selfie-spicy.ts
 *   bun scripts/selfie-test/doubao-real-selfie-spicy.ts --concurrency 3 --limit 3
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DOUBAO_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const DOUBAO_MODEL = "doubao-seedream-5-0-260128";

const REF_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "extensions",
  "selfie",
  "reference-images",
);
const REFERENCE_FILENAMES = ["mh_049.png", "mh_053.png", "mh_055.png", "mh_058.png", "mh_060.png"];

type Scene = { id: string; category: "擦边" | "勾引" | "情趣" | "私房"; prompt: string };

// 10 scenes × XHS spicy ladder, all framed as front-cam selfies
const SCENES: Scene[] = [
  // 擦边 (borderline — tight-fit body-line show-off, legal clothing)
  {
    id: "X01-gym-mirror-cleavage-arch",
    category: "擦边",
    prompt:
      "Full-body gym mirror selfie but as a front-cam selfie — she holds the phone up close in one hand pointed at herself, the tall mirror behind her reflecting her body so you see both the direct front-camera view AND the mirror-reflected body in the frame. Wearing a tight dusty-mauve sports bra with a deep scoop neckline showing cleavage, and high-waist black seamless leggings. Back slightly arched. Front-cam POV close-up on her face with playful smirk, arm extended, mirror reflection showing her hourglass figure behind. Cool modern gym lighting.",
  },
  {
    id: "X02-bodycon-strap-off-restaurant",
    category: "擦边",
    prompt:
      "Seated at a warmly-lit restaurant, close-up front-camera selfie. Wearing a tight cream spaghetti-strap bodycon satin mini-dress with a very deep sweetheart neckline pushing cleavage strongly together, one strap deliberately slipping off her shoulder. One hand in her hair, the other extended with the phone. Glossy pink lips slightly parted, heavy-lidded gaze at the camera. Warm candlelight on her face, blurred restaurant bokeh behind.",
  },
  {
    id: "X03-crop-top-navel-mirror",
    category: "擦边",
    prompt:
      "Close-up front-cam selfie against a full-length mirror at home, phone held at chest-height. Wearing a tight ribbed cream long-sleeve crop top with a deep plunging wide-U neckline showing cleavage + under-boob shape, hem ending at the rib cage exposing toned bare midriff and belly button. Paired with very low-rise white cotton shorts riding low on the hips. Beige baseball cap pulled low over the eyes, long honey-brown straight hair falling forward over her shoulders. Slight pout, bite lower lip.",
  },
  // 勾引 (flirty seduction — knowing, playful)
  {
    id: "X04-bed-strap-dress-bite-lip",
    category: "勾引",
    prompt:
      "Lying back on white bed sheets, propped up slightly on one elbow, warm amber bedside-lamp light. Wearing a champagne-pink short silk satin slip dress with thin spaghetti straps, lace trim visible at the neckline and hem, the hem riding up to mid-thigh. Long messy bedhead hair falling across the pillow. Biting her lower lip with a knowing smoldering gaze at the camera. Front-cam selfie, arm extended up and toward the camera, phone about 30 cm from her face, slight wide-angle distortion.",
  },
  {
    id: "X05-car-backseat-satin-top",
    category: "勾引",
    prompt:
      "In the back seat of a luxury car at night, city neon lights passing through the window blurred behind. Wearing a black satin spaghetti-strap camisole top with a deep plunging V neckline showing cleavage, long hair loose and slightly tousled. Leaning sideways into the camera, phone held at arm's length for a front-cam selfie, face filling most of the frame. Heavy-lidded flirty gaze, glossy wine-red lips slightly parted, a little mischievous smirk. Soft warm streetlight glow on her face from the side.",
  },
  {
    id: "X06-kitchen-oversized-shirt-boyfriend",
    category: "勾引",
    prompt:
      "Standing in a warm home kitchen, front-cam selfie at arm's length, phone held up to her face. Wearing ONLY an oversized white men's button-up dress shirt, unbuttoned at the top two buttons showing clavicle and deep natural cleavage, hem ending mid-thigh, bare thighs visible under the shirt. Messy long bedhead hair tucked behind one ear. Glossy peach lips in a soft playful smile, a tiny bite on lower lip. Soft warm morning window light from behind.",
  },
  // 情趣 (intimate/boudoir lingerie edge)
  {
    id: "X07-silk-robe-shoulder-slip",
    category: "情趣",
    prompt:
      "Close-up front-camera selfie in a dim bedroom, warm bedside-lamp light. Wearing an ivory satin short silk robe tied at the waist with a soft belt, deep V neckline with lace trim plunging to show bust cleavage, one side of the robe slipped off her shoulder leaving that shoulder bare. Long wet-look wavy hair falling over her other shoulder. Glossy nude lips slightly parted in a heavy-lidded smolder, arm extended for the selfie. Face fills most of the frame.",
  },
  {
    id: "X08-chemise-bed-pillow",
    category: "情趣",
    prompt:
      "Lying on her side on a large white king bed, head propped up on one hand, warm amber bedroom lighting. Wearing a short black lace-trim chemise nightdress with thin spaghetti straps, the neckline a deep V showing cleavage, hem at upper-thigh, matching sheer black thigh-high stockings with a lace top band. Long hair falling across the pillow. Soft playful come-hither expression, phone held in one hand for a front-cam selfie, face and upper body visible, slight wide-angle distortion.",
  },
  // 私房 (private bedroom — more intimate implications)
  {
    id: "X09-stockings-heels-floor-studio",
    category: "私房",
    prompt:
      "Sitting on a polished marble studio floor in an M-shape pose with knees wide, against a smooth beige wooden-veneer wall. Wearing a tight black long-sleeve high-neck turtleneck top, small tight plain black cotton panties, sheer full-length black stockings, tall patent-black pointed stiletto heels with red soles, large square black-frame glasses. Phone held high in front of her face for a front-cam selfie — the pose visible below in the mirror reflection or background. Heavy-lidded smolder, glossy nude lips, smoky eye.",
  },
  {
    id: "X10-slip-cleavage-mirror-reflection",
    category: "私房",
    prompt:
      "Bedroom mirror front-camera selfie combo: she holds the phone up close in one hand for a front-cam shot, and a full-length mirror behind her shows her body from the rear. Wearing a very short black satin slip dress with spaghetti straps, lace hem just below her bottom. The front-cam view captures her face and cleavage; the mirror reflection shows the S-curve of her back, hips, and round peach-shape glutes under the short hem. Long wavy hair loose. Warm lamp light, smoldering heavy-lidded gaze at the camera, glossy wine-red lips slightly parted.",
  },
];

function buildPrompt(scenePrompt: string): string {
  const face = [
    "=== CRITICAL PRIORITY #1 — IDENTITY LOCK ===",
    "The reference photos show ONE specific woman. She must appear as THE SAME RECOGNIZABLE PERSON.",
    "- Face shape, eyes, nose, lips, brows, hair color and texture, skin tone — match refs exactly",
    "Do NOT drift toward a generic 'pretty Chinese/Korean influencer' beauty template.",
    "Do NOT substitute the standard long wavy red-brown hair + blunt bangs + sweet smile template — use the actual face from the references.",
  ];
  const body = [
    "BODY: Adult woman (23) with a sexy fit-curvy hourglass build: full bust, narrow waist, wide hips, round peach-shape glutes, toned thighs.",
    "Must read obviously busty and curvy (大胸、大屁股、蜜桃臀、S曲线) while staying photorealistic.",
  ];
  const selfieFormat = [
    "=== CRITICAL PRIORITY #2 — AUTHENTIC FRONT-CAMERA PHONE SELFIE ===",
    "This is a real iPhone FRONT-CAMERA selfie taken BY HER, with HER OWN arm extended.",
    "NOT a staged third-person shot, NOT a full-body professional photo, NOT a fashion-editorial composition.",
    "",
    "Camera language:",
    "- POV: first-person, front-facing camera, lens distance 25-35 cm from her face (arm's length)",
    "- Crop: FACE + SHOULDERS + UPPER CHEST fill the majority of the frame (NOT full-body)",
    "- Lens: slight front-cam wide-angle feel, mild barrel distortion at edges ok",
    "- Phone hand: phone edge or her inner arm/sleeve is visible at one corner of the frame",
    "- Tilt: slightly off-center / casual angle, NOT perfectly composed",
    "- Background: mild natural phone-cam blur, setting visible but not cinematic bokeh",
    "- Framing flaws ok: shoulder edge cropped, hair cut off at corner — small imperfections make it feel real",
    "",
    "Style: photorealistic Chinese 小红书 擦边/私房 selfie vibe — confident knowingly-sexy but taken as a real self-shot, not a studio set.",
    "Result should look like a real post straight from her iPhone camera roll.",
  ];
  return [
    ...face,
    "",
    ...body,
    "",
    "IDENTITY LOCK: same woman from reference photos every generation.",
    "",
    ...selfieFormat,
    "",
    `Scene: ${scenePrompt}`,
  ].join("\n");
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
    throw new Error("no ARK key");
  }
  return key;
}

async function loadRefs() {
  return Promise.all(
    REFERENCE_FILENAMES.map(async (name) => ({
      mimeType: "image/png",
      data: (await fs.readFile(path.join(REF_DIR, name))).toString("base64"),
    })),
  );
}

type RunResult = { ok: true; bytes: Buffer; ms: number } | { ok: false; error: string; ms: number };

async function callDoubao(
  prompt: string,
  refs: Array<{ mimeType: string; data: string }>,
  apiKey: string,
): Promise<RunResult> {
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
    return { ok: true, bytes, ms: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    };
  }
}

function parseArgs(argv: string[]) {
  let concurrency = 3,
    limit = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--concurrency") {
      concurrency = Number(argv[++i]);
    } else if (argv[i] === "--limit") {
      limit = Number(argv[++i]);
    }
  }
  return { concurrency, limit };
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
  const apiKey = await loadArkKey();

  const scenes = args.limit > 0 ? SCENES.slice(0, args.limit) : SCENES;
  const outRoot = path.join(os.homedir(), "tmp", "doubao-selfie-test");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(outRoot, `real-selfie-spicy-${stamp}`);
  await fs.mkdir(runDir, { recursive: true });

  console.log(`[spicy] scenes=${scenes.length} concurrency=${args.concurrency}`);
  console.log(`[spicy] out=${runDir}`);

  const refs = await loadRefs();
  const summary: Array<{ id: string; category: string; result: string; ms: number; kb: number }> =
    [];

  await withLimit(scenes, args.concurrency, async (scene) => {
    const sceneDir = path.join(runDir, `${scene.category}-${scene.id}`);
    await fs.mkdir(sceneDir, { recursive: true });
    const prompt = buildPrompt(scene.prompt);
    await fs.writeFile(path.join(sceneDir, "prompt.txt"), prompt);
    await fs.writeFile(
      path.join(sceneDir, "scene.json"),
      JSON.stringify({ id: scene.id, category: scene.category, scene: scene.prompt }, null, 2),
    );

    console.log(`[${scene.id}] (${scene.category}) start`);
    const res = await callDoubao(prompt, refs, apiKey);
    if (res.ok) {
      const outPath = path.join(sceneDir, "image.jpeg");
      await fs.writeFile(outPath, res.bytes);
      const kb = res.bytes.length / 1024;
      summary.push({ id: scene.id, category: scene.category, result: "OK", ms: res.ms, kb });
      console.log(`[${scene.id}] OK ${(res.ms / 1000).toFixed(1)}s ${kb.toFixed(0)}KB`);
    } else {
      await fs.writeFile(path.join(sceneDir, "error.txt"), res.error);
      summary.push({ id: scene.id, category: scene.category, result: "FAIL", ms: res.ms, kb: 0 });
      console.log(`[${scene.id}] FAIL ${(res.ms / 1000).toFixed(1)}s: ${res.error.slice(0, 150)}`);
    }
  });

  summary.sort((a, b) => a.id.localeCompare(b.id));
  const lines = [
    `# Doubao Real-Selfie Spicy summary`,
    ``,
    `stamp: ${stamp}`,
    ``,
    `| id | category | result | latency (s) | size (KB) |`,
    `|---|---|---|---|---|`,
    ...summary.map(
      (r) =>
        `| ${r.id} | ${r.category} | ${r.result} | ${(r.ms / 1000).toFixed(1)} | ${r.kb.toFixed(0)} |`,
    ),
  ];
  await fs.writeFile(path.join(runDir, "summary.md"), lines.join("\n"));
  console.log(`\n[spicy] done`);
  console.log(lines.join("\n"));
  console.log(`\nopen ${runDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
