import { describe, expect, it } from "vitest";
import { stripIntensifiers } from "./intensifier-strip.ts";

describe("stripIntensifiers — size intensifiers", () => {
  it("strips 'very tiny' keeping the garment vocab", () => {
    const { scene, stripped } = stripIntensifiers("very tiny black triangle bikini top");
    expect(scene).toBe("black triangle bikini top");
    expect(stripped).toContain("very tiny ");
  });

  it("strips 'ultra-short' and 'ultra short'", () => {
    expect(stripIntensifiers("ultra-short denim micro-skirt").scene).toBe("denim micro-skirt");
    expect(stripIntensifiers("ultra short leather shorts").scene).toBe("leather shorts");
  });

  it("strips 'ultra-tight' / 'ultra tight' variants", () => {
    expect(stripIntensifiers("ultra-tight bodycon dress").scene).toBe("bodycon dress");
    expect(stripIntensifiers("ultra tight yoga leggings").scene).toBe("yoga leggings");
  });

  it("softens 'extremely tight' to 'tight'", () => {
    expect(stripIntensifiers("extremely tight leggings").scene).toBe("tight leggings");
  });

  it("consumes the 'barely covering ...' clause up to the next sentence boundary", () => {
    const { scene } = stripIntensifiers(
      "Wardrobe: red bikini barely covering her chest with exposed straps. Pose: standing.",
    );
    expect(scene).toBe("Wardrobe: red bikini. Pose: standing.");
  });
});

describe("stripIntensifiers — string-family vocab", () => {
  it("rewrites 'string bikini' to research-validated 'triangle bikini'", () => {
    expect(stripIntensifiers("teal string bikini top").scene).toBe("teal triangle bikini top");
  });

  it("strips 'string' before 'bottoms' but keeps surrounding descriptors (e.g. 'micro')", () => {
    // Research note: `micro bottoms` passed doubao in R3-17; the trigger word
    // is `string`, not `micro`.
    expect(stripIntensifiers("matching micro string bottoms").scene).toBe("matching micro bottoms");
    expect(stripIntensifiers("string bottom").scene).toBe("bottom");
  });

  it("strips 'string' before 'straps'", () => {
    expect(stripIntensifiers("visible string straps").scene).toBe("visible straps");
  });

  it("rewrites 'thong bikini' to 'high-cut bikini'", () => {
    expect(stripIntensifiers("black thong bikini on beach").scene).toBe(
      "black high-cut bikini on beach",
    );
  });

  it("rewrites 'micro-bikini' / 'micro bikini' to plain 'bikini'", () => {
    expect(stripIntensifiers("iridescent micro-bikini").scene).toBe("iridescent bikini");
    expect(stripIntensifiers("iridescent micro bikini").scene).toBe("iridescent bikini");
  });

  it("strips 'g-string' entirely", () => {
    expect(stripIntensifiers("g-string visible").scene).toBe("visible");
    expect(stripIntensifiers("g string visible").scene).toBe("visible");
  });
});

describe("stripIntensifiers — emotional intensifiers", () => {
  it("strips 'blushing' before smile/expression/cheeks/gaze", () => {
    expect(stripIntensifiers("slight blushing smile").scene).toBe("slight smile");
    expect(stripIntensifiers("blushing expression at camera").scene).toBe("expression at camera");
    expect(stripIntensifiers("blushing cheeks").scene).toBe("cheeks");
  });

  it("softens 'flushed' expressions to 'relaxed'", () => {
    expect(stripIntensifiers("flushed smile").scene).toBe("relaxed smile");
    expect(stripIntensifiers("flushed look").scene).toBe("relaxed look");
  });

  it("softens 'sultry' looks/gazes to 'soft'", () => {
    expect(stripIntensifiers("sultry look at camera").scene).toBe("soft look at camera");
    expect(stripIntensifiers("sultry gaze").scene).toBe("soft gaze");
  });

  it("removes 'come-hither ...' clauses up to the next sentence boundary", () => {
    const { scene } = stripIntensifiers(
      "Face: come-hither gaze over shoulder toward lens. Pose: seated.",
    );
    expect(scene).toBe("Face:. Pose: seated.");
  });

  it("softens 'mischievous' and 'teasing' to 'slight'", () => {
    expect(stripIntensifiers("mischievous smile at lens").scene).toBe("slight smile at lens");
    expect(stripIntensifiers("teasing gaze").scene).toBe("slight gaze");
  });

  it("rewrites 'seductive' to 'confident'", () => {
    expect(stripIntensifiers("seductive pose on bed").scene).toBe("confident pose on bed");
  });
});

describe("stripIntensifiers — reveal intensifiers", () => {
  it("normalizes 'slipping off/down (her) shoulder' to 'falling off shoulder'", () => {
    expect(stripIntensifiers("strap slipping off shoulder").scene).toBe(
      "strap falling off shoulder",
    );
    expect(stripIntensifiers("strap slipping down her shoulder").scene).toBe(
      "strap falling off shoulder",
    );
  });

  it("rewrites 'peeking through' to 'visible'", () => {
    expect(stripIntensifiers("bralette peeking through open shirt").scene).toBe(
      "bralette visible open shirt",
    );
  });

  it("softens 'straining across/against/through' to 'stretching'", () => {
    expect(stripIntensifiers("fabric straining across chest").scene).toBe(
      "fabric stretching across chest",
    );
    expect(stripIntensifiers("leggings straining through the seam").scene).toBe(
      "leggings stretching through the seam",
    );
  });

  it("removes 'about to fall off ...' clauses up to the next sentence boundary", () => {
    const { scene } = stripIntensifiers(
      "top about to fall off with every movement. Pose: leaning forward.",
    );
    expect(scene).toBe("top. Pose: leaning forward.");
  });
});

describe("stripIntensifiers — composition + whitespace cleanup", () => {
  it("cleans up double spaces and trailing space before punctuation", () => {
    const { scene } = stripIntensifiers(
      "Wardrobe: very tiny black triangle bikini top , matching micro string bottoms , slight blushing smile.",
    );
    expect(scene).toBe(
      "Wardrobe: black triangle bikini top, matching micro bottoms, slight smile.",
    );
  });

  it("applies multiple intensifier fixes in the same scene", () => {
    const { scene, stripped } = stripIntensifiers(
      "very tiny string bikini top. Face: sultry look. Pose: seductive lean.",
    );
    expect(scene).toBe("triangle bikini top. Face: soft look. Pose: confident lean.");
    expect(stripped.length).toBeGreaterThanOrEqual(4);
  });

  it("is a no-op on research-safe scenes (no intensifiers present)", () => {
    const safeScene =
      "Outdoor beach standing portrait at Waikiki waterfront. Face fully visible — direct front-facing gaze, slight smile. Wardrobe: teal metallic triangle bikini top, matching iridescent micro bottoms.";
    const { scene, stripped } = stripIntensifiers(safeScene);
    expect(scene).toBe(safeScene);
    expect(stripped).toEqual([]);
  });

  it("handles empty input gracefully", () => {
    expect(stripIntensifiers("")).toEqual({ scene: "", stripped: [] });
  });

  it("is case-insensitive", () => {
    expect(stripIntensifiers("VERY TINY black bikini").scene).toBe("black bikini");
    expect(stripIntensifiers("Sultry Look").scene).toBe("soft Look");
  });

  it("stripped[] contains what was removed, preserving agent-written casing", () => {
    const { stripped } = stripIntensifiers("VERY TINY triangle bikini, slight Blushing Smile");
    expect(stripped).toContain("VERY TINY ");
    expect(stripped).toContain("Blushing Smile");
  });
});
