import { describe, expect, it } from "vitest";
import { classifyScene } from "./classify.ts";
import { selectRoute } from "./provider-routing.ts";

describe("selectRoute — cozy / glam path", () => {
  it("cozy + safe + gemini-safe → gpt-image-2 primary, gemini fallback, v2-wrap (tame cozy body)", () => {
    const cls = classifyScene("Front-cam selfie in a cafe, confident smile, white knit top");
    const r = selectRoute("cozy", cls);
    expect(r.primary).toBe("gpt-image-2");
    expect(r.fallback).toBe("gemini");
    expect(r.promptMode).toBe("v2-wrap");
    expect(r.wrapRescueEligible).toBe(false);
  });

  it("glam + gemini-unsafe (triangle swim) → gpt-image-2 primary, doubao fallback (skip gemini)", () => {
    const cls = classifyScene(
      "Beach scene at golden hour, full face, triangle swim top with cleavage emphasis",
    );
    const r = selectRoute("glam", cls);
    expect(r.primary).toBe("gpt-image-2");
    expect(r.fallback).toBe("doubao");
    expect(r.wrapRescueEligible).toBe(false);
  });

  it("cozy + wet-clinging → fallback flips to doubao", () => {
    const cls = classifyScene("Poolside, wet ribbed top clinging to torso");
    const r = selectRoute("cozy", cls);
    expect(r.primary).toBe("gpt-image-2");
    expect(r.fallback).toBe("doubao");
  });

  it("cozy never activates wrap-rescue (gpt-image-2 path)", () => {
    const cls = classifyScene("bedroom with lace chemise on the bed");
    const r = selectRoute("cozy", cls);
    expect(r.wrapRescueEligible).toBe(false);
  });
});

describe("selectRoute — tease / chunyu path", () => {
  it("tease + safe scene → doubao only, minimal, no rescue", () => {
    const cls = classifyScene("Mirror selfie in bedroom, matte-black leggings, cropped sports bra");
    const r = selectRoute("tease", cls);
    expect(r.primary).toBe("doubao");
    expect(r.fallback).toBeUndefined();
    expect(r.promptMode).toBe("minimal-10line");
    expect(r.wrapRescueEligible).toBe(false);
  });

  it("tease + wardrobe-trigger (chemise) → doubao only, minimal, wrap-rescue armed", () => {
    const cls = classifyScene(
      "Bedroom, black lace chemise with structured lace bra visible, satin sheet",
    );
    const r = selectRoute("tease", cls);
    expect(r.primary).toBe("doubao");
    expect(r.fallback).toBeUndefined();
    expect(r.promptMode).toBe("minimal-10line");
    expect(r.wrapRescueEligible).toBe(true);
  });

  it("chunyu + body-part-trigger (thigh-root) → doubao only, NO rescue", () => {
    const cls = classifyScene("upper-thigh close-up from above, oversized shirt");
    const r = selectRoute("chunyu", cls);
    expect(r.primary).toBe("doubao");
    expect(r.wrapRescueEligible).toBe(false);
  });

  it("chunyu + safe → doubao only, no rescue", () => {
    const cls = classifyScene(
      "Rear-view home gym mirror, matte-black leggings, cropped pink sports bra, 港风运动风",
    );
    const r = selectRoute("chunyu", cls);
    expect(r.primary).toBe("doubao");
    expect(r.fallback).toBeUndefined();
    expect(r.wrapRescueEligible).toBe(false);
  });
});

describe("selectRoute — policy coverage from the research matrix", () => {
  // Corresponds to the four-row table in the handoff doc + step 6 outcomes.
  const cases: Array<{
    label: string;
    style: "cozy" | "glam" | "tease" | "chunyu";
    scene: string;
    expect: {
      primary: "doubao" | "gemini" | "gpt-image-2";
      fallback?: "doubao" | "gemini" | "gpt-image-2";
      wrapRescueEligible: boolean;
    };
  }> = [
    {
      label: "S3 rear-glute mirror (chunyu)",
      style: "chunyu",
      scene:
        "Full-length mirror selfie, back turned to camera, matte-black yoga leggings, cropped pink sports bra, 港风运动风",
      expect: { primary: "doubao", wrapRescueEligible: false },
    },
    {
      label: "S4 deep-V halter restaurant (glam)",
      style: "glam",
      scene:
        "Front-cam selfie in a warm restaurant, face fully visible, black halter with deep V seam",
      expect: { primary: "gpt-image-2", fallback: "gemini", wrapRescueEligible: false },
    },
    {
      label: "S5 stocking-garter bedroom (tease) — wardrobe-trigger",
      style: "tease",
      scene: "Mirror selfie, satin midi with slit, black lace chemise visible, 御姐睡前风",
      expect: { primary: "doubao", wrapRescueEligible: true },
    },
    {
      label: "S1 triangle swim beach (glam) — gemini-unsafe",
      style: "glam",
      scene: "Beach golden hour, triangle swim top, full face visible",
      expect: { primary: "gpt-image-2", fallback: "doubao", wrapRescueEligible: false },
    },
  ];

  for (const c of cases) {
    it(c.label, () => {
      const cls = classifyScene(c.scene);
      const r = selectRoute(c.style, cls);
      expect(r.primary).toBe(c.expect.primary);
      if (c.expect.fallback === undefined) {
        expect(r.fallback).toBeUndefined();
      } else {
        expect(r.fallback).toBe(c.expect.fallback);
      }
      expect(r.wrapRescueEligible).toBe(c.expect.wrapRescueEligible);
    });
  }
});
