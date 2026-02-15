import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "../../../src/plugins/types.js";

vi.mock("@openai/codex-sdk", () => {
  class MockCodex {
    startThread() {
      return {
        run: (_task: string, opts: { signal: AbortSignal }) =>
          new Promise((resolve, reject) => {
            const onAbort = () => reject(new Error("aborted"));
            if (opts.signal.aborted) {
              onAbort();
              return;
            }
            opts.signal.addEventListener("abort", onAbort, { once: true });
          }),
      };
    }
  }
  return { Codex: MockCodex };
});

type ToolResult = {
  details: Record<string, unknown>;
};

async function createTool(pluginConfig?: Record<string, unknown>) {
  const { createCodexTool } = await import("./codex-tool.js");
  const api = {
    pluginConfig,
  } as unknown as OpenClawPluginApi;
  return createCodexTool(api);
}

describe("codex tool background jobs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.useRealTimers();
  });

  it("cancels a running background job", async () => {
    const tool = await createTool();
    const accepted = (await tool.execute("t-1", {
      action: "run",
      background: true,
      task: "long running task",
      timeoutMs: 30_000,
    })) as ToolResult;
    const jobId = String(accepted.details.jobId ?? "");
    expect(jobId).not.toBe("");

    const cancelled = (await tool.execute("t-2", {
      action: "cancel",
      jobId,
    })) as ToolResult;
    expect(cancelled.details.status).toBe("cancelled");

    await Promise.resolve();
    await Promise.resolve();

    const status = (await tool.execute("t-3", {
      action: "status",
      jobId,
    })) as ToolResult;
    expect(status.details.status).toBe("cancelled");
  });

  it("clamps timeoutMs to codex.maxTimeoutMs", async () => {
    const tool = await createTool({
      codex: {
        maxTimeoutMs: 5_000,
      },
    });

    const accepted = (await tool.execute("t-4", {
      action: "run",
      background: true,
      task: "clamp timeout",
      timeoutMs: 60_000,
    })) as ToolResult;
    const jobId = String(accepted.details.jobId ?? "");
    expect(jobId).not.toBe("");
    expect(accepted.details.timeoutMs).toBe(5_000);

    await tool.execute("t-5", {
      action: "cancel",
      jobId,
    });
  });

  it("marks jobs as likely stalled when updatedAt stops advancing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T12:00:00.000Z"));

    const tool = await createTool();
    const accepted = (await tool.execute("t-6", {
      action: "run",
      background: true,
      task: "simulate stall",
      timeoutMs: 60_000,
    })) as ToolResult;
    const jobId = String(accepted.details.jobId ?? "");
    expect(jobId).not.toBe("");

    // Do not advance timers (no heartbeat ticks). Jump wall clock forward.
    vi.setSystemTime(new Date("2026-02-15T12:10:00.000Z"));

    const status = (await tool.execute("t-7", {
      action: "status",
      jobId,
    })) as ToolResult;
    expect(status.details.isLikelyStalled).toBe(true);
    expect(Number(status.details.stalledForMs)).toBeGreaterThan(0);

    await tool.execute("t-8", { action: "cancel", jobId });
  });
});
