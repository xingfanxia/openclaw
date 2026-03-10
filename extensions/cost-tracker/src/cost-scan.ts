/**
 * Self-contained JSONL transcript scanner and cost aggregation.
 * Uses only node:fs, node:path, node:os, node:readline — no internal imports.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NormalizedUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
}

interface CostBreakdown {
  total: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ParsedEntry {
  role: "user" | "assistant";
  timestamp?: Date;
  durationMs?: number;
  usage?: NormalizedUsage;
  costTotal?: number;
  costBreakdown?: CostBreakdown;
  provider?: string;
  model?: string;
  toolNames: string[];
}

export interface CostUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  missingCostEntries: number;
}

export interface CostUsageDailyEntry extends CostUsageTotals {
  date: string;
}

export interface CostUsageSummary {
  updatedAt: number;
  days: number;
  daily: CostUsageDailyEntry[];
  totals: CostUsageTotals;
}

// ---------------------------------------------------------------------------
// Path resolution (replaces internal resolveStateDir / resolveSessionsDir)
// ---------------------------------------------------------------------------

export function resolveSessionsDir(agentId: string = "main"): string {
  const stateDir =
    process.env.OPENCLAW_STATE_DIR?.trim() ||
    process.env.CLAWDBOT_STATE_DIR?.trim() ||
    path.join(os.homedir(), ".openclaw");
  return path.join(stateDir, "agents", agentId, "sessions");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyTotals(): CostUsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    totalCost: 0,
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    missingCostEntries: 0,
  };
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Usage normalization (handles multiple provider formats)
// ---------------------------------------------------------------------------

function normalizeUsage(raw: Record<string, unknown>): NormalizedUsage | undefined {
  const rawInput = toFiniteNumber(
    raw.input ?? raw.inputTokens ?? raw.input_tokens ?? raw.promptTokens ?? raw.prompt_tokens,
  );
  const input = rawInput !== undefined && rawInput < 0 ? 0 : rawInput;
  const output = toFiniteNumber(
    raw.output ??
      raw.outputTokens ??
      raw.output_tokens ??
      raw.completionTokens ??
      raw.completion_tokens,
  );
  const cacheRead = toFiniteNumber(
    raw.cacheRead ?? raw.cache_read ?? raw.cacheReadTokens ?? raw.cache_read_input_tokens,
  );
  const cacheWrite = toFiniteNumber(
    raw.cacheWrite ?? raw.cache_write ?? raw.cacheWriteTokens ?? raw.cache_creation_input_tokens,
  );
  const total = toFiniteNumber(raw.total ?? raw.totalTokens ?? raw.total_tokens);

  if (
    input === undefined &&
    output === undefined &&
    cacheRead === undefined &&
    total === undefined
  ) {
    return undefined;
  }

  return { input, output, cacheRead, cacheWrite, total };
}

// ---------------------------------------------------------------------------
// Cost extraction from usage.cost sub-object
// ---------------------------------------------------------------------------

function extractCostBreakdown(usageRaw: Record<string, unknown>): CostBreakdown | undefined {
  const cost = usageRaw.cost as Record<string, unknown> | undefined;
  if (!cost || typeof cost !== "object") {
    return undefined;
  }
  const total = toFiniteNumber(cost.total);
  if (total === undefined || total < 0) {
    return undefined;
  }
  return {
    total,
    input: toFiniteNumber(cost.input),
    output: toFiniteNumber(cost.output),
    cacheRead: toFiniteNumber(cost.cacheRead),
    cacheWrite: toFiniteNumber(cost.cacheWrite),
  };
}

// ---------------------------------------------------------------------------
// Timestamp parsing
// ---------------------------------------------------------------------------

function parseTimestamp(entry: Record<string, unknown>): Date | undefined {
  const raw = entry.timestamp;
  if (typeof raw === "string") {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed;
    }
  }
  const message = entry.message as Record<string, unknown> | undefined;
  const messageTimestamp = toFiniteNumber(message?.timestamp);
  if (messageTimestamp !== undefined) {
    const parsed = new Date(messageTimestamp);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Tool call name extraction
// ---------------------------------------------------------------------------

function extractToolCallNames(message: Record<string, unknown>): string[] {
  const toolCalls = message.toolCalls as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(toolCalls)) {
    return [];
  }
  const names: string[] = [];
  for (const call of toolCalls) {
    if (call && typeof call === "object" && typeof call.name === "string") {
      names.push(call.name);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// JSONL line-by-line reader
// ---------------------------------------------------------------------------

async function* readJsonlRecords(filePath: string): AsyncGenerator<Record<string, unknown>> {
  const fileStream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object") {
          yield parsed as Record<string, unknown>;
        }
      } catch {
        // Ignore malformed lines
      }
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }
}

// ---------------------------------------------------------------------------
// Parse a single JSONL record into a ParsedEntry
// ---------------------------------------------------------------------------

function parseTranscriptEntry(entry: Record<string, unknown>): ParsedEntry | null {
  const message = entry.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== "object") {
    return null;
  }

  const roleRaw = message.role;
  const role = roleRaw === "user" || roleRaw === "assistant" ? roleRaw : undefined;
  if (!role) {
    return null;
  }

  const usageRaw =
    (message.usage as Record<string, unknown> | undefined) ??
    (entry.usage as Record<string, unknown> | undefined);
  const usage = usageRaw ? normalizeUsage(usageRaw) : undefined;

  const provider =
    (typeof message.provider === "string" ? message.provider : undefined) ??
    (typeof entry.provider === "string" ? entry.provider : undefined);
  const model =
    (typeof message.model === "string" ? message.model : undefined) ??
    (typeof entry.model === "string" ? entry.model : undefined);

  const costBreakdown = usageRaw ? extractCostBreakdown(usageRaw) : undefined;
  const durationMs = toFiniteNumber(message.durationMs ?? entry.durationMs);

  return {
    role,
    timestamp: parseTimestamp(entry),
    durationMs,
    usage,
    costTotal: costBreakdown?.total,
    costBreakdown,
    provider,
    model,
    toolNames: extractToolCallNames(message),
  };
}

// ---------------------------------------------------------------------------
// Public: iterate parsed transcript entries from a single .jsonl file
// ---------------------------------------------------------------------------

export async function* scanTranscriptEntries(filePath: string): AsyncGenerator<ParsedEntry> {
  for await (const record of readJsonlRecords(filePath)) {
    const entry = parseTranscriptEntry(record);
    if (entry) {
      yield entry;
    }
  }
}

// ---------------------------------------------------------------------------
// Totals accumulation helpers
// ---------------------------------------------------------------------------

function applyUsageTotals(totals: CostUsageTotals, usage: NormalizedUsage): void {
  totals.input += usage.input ?? 0;
  totals.output += usage.output ?? 0;
  totals.cacheRead += usage.cacheRead ?? 0;
  totals.cacheWrite += usage.cacheWrite ?? 0;
  const totalTokens =
    usage.total ??
    (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  totals.totalTokens += totalTokens;
}

function applyCostBreakdown(totals: CostUsageTotals, cb: CostBreakdown): void {
  totals.totalCost += cb.total;
  totals.inputCost += cb.input ?? 0;
  totals.outputCost += cb.output ?? 0;
  totals.cacheReadCost += cb.cacheRead ?? 0;
  totals.cacheWriteCost += cb.cacheWrite ?? 0;
}

function applyCostTotal(totals: CostUsageTotals, costTotal: number | undefined): void {
  if (costTotal === undefined) {
    totals.missingCostEntries += 1;
    return;
  }
  totals.totalCost += costTotal;
}

// ---------------------------------------------------------------------------
// Day key formatting
// ---------------------------------------------------------------------------

function formatDayKey(date: Date): string {
  return date.toLocaleDateString("en-CA", {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

// ---------------------------------------------------------------------------
// Public: load aggregated cost/usage summary across all .jsonl files
// ---------------------------------------------------------------------------

export async function loadCostUsageSummary(params: {
  startMs: number;
  endMs: number;
  config?: OpenClawConfig;
  agentId?: string;
}): Promise<CostUsageSummary> {
  const { startMs, endMs } = params;
  const sessionsDir = resolveSessionsDir(params.agentId ?? "main");

  const dirEntries = await fs.promises
    .readdir(sessionsDir, { withFileTypes: true })
    .catch(() => []);

  // Filter to .jsonl files modified after startMs
  const files: string[] = [];
  for (const dirEntry of dirEntries) {
    if (!dirEntry.isFile() || !dirEntry.name.endsWith(".jsonl")) continue;
    const filePath = path.join(sessionsDir, dirEntry.name);
    const stats = await fs.promises.stat(filePath).catch(() => null);
    if (!stats || stats.mtimeMs < startMs) continue;
    files.push(filePath);
  }

  const dailyMap = new Map<string, CostUsageTotals>();
  const totals = emptyTotals();
  const now = new Date();

  for (const filePath of files) {
    for await (const entry of scanTranscriptEntries(filePath)) {
      if (!entry.usage) continue;

      const ts = entry.timestamp?.getTime();
      if (!ts || ts < startMs || ts > endMs) continue;

      const dayKey = formatDayKey(entry.timestamp ?? now);
      const bucket = dailyMap.get(dayKey) ?? emptyTotals();

      applyUsageTotals(bucket, entry.usage);
      if (entry.costBreakdown?.total !== undefined) {
        applyCostBreakdown(bucket, entry.costBreakdown);
      } else {
        applyCostTotal(bucket, entry.costTotal);
      }
      dailyMap.set(dayKey, bucket);

      applyUsageTotals(totals, entry.usage);
      if (entry.costBreakdown?.total !== undefined) {
        applyCostBreakdown(totals, entry.costBreakdown);
      } else {
        applyCostTotal(totals, entry.costTotal);
      }
    }
  }

  const daily: CostUsageDailyEntry[] = Array.from(dailyMap.entries())
    .map(([date, bucket]) => ({ date, ...bucket }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const days = Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;

  return { updatedAt: Date.now(), days, daily, totals };
}
