// Strip or detect "render text on the image" instructions inside a selfie
// scene paragraph. Agents and users sometimes ask for title / caption /
// watermark overlays; both doubao and gemini will render them literally.
//
// Seeds consolidated from three places:
// 1. step4-repro-and-rescue.ts — sentence-level strip pattern (proven over
//    ~820 calls in the 2026-04-23 study).
// 2. audit-pass-cases.ts — detection pattern list (includes Chinese anchor
//    variants and imperative forms).
// 3. Chinese anchor patterns flagged on 17 doubao audit pass cases.
//
// Design: a single source-of-truth alternative list drives both detection
// (hasTextOverlayRequest) and sentence-level deletion (stripTextOverlay).
// Always-on, not gated on any flag — flagging missed gemini cases in the
// study because gemini's scene.json.caption was often null.

const TRIGGER_ALTERNATIVES = [
  // "title" + verb / position
  "title\\s+(?:text\\s+reads|references?|reads|card|overlay|on\\s+(?:top|image)|at\\s+(?:top|bottom)|says)",
  "subtitle\\s+reads",
  "heading\\s+(?:reads|on|at)",
  "header\\s+(?:at|on|reads|says)",

  // "caption" + verb / position
  "caption\\s+(?:at|in|on|overlay|across|reads|says)",
  "(?:captioned|labell?ed|titled|tagged)\\s+['\"\\u201C\\u2018]",

  // "text" + verb / position
  "text\\s+(?:overlay|on\\s+image|in\\s+corner|at\\s+(?:top|bottom)|reads|says)",
  "label\\s+reads",
  "word(?:s)?\\s+(?:reading|saying)\\s+['\"\\u201C\\u2018]",
  "written\\s+['\"\\u201C\\u2018]",
  "overlay\\s+reads",

  // Watermark / banner / sticker
  "watermark\\s+(?:visible|reading|in\\s+corner)",
  "banner\\s+(?:reading|text|saying)",
  "sticker\\s+(?:with\\s+text|reads|saying)",

  // Imperative forms — "add a title", "render the caption"
  "add\\s+(?:a\\s+)?(?:title|caption|header|text|subtitle|watermark|banner)",
  "(?:write|render|include|display)\\s+(?:the\\s+)?(?:title|caption|text|words?\\s+reading|subtitle)",

  // Chinese XHS anchor patterns — common in 今日穿搭 / 分享 XHS captions
  "今日穿搭.{0,10}(?:header|top|标题|字)",
  "分享.{0,10}(?:title|header|标题|在顶|顶部)",
];

export const TEXT_OVERLAY_PATTERNS: readonly RegExp[] = TRIGGER_ALTERNATIVES.map(
  (src) => new RegExp(src, "i"),
);

// Sentence-level removal regex. The capture group consumes from the previous
// sentence boundary (`.!?\n` or start-of-input) up to and including the next
// boundary, so a whole overlay-instruction sentence is excised while the
// surrounding scene text is preserved.
const TEXT_OVERLAY_SENTENCE = new RegExp(
  "([^.!?\\n]*?(?:" + TRIGGER_ALTERNATIVES.join("|") + ")[^.!?\\n]*[.!?\\n])",
  "gi",
);

export function hasTextOverlayRequest(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }
  return TEXT_OVERLAY_PATTERNS.some((rx) => rx.test(text));
}

export function stripTextOverlay(text: string): string {
  if (!text) {
    return text;
  }
  return text
    .replace(TEXT_OVERLAY_SENTENCE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
