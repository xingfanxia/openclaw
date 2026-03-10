import { describe, expect, it } from "vitest";
import { deriveSessionTotalTokens, hasNonzeroUsage, normalizeUsage } from "./usage.js";

describe("normalizeUsage", () => {
  it("normalizes Anthropic-style snake_case usage", () => {
    const usage = normalizeUsage({
      input_tokens: 1200,
      output_tokens: 340,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 50,
      total_tokens: 1790,
    });
    expect(usage).toEqual({
      input: 1200,
      output: 340,
      cacheRead: 50,
      cacheWrite: 200,
      total: 1790,
    });
  });

  it("normalizes OpenAI-style prompt/completion usage", () => {
    const usage = normalizeUsage({
      prompt_tokens: 987,
      completion_tokens: 123,
      total_tokens: 1110,
    });
    expect(usage).toEqual({
      input: 987,
      output: 123,
      cacheRead: undefined,
      cacheWrite: undefined,
      total: 1110,
    });
  });

  it("normalizes Gemini-style usage where input=total prompt (cached included)", () => {
    // Gemini: promptTokenCount=329k (total), cachedContentTokenCount=318k (subset),
    // totalTokenCount=331k (prompt + output). input should be normalized to non-cached only.
    const usage = normalizeUsage({
      input: 329_000,
      output: 1_900,
      cacheRead: 318_000,
      cacheWrite: 0,
      total: 330_900, // ≈ input + output (Gemini totalTokenCount)
    });
    expect(usage).toEqual({
      input: 11_000, // 329k - 318k = non-cached only
      output: 1_900,
      cacheRead: 318_000,
      cacheWrite: 0,
      total: 330_900,
    });
  });

  it("does not normalize Anthropic-style usage (total includes cacheRead)", () => {
    // Anthropic: input=non-cached, total=input+cacheRead+cacheWrite+output
    const usage = normalizeUsage({
      input_tokens: 1200,
      output_tokens: 340,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 200,
      total_tokens: 1790, // 1200+340+50+200 — NOT just input+output
    });
    expect(usage).toEqual({
      input: 1200, // unchanged — total ≠ input+output so no normalization
      output: 340,
      cacheRead: 50,
      cacheWrite: 200,
      total: 1790,
    });
  });

  it("returns undefined for empty usage objects", () => {
    expect(normalizeUsage({})).toBeUndefined();
  });

  it("guards against empty/zero usage overwrites", () => {
    expect(hasNonzeroUsage(undefined)).toBe(false);
    expect(hasNonzeroUsage(null)).toBe(false);
    expect(hasNonzeroUsage({})).toBe(false);
    expect(hasNonzeroUsage({ input: 0, output: 0 })).toBe(false);
    expect(hasNonzeroUsage({ input: 1 })).toBe(true);
    expect(hasNonzeroUsage({ total: 1 })).toBe(true);
  });

  it("does not clamp derived session total tokens to the context window", () => {
    expect(
      deriveSessionTotalTokens({
        usage: {
          input: 27,
          cacheRead: 2_400_000,
          cacheWrite: 0,
          total: 2_402_300,
        },
        contextTokens: 200_000,
      }),
    ).toBe(2_400_027);
  });

  it("uses prompt tokens when within context window", () => {
    expect(
      deriveSessionTotalTokens({
        usage: {
          input: 1_200,
          cacheRead: 300,
          cacheWrite: 50,
          total: 2_000,
        },
        contextTokens: 200_000,
      }),
    ).toBe(1_550);
  });

  it("prefers explicit prompt token overrides", () => {
    expect(
      deriveSessionTotalTokens({
        usage: {
          input: 1_200,
          cacheRead: 300,
          cacheWrite: 50,
          total: 9_999,
        },
        promptTokens: 65_000,
        contextTokens: 200_000,
      }),
    ).toBe(65_000);
  });
});
