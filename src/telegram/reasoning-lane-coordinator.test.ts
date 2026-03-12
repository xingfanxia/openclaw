import { describe, expect, it } from "vitest";
import { splitTelegramReasoningText } from "./reasoning-lane-coordinator.js";

describe("splitTelegramReasoningText", () => {
  it("splits real tagged reasoning and answer", () => {
    expect(splitTelegramReasoningText("<think>example</think>Done")).toEqual({
      reasoningText: "Reasoning:\n_example_",
      answerText: "Done",
    });
  });

  it("ignores literal think tags inside inline code", () => {
    const text = "Use `<think>example</think>` literally.";
    expect(splitTelegramReasoningText(text)).toEqual({
      answerText: text,
    });
  });

  it("ignores literal think tags inside fenced code", () => {
    const text = "```xml\n<think>example</think>\n```";
    expect(splitTelegramReasoningText(text)).toEqual({
      answerText: text,
    });
  });

  it("does not emit partial reasoning tag prefixes", () => {
    expect(splitTelegramReasoningText("  <thi")).toEqual({});
  });

  it("recovers answer from unclosed think tag (Gemini leak)", () => {
    const text = "<think>\n<final>老大，这两篇读完了</final>";
    const result = splitTelegramReasoningText(text);
    expect(result.answerText).toBe("老大，这两篇读完了");
    expect(result.reasoningText).toBeUndefined();
  });

  it("recovers answer from unclosed think tag without final tags", () => {
    const text = "<think>\nHere is my response to your question.";
    const result = splitTelegramReasoningText(text);
    expect(result.answerText).toBe("Here is my response to your question.");
    expect(result.reasoningText).toBeUndefined();
  });
});
