import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { dispatchSelfie, type DispatchDeps, type DispatchRequest } from "./dispatch.ts";
import type { GenResult } from "./providers.ts";

function okResult(): GenResult {
  return { ok: true, bytes: Buffer.from([0xff, 0xd8]), ext: "jpeg", mimeType: "image/jpeg" };
}

function failResult(hardReason: string): GenResult {
  return { ok: false, softReason: "fail", hardReason };
}

function makeDeps(overrides: DispatchDeps = {}): Required<DispatchDeps> {
  return {
    callDoubao: overrides.callDoubao ?? vi.fn(async () => okResult()),
    callGemini: overrides.callGemini ?? vi.fn(async () => okResult()),
    callGptImage2: overrides.callGptImage2 ?? vi.fn(async () => okResult()),
  };
}

const BASE_REQ: Omit<DispatchRequest, "style" | "scene" | "count"> = {
  refs: [{ mimeType: "image/jpeg", data: "" }],
  creds: {
    doubao: "doubao-key",
    gemini: "gemini-key",
    gptImage2: { direct: "openai-key" },
  },
};

describe("dispatchSelfie — happy paths", () => {
  it("tease safe scene → doubao primary, minimal prompt, no fallback, no rescue", async () => {
    const deps = makeDeps();
    const result = await dispatchSelfie(
      {
        ...BASE_REQ,
        style: "tease",
        count: 1,
        scene: "Mirror selfie in a bedroom, matte-black leggings, cropped sports bra",
      },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(deps.callDoubao).toHaveBeenCalledTimes(1);
    expect(deps.callGemini).not.toHaveBeenCalled();
    expect(deps.callGptImage2).not.toHaveBeenCalled();
    expect(result.metadata.attempts.length).toBe(1);
    expect(result.metadata.providerUsed).toBe("doubao");
    expect(result.metadata.promptModeUsed).toBe("minimal-10line");
    expect(result.metadata.wrapRescueTriggered).toBe(false);
  });

  it("cozy safe scene → gpt-image-2 primary, gemini fallback (gemini-safe)", async () => {
    const deps = makeDeps();
    const result = await dispatchSelfie(
      {
        ...BASE_REQ,
        style: "cozy",
        count: 1,
        scene: "Front-cam selfie in a cafe, confident smile, white knit top",
      },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(deps.callGptImage2).toHaveBeenCalledTimes(1);
    expect(deps.callGemini).not.toHaveBeenCalled(); // primary succeeded
    expect(result.metadata.route.fallback).toBe("gemini");
    expect(result.metadata.providerUsed).toBe("gpt-image-2");
  });

  it("glam + gemini-unsafe (triangle swim) → fallback flips to doubao", async () => {
    const deps = makeDeps({
      callGptImage2: vi.fn(async () => failResult("moderated")),
      callDoubao: vi.fn(async () => okResult()),
    });
    const result = await dispatchSelfie(
      {
        ...BASE_REQ,
        style: "glam",
        count: 1,
        scene: "Beach golden hour, triangle swim top, full face visible",
      },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(deps.callGptImage2).toHaveBeenCalledTimes(1);
    expect(deps.callDoubao).toHaveBeenCalledTimes(1);
    expect(deps.callGemini).not.toHaveBeenCalled(); // gemini skipped because geminiSafe=false
    expect(result.metadata.route.fallback).toBe("doubao");
  });
});

describe("dispatchSelfie — wrap rescue", () => {
  it("tease + wardrobe-trigger + minimal fail → wrap rescue on doubao", async () => {
    let callNo = 0;
    const doubaoFn = vi.fn(async () => {
      callNo += 1;
      // First call (minimal) fails, second call (wrap rescue) succeeds.
      return callNo === 1 ? failResult("CV filter") : okResult();
    });
    const deps = makeDeps({ callDoubao: doubaoFn });
    const result = await dispatchSelfie(
      {
        ...BASE_REQ,
        style: "tease",
        count: 1,
        scene: "Bedroom, black lace chemise with structured lace bra visible, satin sheet",
      },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(doubaoFn).toHaveBeenCalledTimes(2);
    expect(result.metadata.wrapRescueTriggered).toBe(true);
    expect(result.metadata.attempts.length).toBe(2);
    expect(result.metadata.attempts[0].promptMode).toBe("minimal-10line");
    expect(result.metadata.attempts[1].promptMode).toBe("v2-wrap");
    expect(result.metadata.providerUsed).toBe("doubao");
    expect(result.metadata.promptModeUsed).toBe("v2-wrap");
  });

  it("tease + body-part-trigger + minimal fail → NO wrap rescue (step 6 S2 regression)", async () => {
    const doubaoFn = vi.fn(async () => failResult("CV filter"));
    const deps = makeDeps({ callDoubao: doubaoFn });
    const result = await dispatchSelfie(
      {
        ...BASE_REQ,
        style: "chunyu",
        count: 1,
        scene: "upper-thigh close-up from above, oversized shirt, 居家氛围感",
      },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(doubaoFn).toHaveBeenCalledTimes(1); // no wrap rescue
    expect(result.metadata.wrapRescueTriggered).toBe(false);
  });

  it("tease + safe scene + minimal fail → NO rescue (no wardrobe trigger)", async () => {
    const doubaoFn = vi.fn(async () => failResult("some error"));
    const deps = makeDeps({ callDoubao: doubaoFn });
    const result = await dispatchSelfie(
      {
        ...BASE_REQ,
        style: "tease",
        count: 1,
        scene: "Mirror selfie in bedroom, ribbed top and yoga leggings",
      },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(doubaoFn).toHaveBeenCalledTimes(1); // no rescue on safe scene
    expect(result.metadata.wrapRescueTriggered).toBe(false);
  });

  it("cozy + gpt-image-2 fail + gemini fail → NO wrap rescue (wrap rescue is doubao-only)", async () => {
    const deps = makeDeps({
      callGptImage2: vi.fn(async () => failResult("moderated")),
      callGemini: vi.fn(async () => failResult("blocked")),
      callDoubao: vi.fn(async () => okResult()),
    });
    const result = await dispatchSelfie(
      {
        ...BASE_REQ,
        style: "cozy",
        count: 1,
        scene: "Mirror selfie, white cropped tee, bedroom",
      },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(deps.callDoubao).not.toHaveBeenCalled();
    expect(result.metadata.wrapRescueTriggered).toBe(false);
  });
});

describe("dispatchSelfie — text-overlay stripping", () => {
  it("strips text-render instructions before classification/call", async () => {
    const deps = makeDeps();
    const scene =
      "Front-cam selfie in a cafe. Title text reads '今日穿搭' at top. Confident smile.";
    const result = await dispatchSelfie({ ...BASE_REQ, style: "cozy", count: 1, scene }, deps);
    expect(result.ok).toBe(true);
    expect(result.metadata.textOverlayStripped).toBe(true);
    expect(result.metadata.cleanScene).not.toContain("Title text reads");
    expect(result.metadata.cleanScene).not.toContain("今日穿搭");
  });

  it("leaves clean scenes unchanged", async () => {
    const deps = makeDeps();
    const scene = "Front-cam selfie in a cafe, confident smile.";
    const result = await dispatchSelfie({ ...BASE_REQ, style: "cozy", count: 1, scene }, deps);
    expect(result.ok).toBe(true);
    expect(result.metadata.textOverlayStripped).toBe(false);
    expect(result.metadata.cleanScene).toBe(scene);
  });
});

describe("dispatchSelfie — intensifier stripping", () => {
  it("strips persona-spicy intensifiers before classification/call", async () => {
    const deps = makeDeps();
    const scene =
      "Beach portrait. Wardrobe: very tiny black triangle bikini top, matching micro string bottoms. Face: slight blushing smile. 假日穿搭";
    const result = await dispatchSelfie({ ...BASE_REQ, style: "tease", count: 1, scene }, deps);
    expect(result.ok).toBe(true);
    expect(result.metadata.intensifiersStripped).toBe(true);
    expect(result.metadata.strippedIntensifiers.length).toBeGreaterThanOrEqual(3);
    expect(result.metadata.cleanScene).not.toContain("very tiny");
    expect(result.metadata.cleanScene).not.toContain("string bottoms");
    expect(result.metadata.cleanScene).not.toContain("blushing");
    expect(result.metadata.cleanScene).toContain("triangle bikini top");
    expect(result.metadata.cleanScene).toContain("slight smile");
  });

  it("leaves research-safe scenes unchanged (no intensifiers)", async () => {
    const deps = makeDeps();
    const scene =
      "Wardrobe: teal metallic triangle bikini top, matching iridescent micro bottoms. Face: slight smile.";
    const result = await dispatchSelfie({ ...BASE_REQ, style: "tease", count: 1, scene }, deps);
    expect(result.ok).toBe(true);
    expect(result.metadata.intensifiersStripped).toBe(false);
    expect(result.metadata.strippedIntensifiers).toEqual([]);
    expect(result.metadata.cleanScene).toBe(scene);
  });

  it("runs after text-overlay strip so both flags can fire together", async () => {
    const deps = makeDeps();
    const scene =
      "Beach portrait. Title text reads '今日穿搭' at top. Wardrobe: sultry look, very tiny bikini.";
    const result = await dispatchSelfie({ ...BASE_REQ, style: "tease", count: 1, scene }, deps);
    expect(result.ok).toBe(true);
    expect(result.metadata.textOverlayStripped).toBe(true);
    expect(result.metadata.intensifiersStripped).toBe(true);
    expect(result.metadata.cleanScene).not.toContain("Title text reads");
    expect(result.metadata.cleanScene).not.toContain("very tiny");
    expect(result.metadata.cleanScene).not.toContain("sultry");
  });
});

describe("dispatchSelfie — missing credentials", () => {
  it("fails gracefully when primary provider has no credentials", async () => {
    const result = await dispatchSelfie(
      {
        refs: [{ mimeType: "image/jpeg", data: "" }],
        style: "tease",
        count: 1,
        scene: "bedroom selfie",
        creds: { gemini: "gemini-key" }, // no doubao!
      },
      makeDeps(),
    );
    expect(result.ok).toBe(false);
    expect(result.metadata.attempts[0].ok).toBe(false);
    expect(result.metadata.attempts[0].hardReason).toContain("missing doubao");
  });

  it("fails when gpt-image-2 has neither azure nor direct creds", async () => {
    // Force gemini fallback to also fail so we can inspect the primary's hardReason.
    const result = await dispatchSelfie(
      {
        refs: [{ mimeType: "image/jpeg", data: "" }],
        style: "cozy",
        count: 1,
        scene: "cafe selfie",
        creds: { gemini: "gemini-key" },
      },
      makeDeps({ callGemini: vi.fn(async () => failResult("blocked")) }),
    );
    expect(result.ok).toBe(false);
    expect(result.metadata.attempts[0].hardReason).toContain("azure or direct");
  });
});

describe("dispatchSelfie — grid mode (count=6)", () => {
  it("spicy grid → gemini primary, doubao fallback, v2-wrap prompt", async () => {
    const deps = makeDeps();
    const result = await dispatchSelfie(
      {
        ...BASE_REQ,
        style: "tease",
        count: 6,
        scene: "outfit grid, 2x3",
      },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(deps.callGemini).toHaveBeenCalledTimes(1);
    expect(result.metadata.route.primary).toBe("gemini");
    expect(result.metadata.route.fallback).toBe("doubao");
    expect(result.metadata.promptModeUsed).toBe("v2-wrap");
  });

  it("cozy grid → gpt-image-2 primary, v2-wrap prompt (grid layout needs wrap)", async () => {
    const deps = makeDeps();
    const result = await dispatchSelfie(
      {
        ...BASE_REQ,
        style: "cozy",
        count: 6,
        scene: "outfit grid, 2x3",
      },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(deps.callGptImage2).toHaveBeenCalledTimes(1);
    expect(result.metadata.promptModeUsed).toBe("v2-wrap");
  });
});

describe("dispatchSelfie — metadata completeness", () => {
  it("records originalScene, cleanScene, classification, route, and attempts", async () => {
    const deps = makeDeps();
    const result = await dispatchSelfie(
      {
        ...BASE_REQ,
        style: "tease",
        count: 1,
        scene: "Mirror selfie, black lace chemise visible",
      },
      deps,
    );
    expect(result.metadata.originalScene).toBe("Mirror selfie, black lace chemise visible");
    expect(result.metadata.classification.wardrobeRisk).toBe("wardrobe-trigger");
    expect(result.metadata.route.primary).toBe("doubao");
    expect(result.metadata.route.wrapRescueEligible).toBe(true);
    expect(result.metadata.attempts.length).toBeGreaterThanOrEqual(1);
  });
});
