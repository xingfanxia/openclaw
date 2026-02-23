import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildTelegramMessageContextForTest } from "./bot-message-context.test-harness.js";

// Mock recordInboundSession to capture updateLastRoute parameter
const recordInboundSessionMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../channels/session.js", () => ({
  recordInboundSession: (...args: unknown[]) => recordInboundSessionMock(...args),
}));

describe("buildTelegramMessageContext DM topic threadId in deliveryContext (#8891)", () => {
  async function buildCtx(params: {
    message: Record<string, unknown>;
    options?: Record<string, unknown>;
    resolveGroupActivation?: () => boolean | undefined;
  }) {
    return await buildTelegramMessageContextForTest({
      message: params.message,
      options: params.options,
      resolveGroupActivation: params.resolveGroupActivation,
    });
  }

  function getUpdateLastRoute(): unknown {
    const callArgs = recordInboundSessionMock.mock.calls[0]?.[0] as { updateLastRoute?: unknown };
    return callArgs?.updateLastRoute;
  }

  beforeEach(() => {
    recordInboundSessionMock.mockClear();
  });

  it("does NOT persist threadId to main session updateLastRoute for DM topics", async () => {
    const ctx = await buildCtx({
      message: {
        chat: { id: 1234, type: "private" },
        message_thread_id: 42, // DM Topic ID
      },
    });

    expect(ctx).not.toBeNull();
    expect(recordInboundSessionMock).toHaveBeenCalled();

    // DM threadId must NOT be persisted to the main session delivery route.
    // Persisting it causes heartbeat/proactive sends to include a stale
    // message_thread_id that fails with "thread not found".
    // Thread-specific sessions handle thread routing via resolveThreadSessionKeys.
    const updateLastRoute = getUpdateLastRoute() as { threadId?: string; to?: string } | undefined;
    expect(updateLastRoute).toBeDefined();
    expect(updateLastRoute?.to).toBe("telegram:1234");
    expect(updateLastRoute?.threadId).toBeUndefined();
  });

  it("does not pass threadId for regular DM without topic", async () => {
    const ctx = await buildCtx({
      message: {
        chat: { id: 1234, type: "private" },
      },
    });

    expect(ctx).not.toBeNull();
    expect(recordInboundSessionMock).toHaveBeenCalled();

    // Check that updateLastRoute does NOT include threadId
    const updateLastRoute = getUpdateLastRoute() as { threadId?: string; to?: string } | undefined;
    expect(updateLastRoute).toBeDefined();
    expect(updateLastRoute?.to).toBe("telegram:1234");
    expect(updateLastRoute?.threadId).toBeUndefined();
  });

  it("does not set updateLastRoute for group messages", async () => {
    const ctx = await buildCtx({
      message: {
        chat: { id: -1001234567890, type: "supergroup", title: "Test Group" },
        text: "@bot hello",
        message_thread_id: 99,
      },
      options: { forceWasMentioned: true },
      resolveGroupActivation: () => true,
    });

    expect(ctx).not.toBeNull();
    expect(recordInboundSessionMock).toHaveBeenCalled();

    // Check that updateLastRoute is undefined for groups
    expect(getUpdateLastRoute()).toBeUndefined();
  });
});
