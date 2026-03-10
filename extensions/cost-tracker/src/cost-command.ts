import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { handleCostMessagesCommand } from "./cost-messages.js";
import { loadCostUsageSummary, type CostUsageSummary } from "./cost-scan.js";

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

// ---------------------------------------------------------------------------
// Period parsing
// ---------------------------------------------------------------------------

function parsePeriod(args: string): { startMs: number; endMs: number; label: string } {
  const now = new Date();
  const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayEndMs = todayStartMs + 24 * 60 * 60 * 1000 - 1;
  const arg = args.trim().toLowerCase();

  if (!arg || arg === "today" || arg === "day") {
    return { startMs: todayStartMs, endMs: todayEndMs, label: "Today" };
  }
  if (arg === "week" || arg === "7d") {
    const start = todayStartMs - 6 * 86400000;
    return { startMs: start, endMs: todayEndMs, label: "Last 7 days" };
  }
  if (arg === "month" || arg === "30d") {
    const start = todayStartMs - 29 * 86400000;
    return { startMs: start, endMs: todayEndMs, label: "Last 30 days" };
  }
  if (arg === "ytd") {
    const start = Date.UTC(now.getUTCFullYear(), 0, 1);
    return { startMs: start, endMs: todayEndMs, label: `YTD (${now.getUTCFullYear()})` };
  }
  // Default to today for unrecognized args
  return { startMs: todayStartMs, endMs: todayEndMs, label: "Today" };
}

// ---------------------------------------------------------------------------
// Spark bar
// ---------------------------------------------------------------------------

function sparkBar(values: number[], width: number = 14): string {
  const blocks = [
    " ",
    "\u2581",
    "\u2582",
    "\u2583",
    "\u2584",
    "\u2585",
    "\u2586",
    "\u2587",
    "\u2588",
  ];
  const max = Math.max(...values, 1);
  return values
    .slice(-width)
    .map((v) => blocks[Math.min(8, Math.round((v / max) * 8))])
    .join("");
}

// ---------------------------------------------------------------------------
// Formatting shorthands
// ---------------------------------------------------------------------------

function fmtCost(value: number): string {
  return formatUsd(value) ?? "$0.00";
}

function fmtTokens(value: number): string {
  return formatTokenCount(value);
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Main command handler
// ---------------------------------------------------------------------------

export async function handleCostCommand(args: string, config?: OpenClawConfig): Promise<string> {
  const firstWord = args.trim().split(/\s+/)[0]?.toLowerCase();
  if (firstWord === "messages" || firstWord === "msgs" || firstWord === "detail") {
    return handleCostMessagesCommand(args.trim().slice(firstWord.length).trim(), config);
  }

  const { startMs, endMs, label } = parsePeriod(args);
  const summary: CostUsageSummary = await loadCostUsageSummary({ startMs, endMs, config });

  const { totals, daily } = summary;

  if (totals.totalTokens === 0 && totals.totalCost === 0) {
    return "No usage data available.";
  }

  const lines: string[] = [];
  lines.push(`\u{1F4CA} Usage: ${label}`);
  lines.push(`${fmtDate(startMs)} \u2192 ${fmtDate(endMs)}`);
  lines.push("");
  lines.push(
    `\u{1F4B0} Total: ${fmtCost(totals.totalCost)} \u00B7 ${fmtTokens(totals.totalTokens)} tokens`,
  );
  lines.push(`   In: ${fmtTokens(totals.input)} \u00B7 Out: ${fmtTokens(totals.output)}`);
  if (totals.cacheRead > 0 || totals.cacheWrite > 0) {
    lines.push(
      `   Cache R: ${fmtTokens(totals.cacheRead)} \u00B7 W: ${fmtTokens(totals.cacheWrite)}`,
    );
  }
  if (totals.missingCostEntries > 0) {
    lines.push(`   \u26A0\uFE0F ${totals.missingCostEntries} entries missing cost data`);
  }
  lines.push("");

  if (daily.length > 1) {
    const costValues = daily.map((d) => d.totalCost);
    const tokenValues = daily.map((d) => d.totalTokens);
    lines.push(`\u{1F4C8} Daily trend (${daily.length}d)`);
    lines.push(`Cost:   ${sparkBar(costValues, 21)}`);
    lines.push(`Tokens: ${sparkBar(tokenValues, 21)}`);
    const recentDays = daily.slice(-5);
    for (const day of recentDays) {
      const dateShort = day.date.slice(5);
      lines.push(`  ${dateShort}: ${fmtCost(day.totalCost)} \u00B7 ${fmtTokens(day.totalTokens)}`);
    }
    lines.push("");
  } else if (daily.length === 1) {
    const day = daily[0];
    lines.push(`\u{1F4C5} ${day.date}`);
    lines.push(`  Cost: ${fmtCost(day.totalCost)} \u00B7 Tokens: ${fmtTokens(day.totalTokens)}`);
    lines.push(`  In: ${fmtTokens(day.input)} \u00B7 Out: ${fmtTokens(day.output)}`);
    if (day.cacheRead > 0 || day.cacheWrite > 0) {
      lines.push(`  Cache R: ${fmtTokens(day.cacheRead)} \u00B7 W: ${fmtTokens(day.cacheWrite)}`);
    }
    lines.push("");
  }

  // Cost breakdown by type
  if (totals.inputCost > 0 || totals.outputCost > 0) {
    lines.push("\u{1F4B3} Cost breakdown:");
    lines.push(
      `  Input: ${fmtCost(totals.inputCost)} \u00B7 Output: ${fmtCost(totals.outputCost)}`,
    );
    if (totals.cacheReadCost > 0 || totals.cacheWriteCost > 0) {
      lines.push(
        `  Cache R: ${fmtCost(totals.cacheReadCost)} \u00B7 W: ${fmtCost(totals.cacheWriteCost)}`,
      );
    }
    lines.push("");
  }

  lines.push("Usage: /cost [today|week|month|ytd|messages [N]]");
  return lines.join("\n");
}
