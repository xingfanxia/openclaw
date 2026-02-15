import { describe, expect, it } from "vitest";
import { validateConfigObject } from "./config.js";

describe("queue byChannel config", () => {
  it("accepts feishu queue mode override", () => {
    const res = validateConfigObject({
      messages: {
        queue: {
          mode: "collect",
          byChannel: {
            feishu: "interrupt",
          },
        },
      },
    });

    expect(res.ok).toBe(true);
  });
});
