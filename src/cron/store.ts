import JSON5 from "json5";
import fs from "node:fs";
import path from "node:path";
import type { CronStoreFile } from "./types.js";
import { expandHomePrefix } from "../infra/home-dir.js";
import { CONFIG_DIR } from "../utils.js";

export const DEFAULT_CRON_DIR = path.join(CONFIG_DIR, "cron");
export const DEFAULT_CRON_STORE_PATH = path.join(DEFAULT_CRON_DIR, "jobs.json");
export const CRON_RUNTIME_STATE_FILENAME = ".jobs-state.json";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function resolveCronStorePath(storePath?: string) {
  if (storePath?.trim()) {
    const raw = storePath.trim();
    if (raw.startsWith("~")) {
      return path.resolve(expandHomePrefix(raw));
    }
    return path.resolve(raw);
  }
  return DEFAULT_CRON_STORE_PATH;
}

export function resolveCronRuntimeStatePath(storePath: string) {
  const resolvedStorePath = path.resolve(storePath);
  return path.join(path.dirname(resolvedStorePath), "runs", CRON_RUNTIME_STATE_FILENAME);
}

async function readJsonFile(params: { filePath: string; label: string }) {
  try {
    const raw = await fs.promises.readFile(params.filePath, "utf-8");
    const parsed = JSON5.parse(raw);
    return isJsonRecord(parsed) ? parsed : {};
  } catch (err) {
    if ((err as { code?: unknown })?.code === "ENOENT") {
      return null;
    }
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse ${params.label}: ${String(err)}`, { cause: err });
    }
    const message = String(err);
    if (/parse/i.test(message)) {
      throw new Error(`Failed to parse ${params.label}: ${message}`, { cause: err });
    }
    throw err;
  }
}

function normalizeRawJobs(raw: JsonRecord): JsonRecord[] {
  const rawJobs = Array.isArray(raw.jobs) ? raw.jobs : [];
  return rawJobs.filter(isJsonRecord).map((job) => ({ ...job }));
}

export async function loadCronStore(storePath: string): Promise<CronStoreFile> {
  const resolvedStorePath = path.resolve(storePath);
  const defs = await readJsonFile({
    filePath: resolvedStorePath,
    label: `cron store at ${resolvedStorePath}`,
  });
  if (!defs) {
    return { version: 1, jobs: [] };
  }

  const jobs = normalizeRawJobs(defs);
  const runtimePath = resolveCronRuntimeStatePath(resolvedStorePath);
  const runtimeRaw = await readJsonFile({
    filePath: runtimePath,
    label: `cron runtime state store at ${runtimePath}`,
  });

  if (runtimeRaw) {
    const runtimeEntries = normalizeRawJobs(runtimeRaw);
    const runtimeById = new Map<string, JsonRecord>();
    for (const entry of runtimeEntries) {
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      if (id) {
        runtimeById.set(id, entry);
      }
    }

    for (const job of jobs) {
      const id = typeof job.id === "string" ? job.id.trim() : "";
      if (!id) {
        continue;
      }
      const runtimeEntry = runtimeById.get(id);
      if (!runtimeEntry) {
        continue;
      }
      if (
        typeof runtimeEntry.updatedAtMs === "number" &&
        Number.isFinite(runtimeEntry.updatedAtMs)
      ) {
        job.updatedAtMs = runtimeEntry.updatedAtMs;
      }
      if (isJsonRecord(runtimeEntry.state)) {
        job.state = runtimeEntry.state;
      }
    }
  }

  return {
    version: 1,
    jobs: jobs as never as CronStoreFile["jobs"],
  };
}

async function writeJsonFileAtomic(
  filePath: string,
  payload: Record<string, unknown>,
  opts?: { backup?: boolean },
) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const json = JSON.stringify(payload, null, 2);
  await fs.promises.writeFile(tmp, json, "utf-8");
  await fs.promises.rename(tmp, filePath);
  if (opts?.backup === false) {
    return;
  }
  try {
    await fs.promises.copyFile(filePath, `${filePath}.bak`);
  } catch {
    // best-effort
  }
}

export async function saveCronStore(storePath: string, store: CronStoreFile) {
  const resolvedStorePath = path.resolve(storePath);
  const runtimePath = resolveCronRuntimeStatePath(resolvedStorePath);

  const definitionJobs: JsonRecord[] = [];
  const runtimeJobs: JsonRecord[] = [];
  for (const raw of store.jobs as unknown as unknown[]) {
    if (!isJsonRecord(raw)) {
      continue;
    }
    const { state, ...definition } = raw;
    definitionJobs.push(definition);
    const runtime: JsonRecord = {
      id: raw.id,
      updatedAtMs: raw.updatedAtMs,
      state: isJsonRecord(state) ? state : {},
    };
    runtimeJobs.push(runtime);
  }

  await writeJsonFileAtomic(
    resolvedStorePath,
    {
      version: 1,
      jobs: definitionJobs,
    },
    { backup: true },
  );
  await writeJsonFileAtomic(
    runtimePath,
    {
      version: 1,
      jobs: runtimeJobs,
    },
    { backup: false },
  );
}
