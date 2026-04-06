// Route selection: given the tool-call style and the classifier's read of
// the scene, pick which provider to call first, which to fall back to, and
// whether to assemble the minimal 10-line prompt or the v2 wrap.
//
// Rules derived from the 2026-04-23 study (B5 + step 4b + step 6):
// - cozy / glam → gpt-image-2 primary (medium quality, ~10% random filter).
//   Fallback is gemini when the scene is gemini-safe; otherwise doubao so
//   we don't burn calls on the 3 un-gemini categories.
// - tease / chunyu → doubao only (no fallback). Doubao handles spicy 7/8 on
//   step 6 with minimal wrap; other providers either hard-fail (gemini) or
//   moderate (gpt-image-2).
// - Prompt mode: v2-wrap is useful ONLY on doubao AND only for
//   wardrobe-trigger scenes (step 4b +50pp rescue; step 6 S2 body-part-trigger
//   regression). Default is minimal-10line elsewhere. Rescue logic in
//   dispatch.ts decides when to actually swap — this function only declares
//   the initial mode.

import type { SceneClassification } from "./classify.ts";
import type { SelfieCount, SelfieStyle } from "./types.ts";

export type Provider = "doubao" | "gemini" | "gpt-image-2";

export type PromptMode = "minimal-10line" | "v2-wrap";

export interface ProviderRoute {
  primary: Provider;
  fallback?: Provider;
  /** Prompt mode to use on the FIRST attempt. Rescue may swap later. */
  promptMode: PromptMode;
  /**
   * Whether dispatch is allowed to retry with v2-wrap after a minimal failure.
   * Only true when primary is doubao and wardrobeRisk is 'wardrobe-trigger'.
   */
  wrapRescueEligible: boolean;
}

export function selectRoute(
  style: SelfieStyle,
  cls: SceneClassification,
  count: SelfieCount = 1,
): ProviderRoute {
  const isSpicy = style === "tease" || style === "chunyu";
  const isGrid = count === 6;

  // count=6 grid layout instructions only live in the v2 wrap's angle spine.
  // Grid spicy uses gemini primary (faster + better face consistency across
  // 6 tiles per pre-2026-04-23 observation). Grid cozy/glam uses gpt-image-2
  // with gemini/doubao fallback like single-panel.
  if (isSpicy && isGrid) {
    return {
      primary: "gemini",
      fallback: "doubao",
      promptMode: "v2-wrap",
      wrapRescueEligible: false,
    };
  }

  if (isSpicy) {
    return {
      primary: "doubao",
      promptMode: "minimal-10line",
      wrapRescueEligible: cls.wardrobeRisk === "wardrobe-trigger",
    };
  }

  // cozy / glam — always v2-wrap. Style-specific tame body + COZY/GLAM_BLOCK
  // styleNotes ("no filter / bare face / not polished / not trying to look
  // good") are explicit anti-suggestive signals that help pass OpenAI
  // moderation on gpt-image-2. Minimal's bare "fit-curvy hourglass" line
  // without surrounding context tripped moderation_blocked in Azure/direct
  // smoke (2026-04-23). The step-4/5/6 "minimal beats v2-wrap" finding was
  // specifically for tease/chunyu on doubao/gemini, not cozy/glam.
  const fallback: Provider = cls.geminiSafe ? "gemini" : "doubao";
  return {
    primary: "gpt-image-2",
    fallback,
    promptMode: "v2-wrap",
    wrapRescueEligible: false,
  };
}
