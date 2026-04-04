import fs from "node:fs";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveSessionsDir, scanTranscriptEntries, type ParsedEntry } from "./cost-scan.js";

// ---------------------------------------------------------------------------
// Inlined format helpers (no internal imports)
// ---------------------------------------------------------------------------

function formatTokenCount(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "0";
  }
  const safe = Math.max(0, value);
  if (safe >= 1_000_000) {
    return `${(safe / 1_000_000).toFixed(1)}m`;
  }
  if (safe >= 1_000) {
    const precision = safe >= 10_000 ? 0 : 1;
    const formatted = (safe / 1_000).toFixed(precision);
    if (Number(formatted) >= 1_000) {
      return `${(safe / 1_000_000).toFixed(1)}m`;
    }
    return `${formatted}k`;
  }
  return String(Math.round(safe));
}

function formatUsd(value?: number): string | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(2)}`;
  }
  return `$${value.toFixed(4)}`;
}

function fmtCost(v: number): string {
  return formatUsd(v) ?? "$0.00";
}

function fmtTokens(v: number): string {
  return formatTokenCount(v);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MessageEntry {
  index: number;
  time: string;
  model?: string;
  durationSec?: number;
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  cumCost: number;
  tools: string[];
}

// ---------------------------------------------------------------------------
// Resolve the most recently updated session transcript file
// ---------------------------------------------------------------------------

function resolveActiveSessionFile(config?: OpenClawConfig): string | null {
  const sessionsDir = resolveSessionsDir();
  const storePath = `${sessionsDir}/sessions.json`;

  let store: Record<string, Record<string, unknown>>;
  try {
    const raw = fs.readFileSync(storePath, "utf-8");
    store = JSON.parse(raw) as Record<string, Record<string, unknown>>;
  } catch {
    return null;
  }

  // Find the most recently updated session entry
  let latestKey: string | null = null;
  let latestUpdatedAt = 0;
  let latestEntry: Record<string, unknown> | null = null;

  for (const [key, entry] of Object.entries(store)) {
    if (!entry || typeof entry !== "object") continue;
    if (!entry.sessionFile && !entry.sessionId) continue;
    const updatedAt = typeof entry.updatedAt === "number" ? entry.updatedAt : 0;
    if (updatedAt > latestUpdatedAt) {
      latestUpdatedAt = updatedAt;
      latestKey = key;
      latestEntry = entry;
    }
  }

  if (!latestEntry) return null;

  // Resolve session file path
  let sessionFile = latestEntry.sessionFile as string | undefined;
  if (!sessionFile) {
    const sessionId = latestEntry.sessionId as string | undefined;
    if (!sessionId) return null;
    sessionFile = `${sessionsDir}/${sessionId}.jsonl`;
  }

  if (!fs.existsSync(sessionFile)) return null;
  return sessionFile;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function handleCostMessagesCommand(
  args: string,
  config?: OpenClawConfig,
): Promise<string> {
  const countArg = parseInt(args.trim(), 10);
  const requestedCount = Number.isFinite(countArg) && countArg > 0 ? Math.min(countArg, 200) : 20;

  const sessionFile = resolveActiveSessionFile(config);
  if (!sessionFile) {
    return "No active session found.";
  }

  const allEntries: MessageEntry[] = [];
  let messageIndex = 0;
  let cumulativeCost = 0;

  for await (const entry of scanTranscriptEntries(sessionFile)) {
    messageIndex++;

    // Only show assistant messages with usage data
    if (entry.role !== "assistant" || !entry.usage) continue;

    const input = entry.usage.input ?? 0;
    const output = entry.usage.output ?? 0;
    const cacheRead = entry.usage.cacheRead ?? 0;
    const cost = entry.costTotal ?? 0;
    cumulativeCost += cost;

    const ts = entry.timestamp;
    const time = ts
      ? `${String(ts.getUTCHours()).padStart(2, "0")}:${String(ts.getUTCMinutes()).padStart(2, "0")}`
      : "??:??";

    const durationSec =
      entry.durationMs !== undefined ? Math.round(entry.durationMs / 100) / 10 : undefined;

    allEntries.push({
      index: messageIndex,
      time,
      model: entry.model,
      durationSec,
      cost,
      input,
      output,
      cacheRead,
      cumCost: cumulativeCost,
      tools: entry.toolNames,
    });
  }

  if (allEntries.length === 0) {
    return "No messages with usage data in current session.";
  }

  const displayEntries = allEntries.slice(-requestedCount);
  const lines: string[] = [];

  lines.push(
    `\u{1F4CB} Last ${displayEntries.length} messages (of ${allEntries.length} in session)`,
  );
  lines.push("");

  for (const e of displayEntries) {
    const modelShort = e.model?.split("/").pop() ?? "unknown";
    const dur = e.durationSec !== undefined ? ` ${e.durationSec}s` : "";
    lines.push(`#${e.index} ${e.time} ${modelShort}${dur}`);

    const tokenSummary = `${fmtTokens(e.input)}\u2192${fmtTokens(e.output)}`;
    const cachePart = e.cacheRead > 0 ? ` \u00B7 cache ${fmtTokens(e.cacheRead)}` : "";
    lines.push(
      `  ${fmtCost(e.cost)} \u00B7 ${tokenSummary}${cachePart} \u00B7 \u03A3${fmtCost(e.cumCost)}`,
    );

    if (e.tools.length > 0) {
      lines.push(`  [${e.tools.join(", ")}]`);
    }
  }

  lines.push("");
  lines.push("\u2500".repeat(36));

  const totalCost = displayEntries.reduce((s, e) => s + e.cost, 0);
  const avgCost = displayEntries.length > 0 ? totalCost / displayEntries.length : 0;
  const peakEntry = displayEntries.reduce(
    (max, e) => (e.cost > max.cost ? e : max),
    displayEntries[0],
  );
  const displayTokens = displayEntries.reduce((s, e) => s + e.input + e.output + e.cacheRead, 0);

  lines.push(`Total: ${fmtCost(totalCost)} \u00B7 ${fmtTokens(displayTokens)} tokens`);
  lines.push(
    `Avg/turn: ${fmtCost(avgCost)} \u00B7 Peak: #${peakEntry.index} (${fmtCost(peakEntry.cost)})`,
  );
  lines.push(`Session total: ${fmtCost(cumulativeCost)}`);
  lines.push("");
  lines.push("Usage: /cost messages [N] (default 20, max 200)");

  return lines.join("\n");
}
