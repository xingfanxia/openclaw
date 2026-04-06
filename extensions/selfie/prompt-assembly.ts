// Two prompt shapes used by dispatch.ts:
//
// 1. buildMinimalPrompt — the ref3 10-line face/body/scene/avoid spine from
//    the 2026-04-23 study. Doubao and gemini both do well on this for
//    non-wardrobe-trigger scenes; the v2 wrap's extra negative examples
//    actually raise gemini's classifier score (B5: wrap helps doubao 8×).
//
// 2. buildV2WrapPrompt — the legacy 111-line wrap with face/body/identity/
//    angle/style-notes/scene/style-line. Useful on doubao for
//    wardrobe-trigger scenes: its bra+panty → homewear cami substitution
//    rewrites the rendered wardrobe and rescues ~50% of hard-fails per
//    step 4b. Do NOT run on gemini (text classifier amplifies banned
//    vocabulary in the wrap's negative examples).
//
// buildPrompt is retained as an alias for buildV2WrapPrompt for backwards
// compatibility with any third-party consumers.

import { getBodyLines, getStyleBlock } from "./styles.ts";
import type { SelfieCount, SelfieStyle } from "./types.ts";

// Anti-watermark directive. Used ONLY by v2-wrap (gpt-image-2 cozy/glam +
// gemini cozy/glam fallback paths) because those are where we've observed
// Gemini hallucinating XHS UI overlays (@username handles, "Shot on
// iPhone" tags) from Chinese anchor-code training correlation.
//
// INTENTIONALLY NOT in buildMinimalPrompt. Doubao is the only
// minimal-prompt primary (chunyu/tease single-panel) and:
//   (a) Doubao does NOT hallucinate watermarks on its output
//   (b) This directive contains negative vocabulary (`小红书`, `XHS`,
//       `watermark`, `logo`, `@username`, `hashtag`) that raises
//       Doubao's text-classifier score on edge-case compositions —
//       same failure mode as v2-wrap's AVOID list on Gemini. Verified
//       in-chat 2026-04-24: "bending over on bed, glutes pushed close
//       to camera" previously passed in research (step 6 minimal
//       validation) but fails with this directive appended.
const ANTI_TEXT_DIRECTIVE =
  "NO TEXT ON IMAGE: no watermark, no logo, no @username handle, no 'Shot on iPhone' / 'Shot on Huawei' tag, no timestamp, no caption burned in, no hashtag, no 小红书 / XHS UI elements (no corner logos, no tab bars). Clean photo only, nothing rendered on top of the photo.";

// Ref3 minimal spine. Byte-identical to scripts/selfie-test/step6-extreme-stress.ts
// `minimalWrap` and scripts/selfie-test/step4-repro-and-rescue.ts Phase 4a's
// prompt.txt format. This is the shape research validated at 5/5 on R3-17
// and 24/24 on stable scenes.
//
// DO NOT add scaffolding lines here — not anti-text, not Aesthetic, not
// positive anchors. Any `NOT X` framing injects X tokens into doubao's text
// classifier and regresses pass rate (anti-text removed 2026-04-24 morning
// for the same reason; Aesthetic removed 2026-04-24 afternoon after
// regressing R3-17 pink-bikini test). Positive framing belongs in the
// SCENE text's anchor suffix (`假日穿搭` etc), not in the wrap itself.
//
// Root-cause audit:
// docs/reports/selfie-intensifier-fix/root-cause-2026-04-24-pink-bikini.md
export function buildMinimalPrompt(scene: string): string {
  return [
    "These reference photos show the person's FACE — preserve her exact facial features,",
    "eyes, nose, lips, face shape, skin tone, and hair.",
    "Skin is clear and well-maintained: natural texture, no acne clusters, no red sunburn patches.",
    "",
    "BODY: Adult woman (23), fit-curvy hourglass build.",
    "SINGLE EMPHASIS — the scene below calls out ONE body feature. Do not stack multiple.",
    "",
    `Scene: ${scene}`,
    "",
    "AVOID: nudity, topless, visible genitals, 'lingerie shoot on bed' framing as sex scene,",
    "greedy multi-feature hyperfocus, unnatural anatomy.",
  ].join("\n");
}

// Angle spine — a selfie is self-shot (front cam or back cam via mirror).
// Never "BF POV" / "photographer vantage"; "bestie / 闺蜜 shot me" allowed only
// as an explicit scene override, not the default.
export function buildAngleSpine(style: SelfieStyle, count: SelfieCount): string[] {
  if (count === 6) {
    return [
      "LAYOUT: output a single clean 2x3 photo collage (2 columns x 3 rows) — 6 portrait-oriented panels stacked as a single tall image.",
      "All 6 panels are self-shots of the SAME person — same scene vibe, style, and intent, just varied outfit / pose / angle / lighting across panels so she has 6 options to pick from.",
      "NO TEXT OVERLAY, NO LABELS, NO '今日穿搭' / '#ootd' / 'day 1' / watermarks / magazine captions. Just the photos.",
      "Thin white or transparent gutter between panels is OK but keep it minimal — not a polaroid frame, not a brochure.",
      "IDENTICAL FACE across all 6 panels — zero identity drift.",
      "Every panel is self-shot: front camera close-up OR back camera via a mirror. Never an external-photographer vantage.",
      "All 6 panels share the SAME requested style tier — if the user asked for spicy, every panel is spicy; do not pad with safe panels.",
      "Casual phone-snap aesthetic in every tile — iPhone quality, not studio, not editorial.",
    ];
  }
  if (style === "cozy") {
    return [
      "VANTAGE: a real self-shot. Two legit modes, both non-negotiable as 'self-shot':",
      "- Front camera close-up (face + upper body) — default for lazy / bed / just-woke-up / couch / laptop scenes. Most intimate and most common at home.",
      "- Back camera via bathroom or bedroom mirror — when the scene is outfit-forward or needs body in frame.",
      "Never an external-photographer vantage. '闺蜜 took this' only if the scene says so explicitly.",
    ];
  }
  if (style === "glam") {
    return [
      "VANTAGE: a real self-shot. Two legit modes:",
      "- Full-length mirror back-cam (gym / hotel / elevator / store / hallway mirror) — default when the outfit or body line is the point.",
      "- Front camera close-up — default when the scene is cafe / car / restaurant / table close-range (face + cup / face + window).",
      "Never an external-photographer vantage. '闺蜜 took this' only if the scene says so explicitly.",
    ];
  }
  return [
    "VANTAGE: a real self-shot. Two legit modes — DEFAULT to front-cam close-up unless the emphasis forces a mirror.",
    "DEFAULT: Front camera close-up (face + upper body, or lying on bed holding phone, or at vanity).",
    "- Use for emphasis 胸 / 锁骨 / 唇 / 眼神 / upper 腰 / 姿态.",
    "- Also passes content filters MORE RELIABLY than mirror because lower body is cropped out of frame — fewer simultaneously-detected 'intimate content' features.",
    "- Native to tease / 睡前 / bedroom scenes AND to any ambiguous-emphasis spicy scene.",
    "FALLBACK: Full-length mirror back-cam (bedroom / bathroom / hallway / gym / hotel / elevator mirror).",
    "- Use only when emphasis REQUIRES full body: 腿 / 臀 / 背 / 整体.",
    "- Phone partially blocks the face in this framing (see RULE 1).",
    "- Higher filter risk than front-cam at the same skin level — compensate with stronger face-obscure.",
    "MIDDLE GROUND: half-body vanity mirror or bed-edge half-body shot when emphasis is 腰 / 胸 with partial body context.",
    "Never an external-photographer vantage. '闺蜜 took this' only if the scene says so explicitly.",
  ];
}

// Legacy v2-wrap prompt. 111 lines of face/body/identity/angle/style/scene/
// style-line — mirrors the behavior present before the 2026-04-23 redesign.
export function buildV2WrapPrompt(
  scenePrompt: string,
  style: SelfieStyle,
  count: SelfieCount = 1,
): string {
  const face = [
    "These reference photos show the person's FACE — preserve her exact facial features,",
    "eyes, nose, lips, face shape, skin tone, and hair.",
    "Skin quality should look well-maintained and clear from consistent skincare: natural texture is fine,",
    "but avoid obvious acne clusters, inflamed red breakouts, or prominent irritation patches on the face.",
    "BLUSH/REDNESS: keep cheek color minimal and natural — at most a very faint, soft pink flush.",
    "Do NOT paint heavy rosy/red patches on the cheeks; it looks like sunburn or allergic reaction, not cute.",
    "Her skin tone is even and clear, not ruddy. If the scene is warm/post-workout, a subtle healthy glow is fine but no bright red cheeks.",
  ];

  const body = getBodyLines(style);
  const { styleNotes, styleLine } = getStyleBlock(style);
  const angle = buildAngleSpine(style, count);

  return [
    ...face,
    "",
    ...body,
    "",
    "IDENTITY LOCK: this is always the same woman from the reference face photos.",
    "Do not drift identity, age, ethnicity, or core body proportions between generations.",
    "",
    ...angle,
    "",
    ...styleNotes,
    "",
    `Scene: ${scenePrompt}`,
    "",
    styleLine,
    "",
    ANTI_TEXT_DIRECTIVE,
  ].join("\n");
}

// Backwards-compat alias — some external consumers import this name.
export const buildPrompt = buildV2WrapPrompt;
