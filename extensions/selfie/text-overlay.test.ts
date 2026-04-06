import { describe, expect, it } from "vitest";
import { hasTextOverlayRequest, stripTextOverlay } from "./text-overlay.ts";

describe("hasTextOverlayRequest", () => {
  it("returns false on empty / null / undefined", () => {
    expect(hasTextOverlayRequest("")).toBe(false);
    expect(hasTextOverlayRequest(null)).toBe(false);
    expect(hasTextOverlayRequest(undefined)).toBe(false);
  });

  it("detects 'Title text reads' / 'title reads' / 'title on top' variants", () => {
    expect(hasTextOverlayRequest("Title text reads '御姐穿搭' at top")).toBe(true);
    expect(hasTextOverlayRequest("A title reads '夏日' across the photo")).toBe(true);
    expect(hasTextOverlayRequest("title on top of the image")).toBe(true);
    expect(hasTextOverlayRequest("title card appears briefly")).toBe(true);
  });

  it("detects caption + verb forms", () => {
    expect(hasTextOverlayRequest("Caption reads '今日穿搭'")).toBe(true);
    expect(hasTextOverlayRequest("Caption at the bottom says hello")).toBe(true);
    expect(hasTextOverlayRequest("photo captioned 'stylish'")).toBe(true);
    expect(hasTextOverlayRequest("image labelled 'day out'")).toBe(true);
    expect(hasTextOverlayRequest('labeled "outfit"')).toBe(true);
    expect(hasTextOverlayRequest("titled 'Saturday'")).toBe(true);
    expect(hasTextOverlayRequest("tagged '日常'")).toBe(true);
  });

  it("detects text overlay / label / word variants", () => {
    expect(hasTextOverlayRequest("Text overlay reads '七夕'")).toBe(true);
    expect(hasTextOverlayRequest("text on image shows the date")).toBe(true);
    expect(hasTextOverlayRequest("text in corner identifies brand")).toBe(true);
    expect(hasTextOverlayRequest("Label reads '秋日'")).toBe(true);
    expect(hasTextOverlayRequest("words reading 'Hello'")).toBe(true);
    expect(hasTextOverlayRequest("written '御姐风'")).toBe(true);
    expect(hasTextOverlayRequest("overlay reads 'vacation'")).toBe(true);
  });

  it("detects watermark / banner / sticker with text", () => {
    expect(hasTextOverlayRequest("watermark visible in corner")).toBe(true);
    expect(hasTextOverlayRequest("watermark reading '@zhuzhu'")).toBe(true);
    expect(hasTextOverlayRequest("banner reading '新品'")).toBe(true);
    expect(hasTextOverlayRequest("sticker with text '今日穿搭'")).toBe(true);
  });

  it("detects imperative forms ('add a title', 'render the caption')", () => {
    expect(hasTextOverlayRequest("Add a title at the top")).toBe(true);
    expect(hasTextOverlayRequest("add header across the banner")).toBe(true);
    expect(hasTextOverlayRequest("render the caption '休息时间'")).toBe(true);
    expect(hasTextOverlayRequest("write the title on top")).toBe(true);
    expect(hasTextOverlayRequest("include the subtitle '御姐穿搭'")).toBe(true);
    expect(hasTextOverlayRequest("display text reading 'day 1'")).toBe(true);
  });

  it("detects Chinese XHS anchor patterns", () => {
    expect(hasTextOverlayRequest("今日穿搭 header on top")).toBe(true);
    expect(hasTextOverlayRequest("今日穿搭 标题 在顶部")).toBe(true);
    expect(hasTextOverlayRequest("分享 title 在顶部")).toBe(true);
    expect(hasTextOverlayRequest("分享 header 标题")).toBe(true);
  });

  it("does NOT trigger on bare nouns that happen to appear in scenes", () => {
    // "title" without a verb/position should not trigger
    expect(hasTextOverlayRequest("She has a title role in the movie")).toBe(false);
    // "label" without "reads"
    expect(hasTextOverlayRequest("wardrobe label visible inside")).toBe(false);
    // "banner" without text verb
    expect(hasTextOverlayRequest("restaurant banner hanging over the entrance")).toBe(false);
    // "written" without quote mark (not a text-render ask)
    expect(hasTextOverlayRequest("The script was written by her")).toBe(false);
    // bare "watermark" without verb
    expect(hasTextOverlayRequest("faint watermark pattern in the silk")).toBe(false);
    // "caption" with "of" — describing, not instructing
    expect(hasTextOverlayRequest("long caption of the post describes her")).toBe(false);
  });

  it("does not trigger on plain selfie scenes", () => {
    expect(
      hasTextOverlayRequest(
        "Front-cam selfie in a warm-toned restaurant, confident slight smile, black halter top with deep V seam.",
      ),
    ).toBe(false);
    expect(
      hasTextOverlayRequest(
        "Full-length mirror selfie, back turned to camera, matte-black seamless leggings, 港风运动风",
      ),
    ).toBe(false);
  });
});

describe("stripTextOverlay", () => {
  it("leaves plain scene text unchanged", () => {
    const scene =
      "Front-cam selfie from above, face fully visible with confident smile, black halter neckline top with deep V seam. 港风都市风";
    expect(stripTextOverlay(scene)).toBe(scene);
  });

  it("removes an overlay sentence from a multi-sentence scene", () => {
    const scene =
      "Front-cam selfie in a warm-toned restaurant. Text overlay reads '今日穿搭' at the top. Cropped face with confident smile.";
    const cleaned = stripTextOverlay(scene);
    expect(cleaned).not.toContain("Text overlay");
    expect(cleaned).not.toContain("今日穿搭");
    expect(cleaned).toContain("Front-cam selfie");
    expect(cleaned).toContain("Cropped face");
  });

  it("removes an imperative overlay sentence", () => {
    const scene =
      "Mirror selfie in a bedroom. Add a title '御姐睡前' at the top. Satin midi dress.";
    const cleaned = stripTextOverlay(scene);
    expect(cleaned).not.toContain("Add a title");
    expect(cleaned).toContain("Satin midi dress");
    expect(cleaned).toContain("Mirror selfie");
  });

  it("removes sentences ending only by newline (no period)", () => {
    const scene = "Title text reads '御姐穿搭'\nMirror selfie in a bedroom.";
    const cleaned = stripTextOverlay(scene);
    expect(cleaned).not.toContain("御姐穿搭");
    expect(cleaned).toContain("Mirror selfie");
  });

  it("removes Chinese anchor patterns", () => {
    const scene = "Cafe front-cam. 今日穿搭 header on top. 港风都市风";
    const cleaned = stripTextOverlay(scene);
    expect(cleaned).not.toContain("header on top");
    expect(cleaned).toContain("Cafe front-cam");
    expect(cleaned).toContain("港风都市风");
  });

  it("removes multiple overlay sentences in one pass", () => {
    const scene =
      "Scene description. Title text reads '夏日'. Text overlay reads 'vacation' in the corner. More scene.";
    const cleaned = stripTextOverlay(scene);
    expect(cleaned).not.toContain("夏日");
    expect(cleaned).not.toContain("vacation");
    expect(cleaned).toContain("Scene description");
    expect(cleaned).toContain("More scene");
  });

  it("is idempotent — running twice gives the same result", () => {
    const scene = "Front-cam selfie in a cafe. Caption reads '休息'. Warm amber lighting.";
    const once = stripTextOverlay(scene);
    const twice = stripTextOverlay(once);
    expect(twice).toBe(once);
  });

  it("collapses excess whitespace after a strip", () => {
    const scene = "A.  Title text reads 'x'.  B.";
    const cleaned = stripTextOverlay(scene);
    expect(cleaned).not.toMatch(/ {2,}/);
    expect(cleaned).toContain("A.");
    expect(cleaned).toContain("B.");
  });

  it("handles empty input", () => {
    expect(stripTextOverlay("")).toBe("");
  });
});

describe("agreement between strip and detect", () => {
  it("detect=true implies strip removes something", () => {
    const cases = [
      "Title text reads 'x' at top.",
      "Caption reads 'y'.",
      "Text overlay reads 'z' in corner.",
      "Add a title '御姐'.",
      "今日穿搭 header on top.",
    ];
    for (const c of cases) {
      expect(hasTextOverlayRequest(c)).toBe(true);
      expect(stripTextOverlay(c).length).toBeLessThan(c.length);
    }
  });

  it("detect=false implies strip returns input unchanged (up to whitespace trim)", () => {
    const cases = [
      "Front-cam selfie from above, face fully visible, black halter top. 港风都市风",
      "Mirror selfie, matte-black leggings.",
      "Poolside kneel pose, nude bikini, 港风纯欲",
    ];
    for (const c of cases) {
      expect(hasTextOverlayRequest(c)).toBe(false);
      expect(stripTextOverlay(c)).toBe(c);
    }
  });
});
