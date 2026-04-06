#!/usr/bin/env bun
/**
 * Experiment B: vantage × ceiling × grid validation.
 *
 * Q1 front-cam vs mirror:   10 cap × 2 provider = 20 gen  (chunyu/tease, count=1)
 * Q2 ceiling wardrobe:       5 cap × 2 provider = 10 gen  (chunyu/tease, count=1, mirror only)
 * Q3 grid rescue on Gemini:  5 cap × 2 count    = 10 gen  (Gemini only)
 * Total ≈ 40 gen × ~25s avg / concurrency 5 ≈ 15-20 min.
 *
 * Usage:
 *   GEMINI_API_KEY=... ARK_API_KEY=... bun scripts/selfie-test/vantage-ceiling-grid.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  buildPrompt,
  callDoubao,
  callGemini,
  loadReferenceImages,
  type SelfieCount,
  type SelfieStyle,
} from "../../extensions/selfie/index.ts";

const CAPTIONS_PATH = "/home/xingfanxia/tmp/vantage-ceiling-grid-captions.json";
const OUTPUT_BASE = "/home/xingfanxia/tmp/vantage-ceiling-grid";
const EXT_DIR = path.resolve(import.meta.dir, "..", "..", "extensions", "selfie");
const CONCURRENCY = 5;

type Caption = {
  id: string;
  scene: string;
  style: SelfieStyle;
  emphasis: string;
  pair?: string;
  vantage?: "front-cam" | "mirror";
};

type CaptionsFile = {
  q1_vantage: Caption[];
  q2_ceiling: Caption[];
  q3_grid_rescue: Caption[];
};

type TestCase = {
  experiment: "Q1" | "Q2" | "Q3";
  runId: string;
  caption: Caption;
  provider: "gemini" | "doubao";
  count: SelfieCount;
};

type Status = "pass" | "block" | "fail";

type Result = {
  case: TestCase;
  status: Status;
  reason?: string;
  duration: number;
  outputPath?: string;
};

async function loadCaptions(): Promise<CaptionsFile> {
  const raw = await fs.readFile(CAPTIONS_PATH, "utf8");
  return JSON.parse(raw) as CaptionsFile;
}

function planCases(c: CaptionsFile): TestCase[] {
  const cases: TestCase[] = [];
  for (const cap of c.q1_vantage) {
    for (const provider of ["gemini", "doubao"] as const) {
      cases.push({
        experiment: "Q1",
        runId: `${cap.id}-${provider}`,
        caption: cap,
        provider,
        count: 1,
      });
    }
  }
  for (const cap of c.q2_ceiling) {
    for (const provider of ["gemini", "doubao"] as const) {
      cases.push({
        experiment: "Q2",
        runId: `${cap.id}-${provider}`,
        caption: cap,
        provider,
        count: 1,
      });
    }
  }
  for (const cap of c.q3_grid_rescue) {
    for (const count of [1, 6] as const) {
      cases.push({
        experiment: "Q3",
        runId: `${cap.id}-c${count}`,
        caption: cap,
        provider: "gemini",
        count: count as SelfieCount,
      });
    }
  }
  return cases;
}

function classify(reason: string | undefined): Status {
  if (!reason) {
    return "fail";
  }
  if (/block|safety|sensitive|policy|content|moderation|refus/i.test(reason)) {
    return "block";
  }
  return "fail";
}

async function runCase(
  tc: TestCase,
  refs: Array<{ mimeType: string; data: string }>,
  keys: { gemini: string; doubao: string },
  runDir: string,
): Promise<Result> {
  const t0 = Date.now();
  const prompt = buildPrompt(tc.caption.scene, tc.caption.style, tc.count);
  const outDir = path.join(runDir, tc.experiment, tc.runId);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "prompt.txt"), prompt);
  await fs.writeFile(
    path.join(outDir, "meta.json"),
    JSON.stringify(
      {
        experiment: tc.experiment,
        runId: tc.runId,
        captionId: tc.caption.id,
        pair: tc.caption.pair ?? null,
        vantage: tc.caption.vantage ?? null,
        emphasis: tc.caption.emphasis,
        style: tc.caption.style,
        provider: tc.provider,
        count: tc.count,
        scene: tc.caption.scene,
      },
      null,
      2,
    ),
  );

  let result: Awaited<ReturnType<typeof callGemini>>;
  try {
    if (tc.provider === "gemini") {
      result = await callGemini(prompt, refs, keys.gemini);
    } else {
      result = await callDoubao(prompt, refs, keys.doubao);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await fs.writeFile(path.join(outDir, "error.txt"), `thrown: ${msg}`);
    return {
      case: tc,
      status: "fail",
      reason: `thrown: ${msg}`,
      duration: (Date.now() - t0) / 1000,
    };
  }

  const duration = (Date.now() - t0) / 1000;
  if (result.ok) {
    const filePath = path.join(outDir, `image.${result.ext}`);
    await fs.writeFile(filePath, result.bytes);
    return { case: tc, status: "pass", duration, outputPath: filePath };
  }
  const reason = result.hardReason || result.softReason;
  await fs.writeFile(path.join(outDir, "error.txt"), reason || "unknown");
  return { case: tc, status: classify(reason), reason, duration };
}

async function runWithConcurrency(
  items: TestCase[],
  worker: (tc: TestCase) => Promise<Result>,
  concurrency: number,
  onDone: (r: Result, idx: number, total: number) => void,
): Promise<Result[]> {
  const results: Result[] = Array.from({ length: items.length });
  let nextIdx = 0;
  async function loop(): Promise<void> {
    const i = nextIdx++;
    if (i >= items.length) {
      return;
    }
    const r = await worker(items[i]);
    results[i] = r;
    onDone(r, i, items.length);
    return loop();
  }
  await Promise.all(Array.from({ length: concurrency }, () => loop()));
  return results;
}

function escMd(s: string | undefined, max = 60): string {
  if (!s) {
    return "";
  }
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, max);
}

async function writeSummary(runDir: string, results: Result[]): Promise<void> {
  const lines: string[] = [];
  lines.push(`# Vantage / Ceiling / Grid Experiment\n`);
  lines.push(`Timestamp: ${new Date().toISOString()}`);
  lines.push(`Total cases: ${results.length}\n`);

  const groups = {
    Q1: results.filter((r) => r.case.experiment === "Q1"),
    Q2: results.filter((r) => r.case.experiment === "Q2"),
    Q3: results.filter((r) => r.case.experiment === "Q3"),
  };

  for (const [key, list] of Object.entries(groups)) {
    const pass = list.filter((r) => r.status === "pass").length;
    const block = list.filter((r) => r.status === "block").length;
    const fail = list.filter((r) => r.status === "fail").length;
    lines.push(`## ${key}`);
    lines.push(`Pass ${pass} / Block ${block} / Fail ${fail} (total ${list.length})\n`);
    lines.push("| id | provider | count | vantage | emphasis | pass/block/fail | dur | reason |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const r of list) {
      const v = r.case.caption.vantage ?? "-";
      lines.push(
        `| ${r.case.caption.id} | ${r.case.provider} | ${r.case.count} | ${v} | ${r.case.caption.emphasis} | ${r.status} | ${r.duration.toFixed(1)}s | ${escMd(r.reason)} |`,
      );
    }
    lines.push("");
  }

  // Q1 vantage comparison
  lines.push(`## Q1 Vantage Analysis\n`);
  lines.push(`Compare front-cam vs mirror pass rate per provider.\n`);
  for (const prov of ["gemini", "doubao"]) {
    const fc = groups.Q1.filter(
      (r) => r.case.provider === prov && r.case.caption.vantage === "front-cam",
    );
    const mr = groups.Q1.filter(
      (r) => r.case.provider === prov && r.case.caption.vantage === "mirror",
    );
    const fcPass = fc.filter((r) => r.status === "pass").length;
    const mPass = mr.filter((r) => r.status === "pass").length;
    lines.push(
      `- **${prov}**: front-cam ${fcPass}/${fc.length} pass, mirror ${mPass}/${mr.length} pass`,
    );
  }
  lines.push("");

  // Q1 per-pair
  const pairs = new Map<string, Result[]>();
  for (const r of groups.Q1) {
    const key = `${r.case.caption.pair}-${r.case.provider}`;
    if (!pairs.has(key)) {
      pairs.set(key, []);
    }
    pairs.get(key)!.push(r);
  }
  lines.push(`## Q1 Per-pair breakdown\n`);
  lines.push(`| pair | provider | front-cam | mirror |`);
  lines.push(`|---|---|---|---|`);
  for (const [key, rs] of pairs.entries()) {
    const [pair, provider] =
      key.split("-").length > 2
        ? [key.split("-").slice(0, -1).join("-"), key.split("-").slice(-1)[0]]
        : [key, ""];
    const front = rs.find((r) => r.case.caption.vantage === "front-cam");
    const mirror = rs.find((r) => r.case.caption.vantage === "mirror");
    lines.push(`| ${pair} | ${provider} | ${front?.status ?? "-"} | ${mirror?.status ?? "-"} |`);
  }
  lines.push("");

  // Q3 grid rescue comparison
  lines.push(`## Q3 Grid Rescue Analysis\n`);
  const c1 = groups.Q3.filter((r) => r.case.count === 1);
  const c6 = groups.Q3.filter((r) => r.case.count === 6);
  const c1Pass = c1.filter((r) => r.status === "pass").length;
  const c6Pass = c6.filter((r) => r.status === "pass").length;
  lines.push(`- Gemini count=1 (single panel): ${c1Pass}/${c1.length} pass`);
  lines.push(`- Gemini count=6 (XHS grid):    ${c6Pass}/${c6.length} pass`);
  lines.push(`- Grid rescue delta: ${c6Pass - c1Pass}`);
  lines.push("");

  lines.push(`## Per-scene grid rescue detail\n`);
  lines.push(`| scene | count=1 | count=6 | rescued? |`);
  lines.push(`|---|---|---|---|`);
  const byScene = new Map<string, { c1?: Result; c6?: Result }>();
  for (const r of groups.Q3) {
    const entry = byScene.get(r.case.caption.id) || {};
    if (r.case.count === 1) {
      entry.c1 = r;
    } else {
      entry.c6 = r;
    }
    byScene.set(r.case.caption.id, entry);
  }
  for (const [id, entry] of byScene.entries()) {
    const rescued = entry.c1?.status !== "pass" && entry.c6?.status === "pass" ? "YES" : "-";
    lines.push(`| ${id} | ${entry.c1?.status ?? "-"} | ${entry.c6?.status ?? "-"} | ${rescued} |`);
  }

  await fs.writeFile(path.join(runDir, "summary.md"), lines.join("\n"));
}

async function main(): Promise<void> {
  const geminiKey = process.env.GEMINI_API_KEY || "";
  const doubaoKey = process.env.ARK_API_KEY || "";
  if (!geminiKey) {
    console.error("[B] GEMINI_API_KEY not set");
    process.exit(1);
  }
  if (!doubaoKey) {
    console.error("[B] ARK_API_KEY not set");
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(OUTPUT_BASE, `run-${timestamp}`);
  await fs.mkdir(runDir, { recursive: true });

  const refs = await loadReferenceImages(EXT_DIR);
  const captions = await loadCaptions();
  await fs.writeFile(path.join(runDir, "captions.json"), JSON.stringify(captions, null, 2));

  const cases = planCases(captions);
  console.log(
    `[B] ${cases.length} cases planned (Q1=${captions.q1_vantage.length * 2}, Q2=${captions.q2_ceiling.length * 2}, Q3=${captions.q3_grid_rescue.length * 2}), concurrency ${CONCURRENCY}`,
  );
  console.log(`[B] Run dir: ${runDir}`);
  const start = Date.now();

  const results = await runWithConcurrency(
    cases,
    (tc) => runCase(tc, refs, { gemini: geminiKey, doubao: doubaoKey }, runDir),
    CONCURRENCY,
    (r, i, total) => {
      const pct = Math.round(((i + 1) / total) * 100);
      const v = r.case.caption.vantage ?? "-";
      console.log(
        `[${i + 1}/${total}] ${pct}% ${r.case.experiment} ${r.case.caption.id} ${r.case.provider} c=${r.case.count} v=${v} -> ${r.status} (${r.duration.toFixed(1)}s)`,
      );
    },
  );

  await writeSummary(runDir, results);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const pass = results.filter((r) => r.status === "pass").length;
  const block = results.filter((r) => r.status === "block").length;
  const fail = results.filter((r) => r.status === "fail").length;
  console.log(`[B] Done in ${elapsed}s. Pass ${pass} / Block ${block} / Fail ${fail}`);
  console.log(`[B] Summary: ${path.join(runDir, "summary.md")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
