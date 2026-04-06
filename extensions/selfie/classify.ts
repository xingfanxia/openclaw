// Deterministic pattern-based scene classifier. No model call — runs in
// milliseconds on the cleaned scene caption (post-stripTextOverlay).
//
// Drives two downstream decisions in dispatch.ts:
// 1. wardrobeRisk — gates wrap-rescue eligibility (rescue only when
//    'wardrobe-trigger', never on 'body-part-trigger' per step 6 S2 finding
//    that wrap made 3/5 → 0/5 on thigh-root close-ups).
// 2. geminiSafe — gates cozy/glam fallback (gemini text classifier hard-fails
//    the 3 categories below regardless of wrap: beach-swim-fullface,
//    body-part-closeup, wet-clinging).
//
// Composition + vantageHint are informational metadata for the agent.

import { hasTextOverlayRequest } from "./text-overlay.ts";

export type Composition =
  | "grid"
  | "full-body"
  | "rear-view"
  | "single-panel-mirror"
  | "single-panel-front"
  | "other";

export type VantageHint = "frontcam-preferred" | "mirror-required" | "either";

export type WardrobeRisk = "safe" | "wardrobe-trigger" | "body-part-trigger";

export interface SceneClassification {
  composition: Composition;
  vantageHint: VantageHint;
  wardrobeRisk: WardrobeRisk;
  geminiSafe: boolean;
  hasTextOverlayRequest: boolean;
}

// Composition detection — priority order matters. Grid > full-body > rear-view
// > mirror > front-cam > other. An explicit grid request overrides a mirror
// keyword because grid output is physically back-cam.
const COMPOSITION_RULES: Array<[Composition, RegExp]> = [
  [
    "grid",
    /\b(?:grid|collage|2\s*x\s*\d|\d\s*x\s*2|2-panel|two-panel|\d+[\s-]+panel|multi-panel|panels?\s+of)\b/i,
  ],
  ["full-body", /\bfull-?(?:body|length|figure)\b/i],
  [
    "rear-view",
    /\b(?:rear[\s-]*view|back[\s-]*(?:of-?head|view|turned|facing|to\s+(?:the\s+)?camera)|facing\s+away|hip\s+cocked)\b/i,
  ],
  ["single-panel-mirror", /\bmirror\s+(?:selfie|shot)\b/i],
  ["single-panel-front", /\bfront-?cam\b/i],
];

function detectComposition(scene: string): Composition {
  for (const [label, rx] of COMPOSITION_RULES) {
    if (rx.test(scene)) {
      return label;
    }
  }
  return "other";
}

function deriveVantageHint(composition: Composition): VantageHint {
  switch (composition) {
    case "grid":
    case "full-body":
    case "rear-view":
    case "single-panel-mirror":
      return "mirror-required";
    case "single-panel-front":
      return "frontcam-preferred";
    case "other":
      return "either";
    default:
      return "either";
  }
}

// body-part-trigger: anatomical close-ups that amplify body focus — plugin
// wrap-rescue makes these WORSE per step 6 S2 (3/5 → 0/5). Also gemini-unsafe.
const BODY_PART_TRIGGERS: RegExp[] = [
  /\bthigh-?root\b/i,
  /\bupper-?thigh\s+(?:close-?up|close)\b/i,
  /\bcrotch\b/i,
  /\bd[eé]colletage\s+(?:tight|close)/i,
  /\bthighs?\s+forming\s+(?:a\s+)?triangle\b/i,
  /\bbetween\s+(?:the\s+)?thighs\b/i,
];

// wardrobe-trigger: visible lingerie-language. Wrap rescue IS effective here
// per step 4b (50% rescue on doubao wardrobe-driven fails). The wrap's
// bra+panty → homewear cami substitution rewrites the rendered wardrobe.
const WARDROBE_TRIGGERS: RegExp[] = [
  /\bgarter(?:\s+set|\s+belt)?\b/i,
  /\blingerie\b/i,
  /\bchemise\b/i,
  /\bslip\s+dress\b/i,
  /\bbra\s+(?:showing|visible|peeking|peek)\b/i,
  /\b(?:visible|peek|peeking)\s+bra\b/i,
  /\bstructured\s+lace\s+bra\b/i,
  /\b(?:black|white|red)\s+lace\s+bra\b/i,
  /\bpanty\s+(?:showing|visible|line)\b/i,
  /\bcami\s+on\s+bed\b/i,
  /\bsheer\s+(?:cami|slip|chemise)/i,
];

// Gemini-unsafe triggers — text classifier hard-fails regardless of wrap.
// Three categories per step 6: beach-swim-fullface, body-part-closeup,
// wet-clinging.
const GEMINI_UNSAFE_TRIGGERS: RegExp[] = [
  // 1. Beach/swim language
  /\btriangle\s+swim/i,
  /\bthong\s+bikini/i,
  /\bg-?string\s+bikini/i,
  /\bmicro[\s-]*bikini\b/i,
  // 2. Anatomical close-up (also body-part-trigger — overlap intended)
  ...BODY_PART_TRIGGERS,
  // 3. Wet-clinging torso
  /\bwet\s+and\s+clinging\b/i,
  /\bclinging\s+to\s+(?:the\s+)?(?:torso|body|skin|curves|chest)\b/i,
  /\bpartially\s+submerged\b/i,
  /\bsoaking\s+wet/i,
  // Structural-trigger banned vocab. `see-through` and `transparent` bare
  // are strong enough alone (rarely benign in a selfie prompt). `sheer` is
  // borderline — step 6 S5 "sheer black stockings" got gemini 2/5 (degraded,
  // not hard-fail), so we only flag `sheer` when paired with a body-covering
  // garment within the same phrase (sheer top / sheer dress / etc). An
  // optional adjective (color) between the two is allowed.
  /\bsee-?through\b/i,
  /\btransparent\b/i,
  /\bsheer\b[^.!?\n]{0,40}\b(?:top|dress|fabric|panel|bodice|blouse|cami|slip|chemise|bra|panty)\b/i,
];

function matchesAny(scene: string, patterns: RegExp[]): boolean {
  return patterns.some((rx) => rx.test(scene));
}

function detectWardrobeRisk(scene: string): WardrobeRisk {
  // Body-part-trigger takes precedence — it's the "no rescue" category.
  if (matchesAny(scene, BODY_PART_TRIGGERS)) {
    return "body-part-trigger";
  }
  if (matchesAny(scene, WARDROBE_TRIGGERS)) {
    return "wardrobe-trigger";
  }
  return "safe";
}

function detectGeminiSafe(scene: string): boolean {
  return !matchesAny(scene, GEMINI_UNSAFE_TRIGGERS);
}

export function classifyScene(scene: string): SceneClassification {
  const composition = detectComposition(scene);
  return {
    composition,
    vantageHint: deriveVantageHint(composition),
    wardrobeRisk: detectWardrobeRisk(scene),
    geminiSafe: detectGeminiSafe(scene),
    hasTextOverlayRequest: hasTextOverlayRequest(scene),
  };
}
