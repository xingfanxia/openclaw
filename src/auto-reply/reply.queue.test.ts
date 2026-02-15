import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pollUntil } from "../../test/helpers/poll.js";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
import {
  isEmbeddedPiRunActive,
  isEmbeddedPiRunStreaming,
  runEmbeddedPiAgent,
} from "../agents/pi-embedded.js";
import { getReplyFromConfig } from "./reply.js";

vi.mock("../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: vi.fn().mockReturnValue(false),
  runEmbeddedPiAgent: vi.fn(),
  queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
  resolveEmbeddedSessionLane: (key: string) => `session:${key.trim() || "main"}`,
  isEmbeddedPiRunActive: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunStreaming: vi.fn().mockReturnValue(false),
}));

function makeResult(text: string) {
  return {
    payloads: [{ text }],
    meta: {
      durationMs: 5,
      agentMeta: { sessionId: "s", provider: "p", model: "m" },
    },
  };
}

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  return withTempHomeBase(
    async (home) => {
      vi.mocked(runEmbeddedPiAgent).mockReset();
      return await fn(home);
    },
    { prefix: "openclaw-queue-" },
  );
}

function makeCfg(home: string, queue?: Record<string, unknown>) {
  return {
    agents: {
      defaults: {
        model: "anthropic/claude-opus-4-5",
        workspace: path.join(home, "openclaw"),
      },
    },
    channels: { whatsapp: { allowFrom: ["*"] } },
    session: { store: path.join(home, "sessions.json") },
    messages: queue ? { queue } : undefined,
  };
}

describe("queue followups", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collects queued messages and drains after run completes", async () => {
    vi.useFakeTimers();
    await withTempHome(async (home) => {
      const prompts: string[] = [];
      vi.mocked(runEmbeddedPiAgent).mockImplementation(async (params) => {
        prompts.push(params.prompt);
        if (params.prompt.includes("[Queued messages while agent was busy]")) {
          return makeResult("followup");
        }
        return makeResult("main");
      });

      vi.mocked(isEmbeddedPiRunActive).mockReturnValue(true);
      vi.mocked(isEmbeddedPiRunStreaming).mockReturnValue(true);

      const cfg = makeCfg(home, {
        mode: "collect",
        debounceMs: 200,
        cap: 10,
        drop: "summarize",
      });

      const first = await getReplyFromConfig(
        { Body: "first", From: "+1001", To: "+2000", MessageSid: "m-1" },
        {},
        cfg,
      );
      expect(first).toBeUndefined();
      expect(runEmbeddedPiAgent).not.toHaveBeenCalled();

      vi.mocked(isEmbeddedPiRunActive).mockReturnValue(false);
      vi.mocked(isEmbeddedPiRunStreaming).mockReturnValue(false);

      const second = await getReplyFromConfig(
        { Body: "second", From: "+1001", To: "+2000" },
        {},
        cfg,
      );

      const secondText = Array.isArray(second) ? second[0]?.text : second?.text;
      expect(secondText).toBe("main");

      await vi.advanceTimersByTimeAsync(500);
      await Promise.resolve();

      expect(runEmbeddedPiAgent).toHaveBeenCalledTimes(2);
      const queuedPrompt = prompts.find((p) =>
        p.includes("[Queued messages while agent was busy]"),
      );
      expect(queuedPrompt).toBeTruthy();
      // Message id hints are no longer exposed to the model prompt.
      expect(queuedPrompt).toContain("Queued #1");
      expect(queuedPrompt).toContain("first");
      expect(queuedPrompt).not.toContain("[message_id:");
    });
  });

  it("summarizes dropped followups when cap is exceeded", async () => {
    await withTempHome(async (home) => {
      const prompts: string[] = [];
      vi.mocked(runEmbeddedPiAgent).mockImplementation(async (params) => {
        prompts.push(params.prompt);
        return makeResult("ok");
      });

      vi.mocked(isEmbeddedPiRunActive).mockReturnValue(true);
      vi.mocked(isEmbeddedPiRunStreaming).mockReturnValue(false);

      const cfg = makeCfg(home, {
        mode: "followup",
        debounceMs: 0,
        cap: 1,
        drop: "summarize",
      });

      await getReplyFromConfig({ Body: "one", From: "+1002", To: "+2000" }, {}, cfg);
      await getReplyFromConfig({ Body: "two", From: "+1002", To: "+2000" }, {}, cfg);

      vi.mocked(isEmbeddedPiRunActive).mockReturnValue(false);
      await getReplyFromConfig({ Body: "three", From: "+1002", To: "+2000" }, {}, cfg);

      await pollUntil(
        async () => (prompts.some((p) => p.includes("[Queue overflow]")) ? true : null),
        { timeoutMs: 2000 },
      );

      expect(prompts.some((p) => p.includes("[Queue overflow]"))).toBe(true);
    });
  });

  it("forks a parallel run instead of queueing when session is active", async () => {
    await withTempHome(async (home) => {
      vi.mocked(runEmbeddedPiAgent).mockImplementation(async () => makeResult("parallel"));
      vi.mocked(isEmbeddedPiRunActive).mockReturnValue(true);
      vi.mocked(isEmbeddedPiRunStreaming).mockReturnValue(false);

      const cfg = makeCfg(home, {
        mode: "parallel",
      });

      const res = await getReplyFromConfig(
        { Body: "run in parallel", From: "+1003", To: "+2000" },
        {},
        cfg,
      );

      const text = Array.isArray(res) ? res[0]?.text : res?.text;
      expect(text).toBe("parallel");
      expect(runEmbeddedPiAgent).toHaveBeenCalledTimes(1);

      const firstCall = vi.mocked(runEmbeddedPiAgent).mock.calls[0]?.[0];
      expect(firstCall?.sessionKey).toBeUndefined();
      expect(firstCall?.sessionId).toBeTruthy();
    });
  });

  it("keeps first run active while serving a second message immediately in parallel mode", async () => {
    await withTempHome(async (home) => {
      let firstRunActive = false;
      let releaseFirstRun: (() => void) | undefined;
      const firstRunWait = new Promise<void>((resolve) => {
        releaseFirstRun = resolve;
      });

      vi.mocked(isEmbeddedPiRunActive).mockImplementation(() => firstRunActive);
      vi.mocked(isEmbeddedPiRunStreaming).mockReturnValue(false);
      vi.mocked(runEmbeddedPiAgent).mockImplementation(async (params) => {
        // Parent run keeps the lane busy; forked run should still complete immediately.
        if (params.sessionKey) {
          firstRunActive = true;
          await firstRunWait;
          firstRunActive = false;
          return makeResult("first done");
        }
        return makeResult("second immediate");
      });

      const cfg = makeCfg(home, { mode: "parallel" });

      const firstPromise = getReplyFromConfig(
        { Body: "first", From: "+1004", To: "+2000", MessageSid: "m-first" },
        {},
        cfg,
      );

      await pollUntil(async () => (firstRunActive ? true : null), { timeoutMs: 2000 });

      const second = await getReplyFromConfig(
        { Body: "second", From: "+1004", To: "+2000", MessageSid: "m-second" },
        {},
        cfg,
      );
      const secondText = Array.isArray(second) ? second[0]?.text : second?.text;
      expect(secondText).toBe("second immediate");

      const firstSettledEarly = await Promise.race([
        firstPromise.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
      ]);
      expect(firstSettledEarly).toBe(false);

      releaseFirstRun?.();
      const first = await firstPromise;
      const firstText = Array.isArray(first) ? first[0]?.text : first?.text;
      expect(firstText).toBe("first done");

      expect(runEmbeddedPiAgent).toHaveBeenCalledTimes(2);
      const secondCall = vi.mocked(runEmbeddedPiAgent).mock.calls[1]?.[0];
      expect(secondCall?.sessionKey).toBeUndefined();
      expect(secondCall?.sessionId).toBeTruthy();
    });
  });
});
