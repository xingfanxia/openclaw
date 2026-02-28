import fs from "node:fs";
import { loadConfig } from "../../../src/config/config.js";
import { resolveSessionFilePath, resolveStorePath } from "../../../src/config/sessions/paths.js";
import { loadSessionStore } from "../../../src/config/sessions/store.js";
import { scanTranscriptFile } from "../../../src/infra/session-cost-usage.js";
import type { ParsedTranscriptEntry } from "../../../src/infra/session-cost-usage.types.js";
import { formatTokenCount, formatUsd } from "../../../src/utils/usage-format.js";

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

function fmtCost(v: number): string {
  return formatUsd(v) ?? "$0.00";
}

function fmtTokens(v: number): string {
  return formatTokenCount(v);
}

function resolveActiveSessionFile(): string | null {
  const config = loadConfig();
  const storePath = resolveStorePath(config.session?.store);
  const store = loadSessionStore(storePath, { skipCache: true });

  // Find the most recently updated session entry
  let latest: { key: string; entry: (typeof store)[string] } | null = null;
  for (const [key, entry] of Object.entries(store)) {
    if (!entry.sessionFile && !entry.sessionId) continue;
    if (!latest || (entry.updatedAt ?? 0) > (latest.entry.updatedAt ?? 0)) {
      latest = { key, entry };
    }
  }
  if (!latest) return null;

  const sessionFile =
    latest.entry.sessionFile ?? resolveSessionFilePath(latest.entry.sessionId, latest.entry);
  if (!sessionFile || !fs.existsSync(sessionFile)) return null;
  return sessionFile;
}

export async function handleCostMessagesCommand(args: string): Promise<string> {
  const countArg = parseInt(args.trim(), 10);
  const requestedCount = Number.isFinite(countArg) && countArg > 0 ? Math.min(countArg, 200) : 20;

  const sessionFile = resolveActiveSessionFile();
  if (!sessionFile) {
    return "No active session found.";
  }

  const config = loadConfig();
  const allEntries: MessageEntry[] = [];
  let messageIndex = 0;
  let cumulativeCost = 0;

  await scanTranscriptFile({
    filePath: sessionFile,
    config,
    onEntry: (entry: ParsedTranscriptEntry) => {
      messageIndex++;

      // Only show assistant messages with usage data
      if (entry.role !== "assistant" || !entry.usage) return;

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
    },
  });

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
