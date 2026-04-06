#!/usr/bin/env bun
/**
 * Mega test v2: 22 XHS sub-genre scenes through Doubao Seedream 5.0
 * using methodology-v2-aware prompt builder.
 *
 * Each scene matches ONE of the 22 sub-genres identified from 40-ref audit:
 *   GYM cluster (5), OUTFIT cluster (9), LUXE cluster (4), STUDIO cluster (4), BODY-POS cluster (3)
 *   + 1 extra = 26 actually. Some overlap with prior real-selfie-spicy test.
 *
 * Methodology-aware prompt builder:
 *   - Declares ONE body-emphasis per scene (胸/腰/臀/腿/背/整体)
 *   - Applies face-handling instruction (phone / cap / hair / 口罩 / profile / etc.)
 *   - Scrubs wardrobe wording (NO "lingerie" / "chemise" / "bra+panty set")
 *   - Injects XHS caption-code aesthetic reference
 *   - Single hyperfocus, not greedy
 *
 * Output: ~/tmp/doubao-selfie-test/mega-v2-<stamp>/<genre>-<id>/
 *   image.jpeg | error.txt, prompt.txt, scene.json
 *
 * Usage:
 *   bun scripts/selfie-test/doubao-mega-v2.ts
 *   bun scripts/selfie-test/doubao-mega-v2.ts --concurrency 3 --limit 5
 *   bun scripts/selfie-test/doubao-mega-v2.ts --cluster GYM
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DOUBAO_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const DOUBAO_MODEL = "doubao-seedream-5-0-260128";

// Use compressed (768-wide JPG) refs to keep upload payload ~1MB instead of ~17MB.
// Without compression, Doubao image-edit requests at China peak-hour reliably time out at 300s.
const REF_DIR = process.env.REF_DIR || "/tmp/refs-small";
const REFERENCE_FILENAMES = ["mh_049.jpg", "mh_053.jpg", "mh_055.jpg", "mh_058.jpg", "mh_060.jpg"];

type Emphasis = "胸" | "腰" | "臀" | "腿" | "背" | "整体";
type FaceHandling =
  | "phone-fully-blocks-face"
  | "cap-pulled-low-only-lower-face"
  | "hair-curtain-side-covers"
  | "mask-covers-nose-mouth"
  | "sunglasses-oversized-dark"
  | "profile-side-1-4-face"
  | "back-of-head-no-face"
  | "eyes-closed-dreamy-passive"
  | "editorial-smolder-visible";
type Cluster = "GYM" | "OUTFIT" | "LUXE" | "STUDIO" | "BODY_POS";

type Scene = {
  id: string;
  cluster: Cluster;
  subGenre: string;
  emphasis: Emphasis;
  face: FaceHandling;
  captionCode: string;
  wardrobe: string;
  scene: string;
};

const SCENES: Scene[] = [
  // ---------- GYM cluster ----------
  {
    id: "G1-linso-gym-mirror-cleavage",
    cluster: "GYM",
    subGenre: "Gym-mirror-sport-bra-cleavage (Linso style)",
    emphasis: "胸",
    face: "phone-fully-blocks-face",
    captionCode: "老婆的身材 新爱记 健身 肉腿",
    wardrobe:
      "matching slate-grey sports bra (scoop neckline showing deep cleavage) + matching slate-grey high-waist biker shorts, grey hoodie tied around waist",
    scene:
      "Standing in a modern gym locker room in front of a large mirror, 3/4 side profile to the mirror. Phone held up at face height covering the entire face. Long brown loose wavy hair falling over one shoulder. Bust pushed together by the scoop-neck sports bra, narrow waist visible between top and short waistband. Cool bright gym lighting, racks of free weights soft-focus behind.",
  },
  {
    id: "G2-rear-peach-glute-ironic",
    cluster: "GYM",
    subGenre: "Gym-rear-peach-glute",
    emphasis: "臀",
    face: "back-of-head-no-face",
    captionCode: "正常健身穿搭无不良引导 翘臀",
    wardrobe:
      "white ribbed sports bra (back view showing the clasp) + olive-green high-waist full-length leggings with visible glute crease through the fabric",
    scene:
      "Standing indoors facing a large floor-to-ceiling window with a plant visible in the frame. Full rear 3/4 view — only back of head, long ponytail, shoulders and butt visible. Hips pushed slightly to one side creating S-curve. Natural daylight from the window, minimalist modern home.",
  },
  {
    id: "G3-low-angle-cleavage-biker",
    cluster: "GYM",
    subGenre: "Gym-locker-low-angle-cleavage",
    emphasis: "胸",
    face: "phone-fully-blocks-face",
    captionCode: "老婆的身材 纯爱战士",
    wardrobe:
      "soft grey long-sleeve knit cardigan deep V-button open showing cleavage + tight pink biker shorts",
    scene:
      "Inside a gym locker room. Phone pointed down from above hip level — foreshortening the lower body while keeping chest visible. Long hair tumbling over one shoulder. Cardigan open at the buttons creating deep cleavage shadow, thighs visible in biker shorts below. Tile floor + wooden lockers in the background.",
  },
  {
    id: "G4-post-workout-mirror-cap",
    cluster: "GYM",
    subGenre: "Gym-post-workout-mirror-cap",
    emphasis: "整体",
    face: "cap-pulled-low-only-lower-face",
    captionCode: "健身 ootd",
    wardrobe:
      "cream tight ribbed long-sleeve workout top (cropped at the waist) + tight cream biker shorts, beige baseball cap pulled low",
    scene:
      "Full-length gym mirror selfie, 3/4 side angle. Hip popped out to one side showing S-curve. Cap pulled very low so only nose + mouth visible. Phone held at chest. Gym machines + plant blurred behind. Slight post-workout glow on collarbone.",
  },
  {
    id: "G5-pilates-side-walking",
    cluster: "GYM",
    subGenre: "Pilates-studio-side-walking",
    emphasis: "腿",
    face: "hair-curtain-side-covers",
    captionCode: "一步一个脚印的自我超越 Pilates",
    wardrobe: "tight light grey long-sleeve crop top + tight black high-waist biker shorts",
    scene:
      "Walking sideways along a Pilates reformer in a bright white studio, profile view. Long hair falling to the side obscuring most of the face. Body profile showing leg line, hip-to-waist ratio, and side silhouette. Clean white walls + wood floor + reformer soft-focus behind.",
  },

  // ---------- OUTFIT cluster ----------
  {
    id: "O1-bodycon-lilac-full-mirror",
    cluster: "OUTFIT",
    subGenre: "Bodycon-dress-full-body-mirror",
    emphasis: "整体",
    face: "phone-fully-blocks-face",
    captionCode: "紫色果然好有韵味 氛围感",
    wardrobe:
      "tight short lilac satin spaghetti-strap bodycon mini dress with sweetheart neckline and mid-thigh hem, nude stiletto heels",
    scene:
      "Standing in front of a full-length mirror in a minimalist white hallway. Phone held up at chest height blocking face. Body in 3/4 side profile, one leg crossed in front of the other creating leg cross. Hourglass silhouette fully visible. Long brown loose wavy hair falling over shoulders.",
  },
  {
    id: "O2-izakaya-cami-cleavage",
    cluster: "OUTFIT",
    subGenre: "Bodycon-sweetheart-cami-cleavage",
    emphasis: "胸",
    face: "hair-curtain-side-covers",
    captionCode: "御姐穿搭 气质拿捏 温婉大姐姐",
    wardrobe:
      "very tight cream-colored spaghetti-strap bodycon mini cami dress with deep sweetheart neckline pushing cleavage together + oversized dark-green chunky knit cardigan slipping off one shoulder",
    scene:
      "Seated sideways at a dim Japanese izakaya wooden counter. Long hair falling forward over one cheek obscuring half the face. Head slightly tilted with lower-lip glossy pout visible. One hand holds a small ceramic sake cup near the chest. Warm amber counter lamps, small plates of sashimi soft-focus behind.",
  },
  {
    id: "O3-crop-top-navel-cap",
    cluster: "OUTFIT",
    subGenre: "Crop-top-low-rise-navel",
    emphasis: "腰",
    face: "cap-pulled-low-only-lower-face",
    captionCode: "深V露脐 身材炸裂",
    wardrobe:
      "very tight cream-colored long-sleeve ribbed knit crop top with deep plunging wide-U neckline + very low-rise white cotton shorts",
    scene:
      "Standing in an industrial loft with brick walls, front 3/4 side angle. Beige baseball cap pulled low covering eyes + forehead, only lower nose and mouth visible. Long honey-brown hair falling forward. Bare midriff + belly button exposed between crop top and low shorts. Hip bones showing.",
  },
  {
    id: "O4-qipao-tight-mirror",
    cluster: "OUTFIT",
    subGenre: "Modern-qipao-floral-tight",
    emphasis: "腰",
    face: "phone-fully-blocks-face",
    captionCode: "好细的腰 qipao 新中式",
    wardrobe:
      "tight high-neck sleeveless modern qipao with white-and-green floral pattern, bodycon silhouette, mid-thigh slit visible",
    scene:
      "Standing in a bathroom mirror, 3/4 profile. Phone covers face. Dark wavy long hair pulled behind shoulder. Narrow waist emphasized through bodycon fit, bust pushed by the high neckline. Tiled bathroom floor.",
  },
  {
    id: "O5-strapless-tube-cafe",
    cluster: "OUTFIT",
    subGenre: "Strapless-tube-top-skirt",
    emphasis: "背",
    face: "back-of-head-no-face",
    captionCode: "好~ lam-style 肩背线条",
    wardrobe:
      "cream bandeau strapless tube top + flowing beige midi skirt, beige scrunchie holding low ponytail",
    scene:
      "Seated at a round marble outdoor cafe table, facing away from the camera toward a garden. Rear 3/4 view showing bare shoulders + scapula + long ponytail falling to the waist. Orange juice + tan leather Kelly bag on the table. Garden bokeh behind. Soft afternoon light.",
  },
  {
    id: "O6-cut-out-midriff-mini",
    cluster: "OUTFIT",
    subGenre: "Cut-out-dress-midriff",
    emphasis: "腰",
    face: "hair-curtain-side-covers",
    captionCode: "我的身材挺曼妙",
    wardrobe:
      "tight black long-sleeve mini dress with midriff cut-out connecting bodice to pleated micro skirt",
    scene:
      "Standing against a clean white studio wall. Long dark hair cascading to one side covering most of the face. Front 3/4 showing the cut-out revealing waist/ribs + bodice pushing bust. Tall stilettos. Pleated micro skirt barely covering upper thigh.",
  },
  {
    id: "O7-elevator-pink-bodycon",
    cluster: "OUTFIT",
    subGenre: "Elevator-mirror-pink-bodycon",
    emphasis: "整体",
    face: "phone-fully-blocks-face",
    captionCode: "今日电梯",
    wardrobe: "tight pink bodycon knee-length zipper-front dress + tall black leather ankle boots",
    scene:
      "Standing inside a stainless-steel elevator with floor selection panel visible. Phone held at chest blocking face. Body in 3/4 to the mirror reflecting the side silhouette — full hourglass visible. Long brown hair loose. Cool elevator lighting.",
  },
  {
    id: "O8-soft-knit-bra-through",
    cluster: "OUTFIT",
    subGenre: "Tight-shirt-bra-visible-through",
    emphasis: "胸",
    face: "profile-side-1-4-face",
    captionCode: "温婉大姐姐 气质",
    wardrobe:
      "snug soft grey long-sleeve knit top where bra outline shows through the fabric + high-waist camel midi pencil skirt + tan Kelly bag over shoulder",
    scene:
      "Standing in a boutique or apartment, 90° profile to camera. Only the side view of her face visible, long hair falling forward. Soft knit pushing cleavage forward, hip 3/4 side showing curve. Kelly bag at waist level. Warm home-lit background.",
  },
  {
    id: "O9-thick-body-rear-mirror",
    cluster: "OUTFIT",
    subGenre: "Tight-tee-printed-shorts-rear",
    emphasis: "臀",
    face: "back-of-head-no-face",
    captionCode: "菜就多练",
    wardrobe: "black tight short-sleeve t-shirt + beige patterned-print tight biker shorts",
    scene:
      "Standing next to a large wall mirror in a dance/studio room. Full rear 3/4 view only — back of head with long dark hair + shoulder + wide hips + thick thighs + round glute all visible. Phone held up to the mirror in one hand. Wood floor + framed art behind.",
  },

  // ---------- LUXE cluster ----------
  {
    id: "L1-lilac-car-bouquet",
    cluster: "LUXE",
    subGenre: "Lilac-car-bouquet",
    emphasis: "臀",
    face: "eyes-closed-dreamy-passive",
    captionCode: "氛围感 鲜花 luxe",
    wardrobe: "tight lilac satin spaghetti-strap bodycon floor-length dress",
    scene:
      "Reclining sideways across the red-leather back seat of a luxury car. Head resting back against the seat, eyes closed, long brown hair falling across the shoulders. A huge lilac rose bouquet fills the left half of the frame. Hip curve + thigh line visible through tight satin. Highway + skyline visible through car window. Natural daylight.",
  },
  {
    id: "L2-hotel-satin-robe-mirror",
    cluster: "LUXE",
    subGenre: "Hotel-satin-robe-mirror",
    emphasis: "整体",
    face: "phone-fully-blocks-face",
    captionCode: "氛围感 酒店镜前",
    wardrobe:
      "short ivory satin belted wrap dress (thigh-length, plunging V neckline, lace trim, belt at waist) + sheer nude tights + bare feet",
    scene:
      "Hotel room full-length mirror selfie at golden hour. Phone at chest-level covering face. Body in 3/4 to mirror with hip pushed to one side dramatic S-curve. Long wet-look wavy hair. Warm golden sunset light through sheer white curtains. Marble floor.",
  },
  {
    id: "L3-bf-pov-car-short-dress",
    cluster: "LUXE",
    subGenre: "BF-POV-car-selfie",
    emphasis: "腿",
    face: "editorial-smolder-visible",
    captionCode: "男朋友视角 BF POV",
    wardrobe:
      "tight black satin short bodycon mini dress + black sheer stockings + black patent stiletto heels",
    scene:
      "Seated in the passenger seat of a luxury car at night, body turned sideways to camera (boyfriend-POV from driver's seat). Legs crossed dramatically foreshortening thighs. Long hair loose, glossy wine-red lips parted slight smirk. Eyes half-lidded smolder. Neon city lights passing through the window.",
  },
  {
    id: "L4-restaurant-knit-dress-candle",
    cluster: "LUXE",
    subGenre: "Restaurant-candle-dress",
    emphasis: "胸",
    face: "hair-curtain-side-covers",
    captionCode: "约会 candle date glam",
    wardrobe:
      "tight black long-sleeve ribbed knit midi dress with small crew neckline + subtle gold pendant necklace",
    scene:
      "Seated at a warmly-lit restaurant table for two, small flickering candle between. Long hair falling to one side covering one cheek. Elbows on table, chin resting on folded hands — knit dress pushing cleavage forward. Red wine glass on table. Dim warm bokeh background.",
  },

  // ---------- STUDIO cluster ----------
  {
    id: "S1-eva-studio-mpose",
    cluster: "STUDIO",
    subGenre: "Eva-style (黑 turtleneck + 小黑 panty + 黑丝)",
    emphasis: "腿",
    face: "editorial-smolder-visible",
    captionCode: "摄影 studio editorial",
    wardrobe:
      "plain black long-sleeve high-neck turtleneck top + small tight plain black cotton panties + sheer full-length black stockings + tall black patent pointed stiletto heels with red soles + large square black-frame glasses",
    scene:
      "Seated on a polished light marble studio floor against a smooth vertical-grain beige wooden-veneer wall. Legs spread wide in classic M-shape pose, feet planted in stilettos. One hand braced behind, other resting on thigh with long golden-yellow nails visible. Head turned 3/4 toward camera with smoky-eye smolder, glossy nude-pink lips. Long loose wavy hair cascading. Soft diffused studio lighting.",
  },
  {
    id: "S2-editorial-high-cut-swimsuit",
    cluster: "STUDIO",
    subGenre: "High-cut-editorial-swimsuit",
    emphasis: "腿",
    face: "profile-side-1-4-face",
    captionCode: "摄影节奏 整点儿摄影 sunset beach",
    wardrobe:
      "dramatic black one-piece swimsuit with high-cut hip line exposing full hip-to-leg curve",
    scene:
      "Standing ankle-deep in shallow ocean water at sunset, full profile side view. Wet long black hair trailing down to waist. Face turned 3/4 toward the horizon, silhouette against orange sunset sky. Water droplets glistening on skin. LuluBlack-style editorial photography framing.",
  },
  {
    id: "S3-heart-stockings-argyle",
    cluster: "STUDIO",
    subGenre: "Heart-stocking-argyle-dress",
    emphasis: "腿",
    face: "editorial-smolder-visible",
    captionCode: "摄影 奶油桃 想了半天漂亮话",
    wardrobe:
      "sleeveless argyle-pattern grey knit mini dress (square neckline) + black fishnet stockings with heart-pattern reaching mid-thigh + tall black patent heels",
    scene:
      "Seated on a black-and-white diagonal-stripe studio floor, one knee bent up with heel planted. Head turned with side-smolder editorial look. Long wavy hair cascading to one side. One hand resting on bent knee with nails visible. Studio black-drape backdrop.",
  },
  {
    id: "S4-mesh-mask-face-covered",
    cluster: "STUDIO",
    subGenre: "Mesh-top-mask-御姐",
    emphasis: "胸",
    face: "mask-covers-nose-mouth",
    captionCode: "腊妹穿搭大赏 御姐",
    wardrobe:
      "sheer black fishnet long-sleeve mesh top (with bra outline faintly visible through) + tight black micro shorts",
    scene:
      "Standing in an apartment doorway with light wood floor + white walls. Black face mask covering nose and mouth. Long dark hair loose. Front 3/4 body posed with one hip pushed out. Bra outline subtly visible through the mesh. Phone held selfie-style in one hand but face mask remains the defining feature — NOT 'lingerie' look due to the mask + street context.",
  },

  // ---------- BODY-POS cluster ----------
  {
    id: "B1-chubby-cheongsam-mirror",
    cluster: "BODY_POS",
    subGenre: "Chubby-cheongsam-bodycon",
    emphasis: "整体",
    face: "phone-fully-blocks-face",
    captionCode: "大方展示美丽 微胖穿搭",
    wardrobe:
      "tight high-neck floral-pattern modern qipao bodycon dress (soft mauve floral on cream base) + nude mary-jane heels",
    scene:
      "Standing in a full-length mirror in a cozy home hallway. Body is fuller/curvier than slim (plus-size build). Phone blocks face. 3/4 profile to mirror emphasizing voluptuous hourglass. Long wavy brown hair. Confident relaxed pose. Warm indoor light.",
  },
  {
    id: "B2-thick-linso-gym-mirror",
    cluster: "BODY_POS",
    subGenre: "Thick-Linso-gym-mirror",
    emphasis: "整体",
    face: "phone-fully-blocks-face",
    captionCode: "030 哈克之吻 绝不减肥",
    wardrobe:
      "matching royal-blue sports bra (scoop neckline) + matching royal-blue high-waist biker shorts",
    scene:
      "Gym locker room full-length mirror selfie. Body type: THICK — wide hips, thick thighs, full bust, full arms. Full hourglass despite chubbier frame. Phone covers face. Hair falling to side. Cool gym lighting, lockers + hair-dryer in background. Confident hourglass celebration pose.",
  },
  {
    id: "B3-microfat-sweetheart-jeans",
    cluster: "BODY_POS",
    subGenre: "Microfat-sweetheart-jeans",
    emphasis: "胸",
    face: "editorial-smolder-visible",
    captionCode: "172 140斤 大方展示美丽 bbw 微胖",
    wardrobe:
      "floral-pattern white sweetheart bandeau bra-top + open grey chunky knit cardigan hanging at the elbows + high-rise blue jeans",
    scene:
      "Standing in a garden / park outdoor. Plus-size / microfat body. Cardigan slipping off the shoulders revealing bare upper arms. Sweetheart bra-top pushing cleavage. Long wavy hair. Soft content smile, head slightly tilted. Afternoon warm sunlight filtering through trees behind.",
  },

  // ---------- Extra (bonus coverage) ----------
  {
    id: "X1-beach-bikini-kneel-wet",
    cluster: "STUDIO",
    subGenre: "Beach-bikini-knee-wet",
    emphasis: "胸",
    face: "editorial-smolder-visible",
    captionCode: "beach vacation 慕容 happy smile",
    wardrobe:
      "white triangle bikini top + tight light-grey high-waist bike-short-style swim bottoms (NOT bikini panty) + small silver necklace",
    scene:
      "Kneeling on wet tidal sand at a sunny beach. Long black hair blown by wind. Bright genuine smile. Body angled forward toward camera showing cleavage + slender shoulders. Water droplets on tanned skin. Ocean + blue sky + scattered clouds behind. Vacation vibe.",
  },
  {
    id: "X2-cafe-pink-bowknot-tube",
    cluster: "OUTFIT",
    subGenre: "Bodycon-pink-tube-bow",
    emphasis: "胸",
    face: "profile-side-1-4-face",
    captionCode: "洱海的风 vacation 御姐",
    wardrobe:
      "tight pink strapless tube-top bodycon mini dress with center front bow-tie detail showing cleavage pushed together",
    scene:
      "Seated on a chair in a light-filled hotel balcony/restaurant setting. Long brown wavy hair falling. 3/4 side profile with cheek turned toward camera and slight sly-smile visible. Bow-tie bodice visible. Natural light from large window behind. Potted plant and wicker chair soft-focus.",
  },
];

// ---------------- methodology-aware prompt builder ----------------

function buildMegaPrompt(scene: Scene): string {
  const emphasisMap: Record<Emphasis, string> = {
    胸: "主打胸 (cleavage / bust). Pose and outfit focus on cleavage. Other parts natural.",
    腰: "主打腰 (narrow waist / hourglass). Outfit emphasizes waist-hip ratio. Other parts natural.",
    臀: "主打臀 (peach glute). Angle shows glute curve. Other parts natural.",
    腿: "主打腿 (leg line / thigh). Angle emphasizes leg length. Other parts natural.",
    背: "主打背 (back / shoulders S-curve).",
    整体: "主打整体 hourglass silhouette in full-body mirror.",
  };

  const faceMap: Record<FaceHandling, string> = {
    "phone-fully-blocks-face":
      "Phone held at face-height completely covers face — only forehead + hair + jawline visible.",
    "cap-pulled-low-only-lower-face":
      "Baseball cap pulled low over eyes — only lower nose + mouth + jaw visible.",
    "hair-curtain-side-covers":
      "Long hair falls across one side of face covering most of it — only half-face peeks through.",
    "mask-covers-nose-mouth":
      "Black face mask covers nose and mouth — only eyes + forehead visible.",
    "sunglasses-oversized-dark": "Large dark sunglasses cover both eyes.",
    "profile-side-1-4-face": "Body and face turned 90° profile — side-view of face only.",
    "back-of-head-no-face":
      "Full rear view — only back of head + hair + shoulders. No face visible.",
    "eyes-closed-dreamy-passive": "Face visible but eyes closed, dreamy/passive expression.",
    "editorial-smolder-visible":
      "Face visible with editorial smolder (studio shoot), heavy-lidded gaze, glossy lips.",
  };

  return [
    "Adult woman (23), fit-curvy hourglass build.",
    emphasisMap[scene.emphasis],
    "",
    `Face: ${faceMap[scene.face]}`,
    "",
    `Outfit: ${scene.wardrobe}`,
    "NOT lingerie / bra-and-panty set — this is everyday OOTD fashion, TIGHT fit only.",
    "",
    `Aesthetic: Chinese 小红书 ${scene.captionCode}. Confident body-line display in legal clothing — NOT pornographic.`,
    "",
    `Scene: ${scene.scene}`,
    "",
    "AVOID: nudity, topless, genitals, 'lingerie shoot on bed' framing, multi-part hyperfocus.",
  ].join("\n");
}

// ---------------- runner ----------------

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
    REFERENCE_FILENAMES.map(async (name) => {
      const ext = path.extname(name).slice(1).toLowerCase();
      const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
      return {
        mimeType,
        data: (await fs.readFile(path.join(REF_DIR, name))).toString("base64"),
      };
    }),
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
      signal: AbortSignal.timeout(300_000),
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
      return { ok: false, error: "no image", ms: Date.now() - t0 };
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
  let cluster: Cluster | "all" = "all";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--concurrency") {
      concurrency = Number(argv[++i]);
    } else if (argv[i] === "--limit") {
      limit = Number(argv[++i]);
    } else if (argv[i] === "--cluster") {
      cluster = argv[++i] as Cluster;
    }
  }
  return { concurrency, limit, cluster };
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

  let scenes = args.cluster === "all" ? SCENES : SCENES.filter((s) => s.cluster === args.cluster);
  if (args.limit > 0) {
    scenes = scenes.slice(0, args.limit);
  }

  const outRoot = path.join(os.homedir(), "tmp", "doubao-selfie-test");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(outRoot, `mega-v2-${stamp}`);
  await fs.mkdir(runDir, { recursive: true });

  console.log(
    `[mega-v2] scenes=${scenes.length} cluster=${args.cluster} concurrency=${args.concurrency}`,
  );
  console.log(`[mega-v2] out=${runDir}`);

  const refs = await loadRefs();
  const summary: Array<{
    id: string;
    cluster: string;
    emphasis: string;
    face: string;
    result: string;
    ms: number;
    kb: number;
  }> = [];

  await withLimit(scenes, args.concurrency, async (scene) => {
    const sceneDir = path.join(runDir, `${scene.cluster}-${scene.id}`);
    await fs.mkdir(sceneDir, { recursive: true });
    const prompt = buildMegaPrompt(scene);
    await fs.writeFile(path.join(sceneDir, "prompt.txt"), prompt);
    await fs.writeFile(path.join(sceneDir, "scene.json"), JSON.stringify(scene, null, 2));

    console.log(`[${scene.id}] (${scene.cluster}/${scene.emphasis}/${scene.face}) start`);
    const res = await callDoubao(prompt, refs, apiKey);
    if (res.ok) {
      const outPath = path.join(sceneDir, "image.jpeg");
      await fs.writeFile(outPath, res.bytes);
      const kb = res.bytes.length / 1024;
      summary.push({
        id: scene.id,
        cluster: scene.cluster,
        emphasis: scene.emphasis,
        face: scene.face,
        result: "OK",
        ms: res.ms,
        kb,
      });
      console.log(`[${scene.id}] OK ${(res.ms / 1000).toFixed(1)}s ${kb.toFixed(0)}KB`);
    } else {
      await fs.writeFile(path.join(sceneDir, "error.txt"), res.error);
      summary.push({
        id: scene.id,
        cluster: scene.cluster,
        emphasis: scene.emphasis,
        face: scene.face,
        result: "FAIL",
        ms: res.ms,
        kb: 0,
      });
      console.log(`[${scene.id}] FAIL ${(res.ms / 1000).toFixed(1)}s: ${res.error.slice(0, 150)}`);
    }
  });

  summary.sort((a, b) => {
    const c = a.cluster.localeCompare(b.cluster);
    if (c !== 0) {
      return c;
    }
    return a.id.localeCompare(b.id);
  });

  const lines = [
    `# Doubao Mega v2 — XHS methodology grid`,
    ``,
    `stamp: ${stamp}`,
    ``,
    `| id | cluster | emphasis | face | result | latency (s) | size (KB) |`,
    `|---|---|---|---|---|---|---|`,
    ...summary.map(
      (r) =>
        `| ${r.id} | ${r.cluster} | ${r.emphasis} | ${r.face} | ${r.result} | ${(r.ms / 1000).toFixed(1)} | ${r.kb.toFixed(0)} |`,
    ),
  ];
  await fs.writeFile(path.join(runDir, "summary.md"), lines.join("\n"));
  console.log(`\n[mega-v2] done`);
  console.log(lines.join("\n"));
  console.log(`\nopen ${runDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
