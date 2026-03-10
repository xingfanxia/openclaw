import { describe, expect, it } from "vitest";
import { stripMarkdown } from "../line/markdown-to-line.js";
import { stripActionMarkers } from "./tts.js";

/**
 * Tests that stripMarkdown (used in the TTS pipeline via maybeApplyTtsToPayload)
 * produces clean text suitable for speech synthesis.
 *
 * The TTS pipeline calls stripMarkdown() before sending text to TTS engines
 * (OpenAI, ElevenLabs, Edge) so that formatting symbols are not read aloud
 * (e.g. "hashtag hashtag hashtag" for ### headers).
 */
describe("TTS text preparation – stripMarkdown", () => {
  it("strips markdown headers before TTS", () => {
    expect(stripMarkdown("### System Design Basics")).toBe("System Design Basics");
    expect(stripMarkdown("## Heading\nSome text")).toBe("Heading\nSome text");
  });

  it("strips bold and italic markers before TTS", () => {
    expect(stripMarkdown("This is **important** and *useful*")).toBe(
      "This is important and useful",
    );
  });

  it("strips inline code markers before TTS", () => {
    expect(stripMarkdown("Use `consistent hashing` for distribution")).toBe(
      "Use consistent hashing for distribution",
    );
  });

  it("handles a typical LLM reply with mixed markdown", () => {
    const input = `## Heading with **bold** and *italic*

> A blockquote with \`code\`

Some ~~deleted~~ content.`;

    const result = stripMarkdown(input);

    expect(result).toBe(`Heading with bold and italic

A blockquote with code

Some deleted content.`);
  });

  it("handles markdown-heavy system design explanation", () => {
    const input = `### B-tree vs LSM-tree

**B-tree** uses _in-place updates_ while **LSM-tree** uses _append-only writes_.

> Key insight: LSM-tree optimizes for write-heavy workloads.

---

Use \`B-tree\` for read-heavy, \`LSM-tree\` for write-heavy.`;

    const result = stripMarkdown(input);

    expect(result).not.toContain("#");
    expect(result).not.toContain("**");
    expect(result).not.toContain("`");
    expect(result).not.toContain(">");
    expect(result).not.toContain("---");
    expect(result).toContain("B-tree vs LSM-tree");
    expect(result).toContain("B-tree uses in-place updates");
  });
});

describe("TTS text preparation – stripActionMarkers", () => {
  it("strips Chinese parenthetical actions", () => {
    expect(stripActionMarkers("摸摸头 (笑) 你好")).toBe("摸摸头 你好");
    expect(stripActionMarkers("好的(想了想)我觉得可以")).toBe("好的我觉得可以");
    expect(stripActionMarkers("加油！（鼓掌）继续")).toBe("加油！继续");
  });

  it("strips English parenthetical actions", () => {
    expect(stripActionMarkers("Hello (sighs) world")).toBe("Hello world");
    expect(stripActionMarkers("Sure (laughs) okay")).toBe("Sure okay");
  });

  it("strips square-bracket stage directions", () => {
    expect(stripActionMarkers("I think [pauses] yes")).toBe("I think yes");
    expect(stripActionMarkers("[laughs] That's funny")).toBe("That's funny");
  });

  it("strips CJK bracket actions", () => {
    expect(stripActionMarkers("好的【鼓掌】真棒")).toBe("好的真棒");
    expect(stripActionMarkers("嗯〔点头〕同意")).toBe("嗯同意");
  });

  it("preserves parenthetical content with numbers", () => {
    expect(stripActionMarkers("用量 (200mg) 每天")).toBe("用量 (200mg) 每天");
    expect(stripActionMarkers("大约 (3次) 就好")).toBe("大约 (3次) 就好");
  });

  it("preserves parenthetical content with punctuation (real clauses)", () => {
    expect(stripActionMarkers("这个 (就是说, 很重要) 要注意")).toBe("这个 (就是说, 很重要) 要注意");
  });

  it("preserves long parenthetical content (>12 chars)", () => {
    expect(stripActionMarkers("注意 (这个很重要一定要记住这件事情) 好的")).toBe(
      "注意 (这个很重要一定要记住这件事情) 好的",
    );
  });

  it("handles multiple markers in one string", () => {
    const input = "摸摸头(笑) 你好啊！(鼓掌) 真棒【开心】";
    const result = stripActionMarkers(input);
    expect(result).toBe("摸摸头 你好啊！ 真棒");
  });

  it("handles emoji clusters in parentheses", () => {
    expect(stripActionMarkers("好棒(🎉🎉)继续加油")).toBe("好棒继续加油");
  });

  it("returns empty-ish text unchanged when all content is markers", () => {
    expect(stripActionMarkers("(笑)")).toBe("");
  });
});
