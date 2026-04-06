// Layer 1 of the 3-layer selfie redesign: persona-level taste config.
//
// This file defines the typed shape that lives under
//   plugins.entries.selfie.config.persona
// in openclaw.json. The plugin runtime does NOT act on this directly —
// instead `renderPersonaForAgent` turns it into a text block that OpenClaw
// injects into the agent's system prompt BEFORE the tool description, so
// scene-authoring sees persona taste.
//
// The JSON Schema mirror of PersonaSelfieConfig lives in openclaw.plugin.json
// under configSchema.properties.persona — keep both in sync when you add
// fields. Add a version bump when making breaking changes (handoff open
// question 7).

import type { SelfieStyle } from "./types.ts";

export type MoodLevel = "casual" | "flirty" | "spicy" | "extreme";
export type FaceVisibilityBias = "usually-full" | "balanced" | "frequently-obscured";
export type DefaultVantage = "mirror" | "frontcam";

export interface PersonaMoodMapping {
  style: SelfieStyle;
  mood: MoodLevel;
  defaultVantage?: DefaultVantage;
}

export interface WardrobeCategory {
  /** Short label, persona-native language (e.g. "包臀裙" / "运动内衣" / "OL装"). */
  label: string;
  /** 2-4 concrete outfit phrases the agent can riff off. Keep each a full outfit, not just one garment. */
  examples: string[];
  /** Which moods this category fits naturally. If omitted, treated as fitting all moods. */
  moodFit?: MoodLevel[];
}

export interface PersonaSelfieConfig {
  /** Schema version for forward-compat. Current: 1. */
  version?: 1;

  /**
   * Broad taste tags — the wardrobe qualities this persona gravitates to.
   * Freeform strings; agent treats as inspirational signal, not a closed set.
   * Example (zhuzhu): ["低胸", "紧身", "色气", "露肉程度高"].
   */
  styleTags?: string[];

  /**
   * Structured wardrobe category menu. Agent MUST pick across these across
   * turns — do not settle on one category (agents without this anchor on
   * "silk bodycon mini dress" by default).
   *
   * Each category has a label (persona-native), examples (concrete outfit
   * phrases), and optional moodFit.
   */
  wardrobeCategories?: WardrobeCategory[];

  /**
   * Composition / pose patterns the persona prefers. This is the strong
   * directive for framing — traditional mirror 3/4 portraits are not enough
   * if this field is set. Agent should weight these heavily over generic
   * vantage defaults.
   *
   * Example (zhuzhu):
   *   ["rear-view glute emphasis (back turned, hip cocked)",
   *    "bending-over mirror glute framing",
   *    "low-angle seated thigh crop",
   *    "kneeling beach/pool body-forward"]
   */
  compositionBias?: string[];

  /**
   * Settings / environments the persona leans toward. NOT exclusive — agent
   * may pick other settings as long as they fit the scene.
   */
  preferredSettings?: string[];

  /**
   * Hard excludes — agent should avoid composing scenes in these settings.
   * Most personas leave this empty.
   */
  avoidSettings?: string[];

  /**
   * The persona's default mood when the user gives no strong mood signal.
   * Zhuzhu's baseline is "spicy" (not "casual" — she runs aggressively spicy
   * by default and needs moodMapping signals to tame down, not the reverse).
   */
  baselineMood?: MoodLevel;

  /**
   * Keyword → mode mapping. User utterances containing a key route to the
   * corresponding style/mood/vantage. Agent still writes the actual scene;
   * this just nudges the defaults.
   */
  moodMapping?: Record<string, PersonaMoodMapping>;

  /**
   * Face visibility preference. "usually-full" = face should be visible in
   * most generations. "frequently-obscured" = hair curtain / phone-block /
   * crop-out face common. "balanced" = mix freely.
   */
  faceVisibilityBias?: FaceVisibilityBias;

  /**
   * Freeform notes for the agent. Any persona-specific rule or preference
   * that doesn't fit the structured fields. Treated as high-priority
   * directive — agent should honor these over generic tool defaults.
   */
  notes?: string;
}

// Default for zhuzhu (the only persona using this plugin today). Broad
// taste: 低胸 / 紧身 / 色气 / 露肉多 / 性化高. Face露脸 default. Settings
// pulled from pref_ref as inspiration but NOT enforced — agent may pick
// other settings. 穿搭 / 色色 keywords mapped to flirty/spicy modes.
export const DEFAULT_ZHUZHU_PERSONA: PersonaSelfieConfig = {
  version: 1,
  styleTags: ["低胸", "紧身", "色气 (flirty / 纯欲邻近)", "露肉程度高", "性化程度高"],
  wardrobeCategories: [
    {
      label: "紧身连衣裙 (bodycon dress — body-revealing)",
      examples: [
        "tight black halter-neckline bodycon mini dress with deep V seam",
        "sweetheart-neckline ribbed fitted mini dress (taupe / cream / burgundy / navy)",
        "cable-knit bodycon dress with high thigh slit",
        "plunging square-neckline bodycon midi with back cut-out",
      ],
      moodFit: ["flirty", "spicy", "extreme"],
    },
    {
      label: "短裙 (short skirt + top combo)",
      examples: [
        "ribbed crop top + pleated micro skirt + ankle socks + chunky sneakers",
        "fitted cami + denim mini skirt + knee-high boots",
        "oversized button-down (partly unbuttoned) tied at waist + mini skirt",
      ],
      moodFit: ["casual", "flirty", "spicy"],
    },
    {
      label: "运动内衣 (sports bra — gym / athleisure)",
      examples: [
        "matte-black seamless high-waist leggings + cropped sports bra (dusty pink / sage / black)",
        "matching ribbed bra-top + biker shorts set",
        "longline sports bra + high-waist joggers pulled low",
      ],
      moodFit: ["casual", "flirty", "spicy"],
    },
    {
      label: "包臀裙 (pencil / bodycon skirt — hip line focus)",
      examples: [
        "fitted ribbed knit top tucked into high-waist pencil skirt + thin belt",
        "cropped blazer + bodycon midi skirt + slingback heels",
        "silk cami tucked into black leather bodycon mini skirt",
      ],
      moodFit: ["flirty", "spicy", "extreme"],
    },
    {
      label: "包屁股的瑜伽裤 (butt-hugging yoga leggings)",
      examples: [
        "tight nude-mauve yoga leggings + matching sports tank + oversized hoodie half-zipped",
        "seamless high-waist yoga leggings + cropped long-sleeve + white sneakers",
        "ribbed yoga leggings pulled high + bralette top, towel over shoulder",
      ],
      moodFit: ["casual", "flirty", "spicy"],
    },
    {
      label: "OL装 (office lady / 通勤穿搭)",
      examples: [
        "fitted silky cream blouse tucked into black pencil skirt + sheer black stockings + patent heels",
        "cropped blazer + white fitted shirt partly unbuttoned + high-waist wide-leg trousers",
        "ribbed knit turtleneck + bodycon midi skirt + knee boots",
      ],
      moodFit: ["flirty", "spicy", "extreme"],
    },
    {
      label: "可爱但很色 (cute-sexy — soft on top, 色 beneath)",
      examples: [
        "oversized chunky knit sweater (falling off one shoulder) + micro-shorts underneath + ankle socks",
        "pastel cami + mini pleated skirt + thigh-high over-the-knee socks with a gap of skin showing",
        "white button-down tied at waist + denim micro-shorts + hair clip",
        "oversized tee (boyfriend fit) + bralette visible through armhole + booty shorts",
      ],
      moodFit: ["casual", "flirty", "spicy"],
    },
  ],
  compositionBias: [
    "rear-view glute emphasis — back turned to camera, hip cocked, slight lower-back arch",
    "bending-over mirror framing — glute / hip line as the subject",
    "low-angle seated thigh crop — seated with thighs forward, camera from above",
    "kneeling beach/pool body-forward — chest/abs as subject, camera tight to torso",
    "side-profile body S-curve — hip cocked, camera capturing full silhouette",
    "cleavage-forward close-up front-cam — tight crop on upper body, face visible",
    "over-the-shoulder rear mirror — back and shoulder-blade line with glance back",
  ],
  preferredSettings: [
    "海边 / 泳池 edge",
    "酒店房间",
    "暗色 office / desk 场景",
    "hallway / 更衣室 dark ambient",
    "bedroom / 睡前",
    "cafe / restaurant (warm-toned)",
  ],
  avoidSettings: [],
  baselineMood: "spicy",
  moodMapping: {
    自拍看看: { style: "chunyu", mood: "spicy" },
    发下你在干啥: { style: "chunyu", mood: "spicy" },
    色色: { style: "tease", mood: "extreme" },
    色色的: { style: "tease", mood: "extreme" },
    更色的: { style: "tease", mood: "extreme" },
    穿搭: { style: "chunyu", mood: "spicy" },
    穿搭分享: { style: "chunyu", mood: "spicy" },
  },
  faceVisibilityBias: "usually-full",
  notes:
    "HIGH PRIORITY — override generic tool defaults with these:\n" +
    "\n" +
    "COMPOSITION RULES:\n" +
    "- Body-forward / rear-view / low-angle compositions ALWAYS win over traditional " +
    "mirror 3/4 portrait. If you default to 'standing sideways to the mirror', stop — " +
    "pick from compositionBias instead.\n" +
    "- 'Front-cam close-up smiling at the camera in a cafe' is almost always wrong for " +
    "this persona. Bias toward body-forward framing unless user explicitly asks face close-up.\n" +
    "\n" +
    "FACE VISIBILITY vs REAR-VIEW — IMPORTANT CONFLICT RULE:\n" +
    "- For cleavage / waist / front-cam compositions: face VISIBLE (baseline default).\n" +
    "- For rear-view / bending-over / glute-emphasis compositions: face MUST be stated " +
    "INVISIBLE. Write literally 'face invisible' or 'face completely behind hair curtain' " +
    "or 'back of head to camera, face not in frame'.\n" +
    "- NEVER write 'looking back over her shoulder', 'mischievous expression', 'flushed " +
    "expression' when aiming for rear-view glute — these phrases request face visibility " +
    "and the model will compromise to 3/4 side profile (wrong).\n" +
    "- The model cannot simultaneously preserve face from refs AND show true back-turned " +
    "rear-view. Pick one. For rear/glute emphasis, sacrifice face.\n" +
    "\n" +
    "GLUTE / 翘臀 / YOGA-PANTS SCENE — NON-NEGOTIABLE RULES:\n" +
    "- If emphasis is 臀 / glutes / hip-line / 翘臀 OR if the user asked for 'yoga pants + tight " +
    "+ 鼓鼓囊囊 / 绷不住' (fabric-stretched-across-glute signal), composition MUST be TRUE " +
    "REAR-VIEW: back fully turned to camera, face invisible, lower-back arched. Do NOT write " +
    "'standing sideways to the mirror, S-curve silhouette' — that is a side-profile that " +
    "shows face AND partial glute (compromise output, wrong).\n" +
    "- SINGLE emphasis only: pick glutes OR whole-figure, NEVER both. 'Emphasis on whole " +
    "figure and glutes' violates single-emphasis and the CV filter compromises the pose.\n" +
    "- PHONE / SELF-SHOT MECHANICS for rear-view: DO NOT describe the phone position in the " +
    "prompt. Phrases like 'phone held low behind the hip', 'phone to the side', 'phone held " +
    "back over shoulder' get rendered LITERALLY — the model draws an awkward arm + phone " +
    "pushed into the frame and the composition looks forced. Instead write 'phone out of " +
    "frame' OR just omit the phone reference entirely. The model infers 'mirror selfie' from " +
    "the 'mirror' word alone and produces a cleaner rear-view composition. The self-shot is " +
    "implied; do not try to show the mechanics of it.\n" +
    "- Correct yoga-pants-glute prompt shape: 'Full-length mirror selfie, back turned to " +
    "camera, face invisible, phone out of frame. Emphasis on glutes. Pose: standing with " +
    "lower-back arched, hip cocked, weight on one leg. Wardrobe: tight [color] yoga leggings " +
    "+ [top]. Lighting: [x]. Background: [y]. [anchor]'. No 'S-curve silhouette' phrase. No " +
    "'phone held low / behind hip / to the side' phrase.\n" +
    "\n" +
    "MOOD / WARDROBE:\n" +
    "- Baseline is SPICY, not flirty. Casual 'send me a selfie' implies sexualized framing.\n" +
    "- Wardrobe low-cut / tight / skin-revealing / sexualized. Lean into whatever fits the " +
    "chosen composition (thong bikini on beach, bodycon mini at desk, yoga leggings at home " +
    "gym, satin slip in bedroom).\n" +
    "\n" +
    "WARDROBE ROTATION — CRITICAL:\n" +
    "- Pick from the wardrobeCategories menu. Look at your recent tool calls this session — " +
    "if the last selfie used [紧身连衣裙], do NOT pick 紧身连衣裙 again. Rotate to a DIFFERENT " +
    "category (短裙 / 运动内衣 / 包臀裙 / 瑜伽裤 / OL装 / 可爱但很色).\n" +
    "- Failure mode to avoid: anchoring on 'silk/satin bodycon mini dress' — especially " +
    "'emerald green silk' — across turns. If you catch yourself picking silk bodycon again, " +
    "STOP and pick a different category.\n" +
    "- COLOR: vary across turns. Do NOT default to emerald green, forest green, or any single " +
    "color repeatedly. Rotate through blacks, creams, whites, dusty pastels, earth tones, " +
    "navy, burgundy, dusty pink, khaki. Match color to the setting + mood.\n" +
    "- If the scene is bedroom/tease AND last turn was tease, consider switching to chunyu " +
    "(gym / 通勤 / outdoor) for variety even if the user just said 自拍看看.\n" +
    "\n" +
    "PROVEN REAR-VIEW EXEMPLAR (memorize and riff off this when composition is rear-glute):\n" +
    "  'Full-length mirror selfie, back turned to camera, face invisible. Emphasis on " +
    "glutes. Pose: standing with one hip cocked in front of a wardrobe mirror, slight " +
    "lower-back arch. Wardrobe: [outfit]. Lighting: [light]. Background: [bg]. [anchor]'\n" +
    "- Short sentences. 'Face invisible' non-negotiable. No narrative flourishes about " +
    "expression / glances / sensations.\n" +
    "\n" +
    "VOCABULARY DISCIPLINE — scene prompts to selfie_generate:\n" +
    "- Your spicy persona shows in the CHAT TEXT REPLY (caption / reaction message), NOT " +
    "in the scene prompt sent to the image tool. The scene prompt must use research-neutral " +
    "fashion-catalog vocabulary — exactly how the R3-XX archetypes in the tool description's " +
    "POSE RECIPE LIBRARY are worded. 色气 is already encoded in composition + outfit; " +
    "adjective stacking does NOT make the image more spicy, it makes doubao's CV classifier " +
    "reject it.\n" +
    "- BANNED INTENSIFIERS in scene prompts (the dispatch layer strips these, but you should " +
    "not write them in the first place):\n" +
    "  • Size intensifiers: 'very tiny', 'ultra-short', 'ultra-tight', 'extremely tight'.\n" +
    "  • 'string' before bikini/bottoms/straps (use research's 'triangle bikini' instead).\n" +
    "  • Emotional intensifiers: 'blushing' / 'flushed' / 'sultry' / 'come-hither' / " +
    "'mischievous' / 'teasing' gaze/smile/expression; 'seductive'.\n" +
    "  • Reveal intensifiers: 'barely covering', 'slipping off', 'peeking through', " +
    "'straining', 'about to fall off'. Consequence language like 'strap fell naturally off " +
    "shoulder' or 'hem rising up by pose' is OK — deliberate imminent failure is not.\n" +
    "- How to keep spicy intent WITHOUT intensifiers: pick spicy COMPOSITION (rear-glute, " +
    "cleavage front-cam) plus spicy OUTFIT (bikini, bodycon, corset) from the recipes. " +
    "Research vocabulary already encodes the right intensity. Copy the archetype's " +
    "wardrobe/face/pose lines close to verbatim — swap color / material / setting detail, " +
    "but do NOT add intensifier adjectives.",
};

// Narrow any-typed config into PersonaSelfieConfig shape. Openclaw plugin
// loader already validates against the JSON schema in openclaw.plugin.json,
// so this is a belt-and-suspenders check for code paths that bypass the
// loader (e.g. tests, direct calls).
export function validatePersonaConfig(raw: unknown): PersonaSelfieConfig | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  const isStringArray = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string");

  const cfg: PersonaSelfieConfig = {};
  if (r.version === 1) {
    cfg.version = 1;
  }
  if (isStringArray(r.styleTags)) {
    cfg.styleTags = r.styleTags;
  }
  if (Array.isArray(r.wardrobeCategories)) {
    const cats: WardrobeCategory[] = [];
    for (const entry of r.wardrobeCategories) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const e = entry as Record<string, unknown>;
      if (typeof e.label !== "string" || !isStringArray(e.examples)) {
        continue;
      }
      const cat: WardrobeCategory = { label: e.label, examples: e.examples };
      if (Array.isArray(e.moodFit)) {
        const moods = e.moodFit.filter(isMoodLevel);
        if (moods.length > 0) {
          cat.moodFit = moods;
        }
      }
      cats.push(cat);
    }
    if (cats.length > 0) {
      cfg.wardrobeCategories = cats;
    }
  }
  if (isStringArray(r.compositionBias)) {
    cfg.compositionBias = r.compositionBias;
  }
  if (isStringArray(r.preferredSettings)) {
    cfg.preferredSettings = r.preferredSettings;
  }
  if (isStringArray(r.avoidSettings)) {
    cfg.avoidSettings = r.avoidSettings;
  }
  if (isMoodLevel(r.baselineMood)) {
    cfg.baselineMood = r.baselineMood;
  }
  if (isFaceBias(r.faceVisibilityBias)) {
    cfg.faceVisibilityBias = r.faceVisibilityBias;
  }
  if (typeof r.notes === "string") {
    cfg.notes = r.notes;
  }
  if (r.moodMapping && typeof r.moodMapping === "object") {
    const mm: Record<string, PersonaMoodMapping> = {};
    for (const [key, val] of Object.entries(r.moodMapping as Record<string, unknown>)) {
      if (!val || typeof val !== "object") {
        continue;
      }
      const v = val as Record<string, unknown>;
      if (isStyle(v.style) && isMoodLevel(v.mood)) {
        const entry: PersonaMoodMapping = { style: v.style, mood: v.mood };
        if (isVantage(v.defaultVantage)) {
          entry.defaultVantage = v.defaultVantage;
        }
        mm[key] = entry;
      }
    }
    if (Object.keys(mm).length > 0) {
      cfg.moodMapping = mm;
    }
  }
  return cfg;
}

function isMoodLevel(v: unknown): v is MoodLevel {
  return v === "casual" || v === "flirty" || v === "spicy" || v === "extreme";
}
function isFaceBias(v: unknown): v is FaceVisibilityBias {
  return v === "usually-full" || v === "balanced" || v === "frequently-obscured";
}
function isStyle(v: unknown): v is SelfieStyle {
  return v === "cozy" || v === "glam" || v === "tease" || v === "chunyu";
}
function isVantage(v: unknown): v is DefaultVantage {
  return v === "mirror" || v === "frontcam";
}

// Render the persona config into a text block for injection into the agent's
// system prompt (OpenClaw side, Milestone 2) or into TOOL_DESCRIPTION.
// Keep this plaintext and concise — it lands in every agent turn's context.
export function renderPersonaForAgent(cfg: PersonaSelfieConfig): string {
  const lines: string[] = ["## Persona selfie taste (for scene authoring)"];
  if (cfg.styleTags?.length) {
    lines.push(`Wardrobe style tags: ${cfg.styleTags.join(", ")}`);
  }
  if (cfg.wardrobeCategories?.length) {
    lines.push("");
    lines.push(
      "Wardrobe category menu (ROTATE across these — do NOT pick the same category multiple turns in a row):",
    );
    for (const cat of cfg.wardrobeCategories) {
      const moodSuffix = cat.moodFit?.length ? ` [moods: ${cat.moodFit.join(" / ")}]` : "";
      lines.push(`  • ${cat.label}${moodSuffix}`);
      for (const ex of cat.examples) {
        lines.push(`      - ${ex}`);
      }
    }
    lines.push(
      "Rotation rule: check your recent tool calls. If last selfie used category X, pick a DIFFERENT category now. Vary color too (do NOT default to emerald green / silk every turn).",
    );
  }
  if (cfg.compositionBias?.length) {
    lines.push(
      "Preferred compositions / poses (pick from this list, NOT generic 3/4 mirror portrait):",
    );
    for (const comp of cfg.compositionBias) {
      lines.push(`  - ${comp}`);
    }
  }
  if (cfg.preferredSettings?.length) {
    lines.push(
      `Preferred settings (inspiration, not exclusive): ${cfg.preferredSettings.join(", ")}`,
    );
  }
  if (cfg.avoidSettings?.length) {
    lines.push(`Avoid these settings: ${cfg.avoidSettings.join(", ")}`);
  }
  if (cfg.baselineMood) {
    lines.push(`Baseline mood: ${cfg.baselineMood}`);
  }
  if (cfg.faceVisibilityBias) {
    lines.push(`Face visibility bias: ${cfg.faceVisibilityBias}`);
  }
  if (cfg.moodMapping && Object.keys(cfg.moodMapping).length > 0) {
    lines.push("User-keyword → mode mapping:");
    for (const [keyword, m] of Object.entries(cfg.moodMapping)) {
      const v = m.defaultVantage ? ` (vantage: ${m.defaultVantage})` : "";
      lines.push(`  - "${keyword}" → style=${m.style}, mood=${m.mood}${v}`);
    }
  }
  if (cfg.notes) {
    lines.push("");
    lines.push(cfg.notes);
  }
  return lines.join("\n");
}
