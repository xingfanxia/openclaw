import { describe, expect, it } from "vitest";
import {
  buildAngleSpine,
  buildMinimalPrompt,
  buildPrompt,
  buildV2WrapPrompt,
} from "./prompt-assembly.ts";

describe("buildMinimalPrompt", () => {
  it("produces the research-verbatim ref3 minimal spine (step6 minimalWrap byte-identical)", () => {
    const out = buildMinimalPrompt("Scene content here");
    const expected = [
      "These reference photos show the person's FACE — preserve her exact facial features,",
      "eyes, nose, lips, face shape, skin tone, and hair.",
      "Skin is clear and well-maintained: natural texture, no acne clusters, no red sunburn patches.",
      "",
      "BODY: Adult woman (23), fit-curvy hourglass build.",
      "SINGLE EMPHASIS — the scene below calls out ONE body feature. Do not stack multiple.",
      "",
      "Scene: Scene content here",
      "",
      "AVOID: nudity, topless, visible genitals, 'lingerie shoot on bed' framing as sex scene,",
      "greedy multi-feature hyperfocus, unnatural anatomy.",
    ].join("\n");
    expect(out).toBe(expected);
  });

  it("does NOT add ANY scaffolding lines beyond face/body/scene/avoid", () => {
    // Regression guard: adding scaffolding lines (Aesthetic, anti-text,
    // vibe-framing) introduces negative vocabulary tokens that doubao's
    // text classifier indexes against, even under `NOT X` framing.
    // See docs/reports/selfie-intensifier-fix/root-cause-2026-04-24-pink-bikini.md
    const out = buildMinimalPrompt("scene");
    // Anti-text directive (removed 2026-04-24 morning — regressed doubao 60pp).
    expect(out).not.toContain("NO TEXT ON IMAGE");
    expect(out).not.toContain("no watermark");
    expect(out).not.toContain("@username handle");
    expect(out).not.toContain("小红书 / XHS");
    // Aesthetic line (removed 2026-04-24 afternoon — regressed R3-17 pink bikini).
    expect(out).not.toContain("Aesthetic:");
    expect(out).not.toContain("pornographic");
    expect(out).not.toContain("Fashion-intimate");
    expect(out).not.toMatch(/\bOOTD\b/);
  });

  it("matches step4 Phase 4a prompt.txt format used by research (5/5 on R3-17)", () => {
    // Research step4-repro-and-rescue.ts Phase 4a feeds prompt.txt VERBATIM
    // to doubao — no plugin wrap layer on top. prompt.txt content IS the
    // full prompt. buildMinimalPrompt must produce the exact same shape so
    // dispatch.ts's plumbing matches what research validated.
    const researchScene =
      "Outdoor beach standing portrait at Waikiki waterfront. Face is fully visible — direct front-facing gaze, slight smile, flower in hair, natural glow. Emphasis on cleavage. 假日穿搭";
    const out = buildMinimalPrompt(researchScene);
    // Exact order and line count per step6-extreme-stress.ts minimalWrap.
    const lines = out.split("\n");
    expect(lines).toHaveLength(11);
    expect(lines[0]).toBe(
      "These reference photos show the person's FACE — preserve her exact facial features,",
    );
    expect(lines[4]).toBe("BODY: Adult woman (23), fit-curvy hourglass build.");
    expect(lines[7]).toBe(`Scene: ${researchScene}`);
    expect(lines[9]).toBe(
      "AVOID: nudity, topless, visible genitals, 'lingerie shoot on bed' framing as sex scene,",
    );
  });

  it("does not include any wardrobe style block", () => {
    const out = buildMinimalPrompt("plain scene");
    expect(out).not.toContain("VANTAGE:");
    expect(out).not.toContain("IDENTITY LOCK");
    expect(out).not.toContain("XHS v2");
  });

  it("preserves the scene paragraph exactly", () => {
    const scene =
      "Mirror selfie, satin midi with high side slit, sheer black stockings with narrow lace band, 御姐睡前风";
    const out = buildMinimalPrompt(scene);
    expect(out).toContain(`Scene: ${scene}`);
  });

  it("does NOT strip text-overlay language — that's dispatch.ts's job", () => {
    // Callers are expected to run stripTextOverlay BEFORE buildMinimalPrompt.
    const scene = "Front-cam selfie. Title text reads '御姐' at top.";
    const out = buildMinimalPrompt(scene);
    expect(out).toContain("Title text reads");
  });
});

describe("buildV2WrapPrompt", () => {
  it("includes face + body + identity + angle + style + scene + style-line blocks", () => {
    const out = buildV2WrapPrompt("Scene X", "tease", 1);
    expect(out).toContain("These reference photos show");
    expect(out).toContain("IDENTITY LOCK");
    expect(out).toContain("VANTAGE:");
    expect(out).toContain("Scene: Scene X");
  });

  it("includes anti-text / anti-watermark directive for all styles / counts", () => {
    for (const style of ["cozy", "glam", "tease", "chunyu"] as const) {
      for (const count of [1, 6] as const) {
        const out = buildV2WrapPrompt("scene", style, count);
        expect(out).toContain("NO TEXT ON IMAGE");
        expect(out).toContain("no watermark");
      }
    }
  });

  it("scales differently for count=6 (grid layout)", () => {
    const single = buildV2WrapPrompt("A scene", "chunyu", 1);
    const grid = buildV2WrapPrompt("A scene", "chunyu", 6);
    expect(grid).toContain("LAYOUT: output a single clean 2x3 photo collage");
    expect(grid).toContain("IDENTICAL FACE across all 6 panels");
    expect(single).not.toContain("IDENTICAL FACE across all 6 panels");
  });

  it("varies angle spine across cozy / glam / tease", () => {
    const cozy = buildV2WrapPrompt("s", "cozy", 1);
    const glam = buildV2WrapPrompt("s", "glam", 1);
    const tease = buildV2WrapPrompt("s", "tease", 1);
    expect(cozy).toContain("default for lazy / bed");
    expect(glam).toContain("Full-length mirror back-cam (gym / hotel");
    expect(tease).toContain("DEFAULT to front-cam close-up");
  });
});

describe("buildAngleSpine", () => {
  it("count=6 returns the grid collage spine regardless of style", () => {
    for (const s of ["cozy", "glam", "tease", "chunyu"] as const) {
      const spine = buildAngleSpine(s, 6);
      expect(spine[0]).toContain("LAYOUT: output a single clean 2x3");
    }
  });

  it("single-image tease/chunyu shares the same default-front spine", () => {
    const tease = buildAngleSpine("tease", 1);
    const chunyu = buildAngleSpine("chunyu", 1);
    expect(tease).toEqual(chunyu);
    expect(tease[0]).toContain("DEFAULT to front-cam close-up");
  });
});

describe("buildPrompt backwards-compat alias", () => {
  it("is the same function as buildV2WrapPrompt", () => {
    expect(buildPrompt).toBe(buildV2WrapPrompt);
  });
});
