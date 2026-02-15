import type * as Lark from "@larksuiteoapi/node-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleFeishuMessage } from "./bot.js";
import { registerEventHandlers } from "./monitor.js";

vi.mock("./bot.js", () => ({
  handleFeishuMessage: vi.fn(),
}));

function createDispatcherHarness() {
  const handlers: Record<string, (data: unknown) => Promise<void>> = {};
  const dispatcher = {
    register(next: Record<string, (data: unknown) => Promise<void>>) {
      Object.assign(handlers, next);
    },
  } as unknown as Lark.EventDispatcher;
  return { dispatcher, handlers };
}

describe("registerEventHandlers", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not await message processing when fireAndForget is enabled", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(handleFeishuMessage).mockReturnValue(pending);

    const { dispatcher, handlers } = createDispatcherHarness();
    registerEventHandlers(dispatcher, {
      cfg: {} as never,
      accountId: "default",
      chatHistories: new Map(),
      fireAndForget: true,
    });

    const onMessage = handlers["im.message.receive_v1"];
    expect(onMessage).toBeTypeOf("function");

    const callbackPromise = onMessage({ event: { message: { message_id: "m-1" } } });
    const settledEarly = await Promise.race([
      callbackPromise.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20)),
    ]);

    expect(settledEarly).toBe(true);
    expect(handleFeishuMessage).toHaveBeenCalledTimes(1);

    release?.();
    await pending;
  });

  it("awaits message processing when fireAndForget is disabled", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(handleFeishuMessage).mockReturnValue(pending);

    const { dispatcher, handlers } = createDispatcherHarness();
    registerEventHandlers(dispatcher, {
      cfg: {} as never,
      accountId: "default",
      chatHistories: new Map(),
      fireAndForget: false,
    });

    const onMessage = handlers["im.message.receive_v1"];
    expect(onMessage).toBeTypeOf("function");

    const callbackPromise = onMessage({ event: { message: { message_id: "m-2" } } });
    const settledEarly = await Promise.race([
      callbackPromise.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20)),
    ]);

    expect(settledEarly).toBe(false);
    expect(handleFeishuMessage).toHaveBeenCalledTimes(1);

    release?.();
    await callbackPromise;
  });
});
