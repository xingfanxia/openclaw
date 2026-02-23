import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn(),
  randomIdempotencyKey: () => "idem-1",
}));
vi.mock("./agent.js", () => ({
  agentCommand: vi.fn(),
}));

import type { OpenClawConfig } from "../config/config.js";
import * as configModule from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import type { RuntimeEnv } from "../runtime.js";
import { agentCliCommand } from "./agent-via-gateway.js";
import { agentCommand } from "./agent.js";

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

const configSpy = vi.spyOn(configModule, "loadConfig");

function mockConfig(storePath: string, overrides?: Partial<OpenClawConfig>) {
  configSpy.mockReturnValue({
    agents: {
      defaults: {
        timeoutSeconds: 600,
        ...overrides?.agents?.defaults,
      },
    },
    session: {
      store: storePath,
      mainKey: "main",
      ...overrides?.session,
    },
    gateway: overrides?.gateway,
  });
}

async function withTempStore(
  fn: (ctx: { dir: string; store: string }) => Promise<void>,
  overrides?: Partial<OpenClawConfig>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-cli-"));
  const store = path.join(dir, "sessions.json");
  mockConfig(store, overrides);
  try {
    await fn({ dir, store });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function mockGatewaySuccessReply(text = "hello") {
  vi.mocked(callGateway).mockResolvedValue({
    runId: "idem-1",
    status: "ok",
    result: {
      payloads: [{ text }],
      meta: { stub: true },
    },
  });
}

function mockLocalAgentReply(text = "local") {
  vi.mocked(agentCommand).mockImplementationOnce(async (_opts, rt) => {
    rt?.log?.(text);
    return {
      payloads: [{ text }],
      meta: { durationMs: 1, agentMeta: { sessionId: "s", provider: "p", model: "m" } },
    } as unknown as Awaited<ReturnType<typeof agentCommand>>;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agentCliCommand", () => {
  it("uses a timer-safe max gateway timeout when --timeout is 0", async () => {
    await withTempStore(async () => {
      mockGatewaySuccessReply();

      await agentCliCommand({ message: "hi", to: "+1555", timeout: "0" }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      const request = vi.mocked(callGateway).mock.calls[0]?.[0] as { timeoutMs?: number };
      expect(request.timeoutMs).toBe(2_147_000_000);
    });
  });

  it("uses gateway by default", async () => {
    await withTempStore(async () => {
      mockGatewaySuccessReply();

      await agentCliCommand({ message: "hi", to: "+1555" }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      expect(agentCommand).not.toHaveBeenCalled();
      expect(runtime.log).toHaveBeenCalledWith("hello");
    });
  });

  it("falls back to embedded agent when gateway fails", async () => {
    await withTempStore(async () => {
      vi.mocked(callGateway).mockRejectedValue(new Error("gateway not connected"));
      mockLocalAgentReply();

      await agentCliCommand({ message: "hi", to: "+1555" }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      expect(agentCommand).toHaveBeenCalledTimes(1);
      expect(runtime.log).toHaveBeenCalledWith("local");
    });
  });

  it("retries once on transient gateway close (1006) and succeeds", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-cli-"));
    const store = path.join(dir, "sessions.json");
    mockConfig(store);

    vi.mocked(callGateway)
      .mockRejectedValueOnce(
        new Error("gateway closed (1006 abnormal closure (no close frame)): no close reason"),
      )
      .mockResolvedValueOnce({
        runId: "idem-1",
        status: "ok",
        result: {
          payloads: [{ text: "hello-after-retry" }],
          meta: { stub: true },
        },
      });

    try {
      vi.useFakeTimers();
      const run = agentCliCommand({ message: "hi", to: "+1555" }, runtime);
      await vi.runAllTimersAsync();
      await run;

      expect(callGateway).toHaveBeenCalledTimes(2);
      expect(agentCommand).not.toHaveBeenCalled();
      expect(runtime.log).toHaveBeenCalledWith("hello-after-retry");
      expect(runtime.error).toHaveBeenCalledWith(expect.stringContaining("attempt 1"));
      vi.useRealTimers();
    } finally {
      vi.useRealTimers();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back after transient gateway retry budget is exhausted", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-cli-"));
    const store = path.join(dir, "sessions.json");
    mockConfig(store);

    vi.mocked(callGateway).mockRejectedValue(
      new Error("gateway closed (1006 abnormal closure (no close frame)): no close reason"),
    );

    vi.mocked(agentCommand).mockImplementationOnce(async (_opts, rt) => {
      rt.log?.("local-after-retries");
      return { payloads: [{ text: "local-after-retries" }], meta: { stub: true } };
    });

    try {
      vi.useFakeTimers();
      const run = agentCliCommand({ message: "hi", to: "+1555" }, runtime);
      await vi.runAllTimersAsync();
      await run;

      expect(callGateway).toHaveBeenCalledTimes(11);
      expect(agentCommand).toHaveBeenCalledTimes(1);
      expect(runtime.log).toHaveBeenCalledWith("local-after-retries");
      expect(runtime.error).toHaveBeenCalledWith(expect.stringContaining("falling back"));
      vi.useRealTimers();
    } finally {
      vi.useRealTimers();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips gateway when --local is set", async () => {
    await withTempStore(async () => {
      mockLocalAgentReply();

      await agentCliCommand(
        {
          message: "hi",
          to: "+1555",
          local: true,
        },
        runtime,
      );

      expect(callGateway).not.toHaveBeenCalled();
      expect(agentCommand).toHaveBeenCalledTimes(1);
      expect(runtime.log).toHaveBeenCalledWith("local");
    });
  });
});
