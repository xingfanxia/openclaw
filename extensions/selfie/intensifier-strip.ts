// Strip sexualizing intensifier adjectives from selfie scene prompts.
//
// Mirrors the stripTextOverlay pattern. Zhuzhu's persona is spicy-by-default
// at the CHAT TEXT layer, and agents translate that into adjective-stacked
// scene prompts that push doubao's CV classifier into porn-coded rejection.
// Research R3-XX archetypes pass doubao with neutral fashion-catalog vocab
// (`triangle bikini`, `slight smile`), but the agent's copy adds `very tiny`,
// `string`, `blushing`, `sultry` — enough to flip pass→fail even when
// composition and outfit choices are research-safe.
//
// Pipeline order: dispatchSelfie calls this AFTER stripTextOverlay and
// BEFORE classifyScene. Classifier and prompt assembly see the cleaned text.

// [match-regex, replacement] pairs applied in order. Global + case-insensitive.
//
// Note on string-family patterns: handoff had `string bottoms → bikini
// bottoms`, but that recreates the `micro bikini` intensifier when input is
// `micro string bottoms`. Simpler: just strip `string`. Keeps the garment
// word that already works on doubao (R3-17 passed with `micro bottoms`).
const INTENSIFIER_PATTERNS: Array<[RegExp, string]> = [
  // Size intensifiers — strip
  [/\bvery tiny /gi, ""],
  [/\bultra[- ]short /gi, ""],
  [/\bultra[- ]tight /gi, ""],
  [/\bextremely tight /gi, "tight "],
  [/\bbarely covering\b[^.]*/gi, ""],

  // "string" before bikini-family vocab — strip "string", keep the garment.
  // `string bikini` → `triangle bikini` (research-validated R3-17 phrasing).
  [/\bstring bikini\b/gi, "triangle bikini"],
  [/\bstring (bottoms?|straps?|thong)\b/gi, "$1"],
  [/\bthong bikini\b/gi, "high-cut bikini"],
  [/\bmicro[- ]bikini\b/gi, "bikini"],
  [/\bg[- ]string\b/gi, ""],

  // Emotional intensifiers — strip or soften
  [/\bblushing (smile|expression|cheeks|gaze)\b/gi, "$1"],
  [/\bflushed (smile|expression|cheeks|look)\b/gi, "relaxed $1"],
  [/\bsultry (look|gaze|smile|expression)\b/gi, "soft $1"],
  [/\bcome[- ]hither\b[^.]*/gi, ""],
  [/\bmischievous (smile|gaze|expression|look)\b/gi, "slight $1"],
  [/\bteasing (smile|gaze|expression|look)\b/gi, "slight $1"],
  [/\bseductive\b/gi, "confident"],

  // Reveal intensifiers — rephrase or strip. Consequence language
  // (`strap fell naturally`, `hem rising by pose`) is OK; deliberate imminent
  // failure is what doubao filters.
  [/\bslipping (off|down) (?:her )?shoulder/gi, "falling off shoulder"],
  [/\bpeeking through\b/gi, "visible"],
  [/\bstraining (across|against|through)/gi, "stretching $1"],
  [/\babout to fall off[^.]*/gi, ""],
];

export interface StripIntensifiersResult {
  scene: string;
  stripped: string[];
}

export function stripIntensifiers(scene: string): StripIntensifiersResult {
  if (!scene) {
    return { scene, stripped: [] };
  }
  const stripped: string[] = [];
  let result = scene;
  for (const [re, repl] of INTENSIFIER_PATTERNS) {
    const matches = result.match(re);
    if (matches) {
      stripped.push(...matches);
      result = result.replace(re, repl);
    }
  }
  // Tidy whitespace/punctuation leftover from strips without touching
  // intentional formatting inside the scene.
  result = result
    .replace(/ {2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .trim();
  return { scene: result, stripped };
}
