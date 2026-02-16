import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadCronStore,
  resolveCronRuntimeStatePath,
  resolveCronStorePath,
  saveCronStore,
} from "./store.js";

async function makeStorePath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cron-store-"));
  return {
    dir,
    storePath: path.join(dir, "jobs.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

describe("resolveCronStorePath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses OPENCLAW_HOME for tilde expansion", () => {
    vi.stubEnv("OPENCLAW_HOME", "/srv/openclaw-home");
    vi.stubEnv("HOME", "/home/other");

    const result = resolveCronStorePath("~/cron/jobs.json");
    expect(result).toBe(path.resolve("/srv/openclaw-home", "cron", "jobs.json"));
  });
});

describe("resolveCronRuntimeStatePath", () => {
  it("stores runtime state under runs/.jobs-state.json beside the store", () => {
    const result = resolveCronRuntimeStatePath("/tmp/openclaw/cron/jobs.json");
    expect(result).toBe(path.resolve("/tmp/openclaw/cron/runs/.jobs-state.json"));
  });
});

describe("cron store", () => {
  it("returns empty store when file does not exist", async () => {
    const store = await makeStorePath();
    const loaded = await loadCronStore(store.storePath);
    expect(loaded).toEqual({ version: 1, jobs: [] });
    await store.cleanup();
  });

  it("throws when store contains invalid JSON", async () => {
    const store = await makeStorePath();
    await fs.writeFile(store.storePath, "{ not json", "utf-8");
    await expect(loadCronStore(store.storePath)).rejects.toThrow(/Failed to parse cron store/i);
    await store.cleanup();
  });

  it("persists runtime fields to sidecar file and keeps definitions clean", async () => {
    const store = await makeStorePath();
    await saveCronStore(store.storePath, {
      version: 1,
      jobs: [
        {
          id: "job-1",
          name: "Daily digest",
          enabled: true,
          createdAtMs: 1_700_000_000_000,
          updatedAtMs: 1_700_000_123_000,
          schedule: { kind: "every", everyMs: 3_600_000, anchorMs: 1_700_000_000_000 },
          sessionTarget: "main",
          wakeMode: "next-heartbeat",
          payload: { kind: "systemEvent", text: "Digest now" },
          state: {
            nextRunAtMs: 1_700_000_200_000,
            lastRunAtMs: 1_700_000_100_000,
            lastStatus: "ok",
          },
        },
      ],
    });

    const rawDefinitions = JSON.parse(await fs.readFile(store.storePath, "utf-8")) as {
      jobs: Array<Record<string, unknown>>;
    };
    expect(rawDefinitions.jobs[0]?.state).toBeUndefined();

    const runtimePath = resolveCronRuntimeStatePath(store.storePath);
    const rawRuntime = JSON.parse(await fs.readFile(runtimePath, "utf-8")) as {
      jobs: Array<Record<string, unknown>>;
    };
    expect(rawRuntime.jobs[0]?.state).toEqual(
      expect.objectContaining({
        nextRunAtMs: 1_700_000_200_000,
        lastRunAtMs: 1_700_000_100_000,
        lastStatus: "ok",
      }),
    );

    const loaded = await loadCronStore(store.storePath);
    expect(loaded.jobs[0]?.state).toEqual(
      expect.objectContaining({
        nextRunAtMs: 1_700_000_200_000,
        lastRunAtMs: 1_700_000_100_000,
        lastStatus: "ok",
      }),
    );
    expect(loaded.jobs[0]?.updatedAtMs).toBe(1_700_000_123_000);

    await store.cleanup();
  });
});
