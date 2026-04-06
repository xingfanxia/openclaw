import { describe, expect, it } from "vitest";
import {
  DEFAULT_ZHUZHU_PERSONA,
  renderPersonaForAgent,
  validatePersonaConfig,
} from "./persona-config.ts";

describe("DEFAULT_ZHUZHU_PERSONA", () => {
  it("has face visibility set to 'usually-full' (露脸 default per correction)", () => {
    expect(DEFAULT_ZHUZHU_PERSONA.faceVisibilityBias).toBe("usually-full");
  });

  it("baseline mood is 'spicy' (zhuzhu runs aggressively spicy by default)", () => {
    expect(DEFAULT_ZHUZHU_PERSONA.baselineMood).toBe("spicy");
  });

  it("has compositionBias with body-forward pose patterns", () => {
    const comps = DEFAULT_ZHUZHU_PERSONA.compositionBias ?? [];
    expect(comps.length).toBeGreaterThan(0);
    expect(comps.some((c) => /rear-view|glute/i.test(c))).toBe(true);
    expect(comps.some((c) => /bending|low-angle|kneel/i.test(c))).toBe(true);
  });

  it("style tags are broad categories, not specific garments", () => {
    const tags = DEFAULT_ZHUZHU_PERSONA.styleTags ?? [];
    expect(tags).toContain("低胸");
    expect(tags).toContain("紧身");
    expect(tags.some((t) => t.includes("露肉"))).toBe(true);
    // Should NOT contain specific garments like "lingerie" or "yoga leggings"
    expect(tags.some((t) => /lingerie|leggings|bra\b/i.test(t))).toBe(false);
  });

  it("has wardrobeCategories covering the 7 user-specified buckets", () => {
    const cats = DEFAULT_ZHUZHU_PERSONA.wardrobeCategories ?? [];
    expect(cats.length).toBeGreaterThanOrEqual(7);
    const labels = cats.map((c) => c.label).join(" | ");
    expect(labels).toMatch(/紧身连衣裙/);
    expect(labels).toMatch(/短裙/);
    expect(labels).toMatch(/运动内衣/);
    expect(labels).toMatch(/包臀裙/);
    expect(labels).toMatch(/瑜伽裤/);
    expect(labels).toMatch(/OL/);
    expect(labels).toMatch(/可爱但很色/);
  });

  it("each wardrobeCategory has at least 2 concrete examples", () => {
    const cats = DEFAULT_ZHUZHU_PERSONA.wardrobeCategories ?? [];
    for (const cat of cats) {
      expect(cat.examples.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("avoidSettings is empty (pref_ref is inspiration, not exclusion)", () => {
    expect(DEFAULT_ZHUZHU_PERSONA.avoidSettings).toEqual([]);
  });

  it("maps '色色' to tease/extreme (bumped from spicy — enforce body-forward)", () => {
    const m = DEFAULT_ZHUZHU_PERSONA.moodMapping?.色色;
    expect(m?.style).toBe("tease");
    expect(m?.mood).toBe("extreme");
  });

  it("maps '自拍看看' to chunyu/spicy (zhuzhu spicy-by-default, not casual)", () => {
    const m = DEFAULT_ZHUZHU_PERSONA.moodMapping?.自拍看看;
    expect(m?.style).toBe("chunyu");
    expect(m?.mood).toBe("spicy");
  });

  it("notes include VOCABULARY DISCIPLINE block decoupling persona spicy from scene prompts", () => {
    const notes = DEFAULT_ZHUZHU_PERSONA.notes ?? "";
    expect(notes).toContain("VOCABULARY DISCIPLINE");
    // Spicy persona shows in chat text, NOT in scene prompt
    expect(notes).toMatch(/CHAT TEXT REPLY[\s\S]*NOT[\s\S]*scene prompt/i);
    // Explicitly calls out the three intensifier classes
    expect(notes).toMatch(/very tiny/);
    expect(notes).toMatch(/\bstring\b/);
    expect(notes).toMatch(/blushing|sultry|mischievous/);
    expect(notes).toMatch(/barely covering|slipping off|straining/);
  });
});

describe("validatePersonaConfig", () => {
  it("returns undefined on null / non-object input", () => {
    expect(validatePersonaConfig(null)).toBeUndefined();
    expect(validatePersonaConfig("string")).toBeUndefined();
    expect(validatePersonaConfig(42)).toBeUndefined();
  });

  it("accepts and narrows a well-formed config", () => {
    const cfg = validatePersonaConfig({
      version: 1,
      styleTags: ["低胸", "紧身"],
      preferredSettings: ["海边"],
      baselineMood: "flirty",
      faceVisibilityBias: "usually-full",
      moodMapping: {
        色色: { style: "tease", mood: "spicy" },
      },
    });
    expect(cfg?.version).toBe(1);
    expect(cfg?.styleTags).toEqual(["低胸", "紧身"]);
    expect(cfg?.baselineMood).toBe("flirty");
    expect(cfg?.faceVisibilityBias).toBe("usually-full");
    expect(cfg?.moodMapping?.色色?.style).toBe("tease");
  });

  it("silently drops invalid mood mappings", () => {
    const cfg = validatePersonaConfig({
      moodMapping: {
        valid: { style: "tease", mood: "spicy" },
        badStyle: { style: "bogus", mood: "spicy" },
        badMood: { style: "tease", mood: "bogus" },
        notAnObject: "nope",
      },
    });
    expect(Object.keys(cfg?.moodMapping ?? {})).toEqual(["valid"]);
  });

  it("ignores unrecognized baselineMood / faceVisibilityBias values", () => {
    const cfg = validatePersonaConfig({
      baselineMood: "nope",
      faceVisibilityBias: "nope",
    });
    expect(cfg?.baselineMood).toBeUndefined();
    expect(cfg?.faceVisibilityBias).toBeUndefined();
  });

  it("accepts defaultVantage when present", () => {
    const cfg = validatePersonaConfig({
      moodMapping: {
        色色: { style: "tease", mood: "spicy", defaultVantage: "mirror" },
      },
    });
    expect(cfg?.moodMapping?.色色?.defaultVantage).toBe("mirror");
  });

  it("returns empty config object for unknown-field-only input (graceful tolerance)", () => {
    const cfg = validatePersonaConfig({ randomField: "x" });
    expect(cfg).toEqual({});
  });

  it("accepts wardrobeCategories with label + examples + optional moodFit", () => {
    const cfg = validatePersonaConfig({
      wardrobeCategories: [
        { label: "OL装", examples: ["blazer", "pencil skirt"], moodFit: ["spicy"] },
        { label: "短裙", examples: ["mini skirt", "crop top"] },
      ],
    });
    expect(cfg?.wardrobeCategories?.length).toBe(2);
    expect(cfg?.wardrobeCategories?.[0]?.label).toBe("OL装");
    expect(cfg?.wardrobeCategories?.[0]?.moodFit).toEqual(["spicy"]);
    expect(cfg?.wardrobeCategories?.[1]?.moodFit).toBeUndefined();
  });

  it("drops wardrobeCategory entries missing label or examples", () => {
    const cfg = validatePersonaConfig({
      wardrobeCategories: [
        { label: "valid", examples: ["a"] },
        { examples: ["b"] },
        { label: "no-examples" },
        { label: "bad-examples", examples: "nope" },
      ],
    });
    expect(cfg?.wardrobeCategories?.length).toBe(1);
    expect(cfg?.wardrobeCategories?.[0]?.label).toBe("valid");
  });
});

describe("renderPersonaForAgent", () => {
  it("includes header + style tags + preferred settings", () => {
    const out = renderPersonaForAgent(DEFAULT_ZHUZHU_PERSONA);
    expect(out).toContain("## Persona selfie taste");
    expect(out).toContain("Wardrobe style tags:");
    expect(out).toContain("低胸");
    expect(out).toContain("Preferred settings (inspiration, not exclusive):");
    expect(out).toContain("海边");
  });

  it("includes moodMapping keywords and their style/mood pairs", () => {
    const out = renderPersonaForAgent(DEFAULT_ZHUZHU_PERSONA);
    expect(out).toContain("User-keyword → mode mapping:");
    expect(out).toContain('"色色" → style=tease, mood=extreme');
    expect(out).toContain('"自拍看看" → style=chunyu, mood=spicy');
  });

  it("includes face visibility bias", () => {
    const out = renderPersonaForAgent(DEFAULT_ZHUZHU_PERSONA);
    expect(out).toContain("Face visibility bias: usually-full");
  });

  it("omits absent sections gracefully", () => {
    const out = renderPersonaForAgent({ version: 1 });
    expect(out).toBe("## Persona selfie taste (for scene authoring)");
  });

  it("renders compositionBias as a bulleted list", () => {
    const out = renderPersonaForAgent({
      compositionBias: ["rear-view glute", "low-angle seated thigh"],
    });
    expect(out).toContain("Preferred compositions / poses");
    expect(out).toContain("  - rear-view glute");
    expect(out).toContain("  - low-angle seated thigh");
  });

  it("skips empty avoidSettings", () => {
    const out = renderPersonaForAgent(DEFAULT_ZHUZHU_PERSONA);
    expect(out).not.toContain("Avoid these settings:");
  });

  it("shows avoidSettings when present", () => {
    const out = renderPersonaForAgent({ avoidSettings: ["gym", "street"] });
    expect(out).toContain("Avoid these settings: gym, street");
  });

  it("includes vantage suffix on moodMapping entries when set", () => {
    const out = renderPersonaForAgent({
      moodMapping: { 色色: { style: "tease", mood: "spicy", defaultVantage: "mirror" } },
    });
    expect(out).toContain('"色色" → style=tease, mood=spicy (vantage: mirror)');
  });

  it("renders wardrobeCategories menu with rotation rule", () => {
    const out = renderPersonaForAgent(DEFAULT_ZHUZHU_PERSONA);
    expect(out).toContain("Wardrobe category menu");
    expect(out).toContain("ROTATE across these");
    expect(out).toContain("紧身连衣裙");
    expect(out).toContain("运动内衣");
    expect(out).toContain("包臀裙");
    expect(out).toContain("OL装");
    expect(out).toContain("Rotation rule");
    expect(out).toContain("do NOT default to emerald green");
  });

  it("renders moodFit suffix on wardrobeCategory when present", () => {
    const out = renderPersonaForAgent({
      wardrobeCategories: [
        { label: "Test", examples: ["ex1", "ex2"], moodFit: ["spicy", "extreme"] },
      ],
    });
    expect(out).toMatch(/• Test \[moods: spicy \/ extreme\]/);
  });

  it("skips moodFit suffix when not specified", () => {
    const out = renderPersonaForAgent({
      wardrobeCategories: [{ label: "Test", examples: ["ex1", "ex2"] }],
    });
    expect(out).toContain("• Test");
    expect(out).not.toContain("[moods:");
  });
});
