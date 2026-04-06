/**
 * Step 4: strict reproducibility on pass cases (4a) + plugin-v2-wrap
 * rescue test on fail + unstable pass cases (4b). Per 2026-04-23 handoff.
 *
 * Input:  /home/xingfanxia/tmp/single-pass-verified-plan.json (from audit)
 * Output: <research>/results/2026-04-23-step4/
 *           runs.jsonl              (append-only log of every call)
 *           4a-stability-buckets.csv
 *           4b-fail-rescue-buckets.csv
 *           4a-images/<basename>-run<k>.jpeg  (pass-case images only)
 *           4b-images/<basename>-run<k>.jpeg  (rescue-case images only)
 *
 * Resume: re-reads runs.jsonl on startup, skips case-run pairs already seen.
 *
 * Usage:
 *   bun scripts/selfie-test/step4-repro-and-rescue.ts --phase 4a [--concurrency 5] [--limit 0]
 *   bun scripts/selfie-test/step4-repro-and-rescue.ts --phase 4b [--concurrency 5]
 *   bun scripts/selfie-test/step4-repro-and-rescue.ts --phase both
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildPrompt } from "../../extensions/selfie/index.ts";

// ── Config ─────────────────────────────────────────────────────────────────

const N_REPEATS = 5;
const DEFAULT_CONCURRENCY = 5;

const PLAN_PATH = "/home/xingfanxia/tmp/single-pass-verified-plan.json";
const RESEARCH_ROOT = "/home/x_computelabs_ai/projects/zhuzhu-selfie-research";
const RESULTS_ROOT = path.join(RESEARCH_ROOT, "results", "2026-04-23-step4");
const RUNS_JSONL = path.join(RESULTS_ROOT, "runs.jsonl");

const OPENCLAW_ROOT = "/home/x_computelabs_ai/openclaw";
const FACE_REF_DIR = path.join(OPENCLAW_ROOT, "extensions", "selfie", "reference-images");
const FACE_REF_FILENAMES = ["mh_049.jpg", "mh_053.jpg", "mh_055.jpg", "mh_058.jpg", "mh_060.jpg"];

const DOUBAO_MODEL = "doubao-seedream-5-0-260128";
const DOUBAO_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const GEMINI_MODEL = "gemini-3.1-flash-image-preview";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_SAFETY_CATEGORIES = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
] as const;

const PLUGIN_WRAP_STYLE = "chunyu" as const; // plugin's doubao spicy path

// ── Types ──────────────────────────────────────────────────────────────────

interface CaseRecord {
  provider: "doubao" | "gemini";
  track: "A" | "B" | null;
  basename: string;
  sourceBatch: string;
  passed: boolean;
  promptPath: string | null;
  imagePath: string | null;
  errorPath: string | null;
  sceneId: string | null;
  sceneRisk: string | null;
  sceneCluster: string | null;
  captionFull: string | null;
  textOverlayFlag: boolean;
  proposedFilename: string;
}

interface Plan {
  pass_cases: CaseRecord[];
  fail_cases: CaseRecord[];
}

interface Img {
  mimeType: string;
  data: string;
}

type CallResult =
  | { ok: true; bytes: Buffer; ms: number }
  | { ok: false; error: string; ms: number; moderated: boolean };

interface RunRow {
  phase: "4a" | "4b";
  provider: "doubao" | "gemini";
  basename: string;
  track: "A" | "B" | null;
  sourceBatch: string;
  proposedFilename: string;
  runIdx: number; // 0..N_REPEATS-1
  ok: boolean;
  ms: number;
  error?: string;
  moderated?: boolean;
  promptMode: "original" | "plugin-wrap";
  imageSaved?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

async function loadKeys() {
  const cfgPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  const raw = await fsp.readFile(cfgPath, "utf8");
  const cfg = JSON.parse(raw) as {
    plugins?: {
      entries?: {
        selfie?: { config?: { geminiApiKey?: string; doubaoApiKey?: string } };
      };
    };
  };
  const doubao =
    process.env.ARK_API_KEY ?? cfg.plugins?.entries?.selfie?.config?.doubaoApiKey ?? "";
  const gemini =
    process.env.GEMINI_API_KEY ?? cfg.plugins?.entries?.selfie?.config?.geminiApiKey ?? "";
  return { doubao, gemini };
}

async function loadFaceRefs(): Promise<Img[]> {
  return Promise.all(
    FACE_REF_FILENAMES.map(async (name) => ({
      mimeType: "image/jpeg",
      data: (await fsp.readFile(path.join(FACE_REF_DIR, name))).toString("base64"),
    })),
  );
}

// Removes whole sentences that instruct the model to render text / title /
// caption / watermark / overlay onto the image. Preserves the rest of the
// caption. Expanded 2026-04-23 after round-1 runs revealed misses on verb
// forms ("captioned 'X'", "labelled 'X'"), watermark language, and all
// gemini cases (which had null captionFull in plan JSON and slipped the
// pass-through flag check).
const TEXT_OVERLAY_SENTENCE = new RegExp(
  "([^.!?]*?\\b(?:" +
    [
      "title\\s+(?:text\\s+reads|references?|reads|card|overlay|on\\s+top|at\\s+top|says)",
      "subtitle\\s+reads",
      "heading\\s+(?:reads|on|at)",
      "header\\s+(?:at|on|reads)",
      "caption\\s+(?:at|in|on|overlay|across|reads|says)",
      "(?:captioned|labell?ed|titled|tagged)\\s+['\"\\u201C]",
      "text\\s+(?:overlay|on\\s+image|in\\s+corner|at\\s+top|at\\s+bottom|reads|says)",
      "label\\s+reads",
      "word(?:s)?\\s+(?:reading|saying)\\s+['\"\\u201C]",
      "written\\s+['\"\\u201C]",
      "overlay\\s+reads",
      "watermark\\s+(?:visible|reading|in\\s+corner)",
      "banner\\s+(?:reading|text|saying)",
      "sticker\\s+(?:with\\s+text|reads|saying)",
    ].join("|") +
    ")[^.!?]*[.!?])",
  "gi",
);

// Always run — idempotent on prompts without any matching pattern. Do NOT
// gate on plan-JSON `textOverlayFlag` — that field was null for gemini
// cases because audit used scene.json.caption which gemini lacks.
function stripTextOverlay(text: string): string {
  return text
    .replace(TEXT_OVERLAY_SENTENCE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractSceneFromPrompt(body: string): string | null {
  const m = body.match(/Scene:\s*([\s\S]+?)(?:\n\s*AVOID:|\n\s*$)/i);
  if (!m) {
    return null;
  }
  return m[1].trim().replace(/\s+/g, " ");
}

async function resolveCaption(c: CaseRecord): Promise<string | null> {
  if (c.captionFull) {
    return c.captionFull;
  }
  if (!c.promptPath) {
    return null;
  }
  try {
    const body = await fsp.readFile(c.promptPath, "utf8");
    return extractSceneFromPrompt(body);
  } catch {
    return null;
  }
}

async function loadOriginalPrompt(c: CaseRecord): Promise<string | null> {
  if (!c.promptPath) {
    return null;
  }
  try {
    return await fsp.readFile(c.promptPath, "utf8");
  } catch {
    return null;
  }
}

// ── Providers ──────────────────────────────────────────────────────────────

async function callDoubao(prompt: string, refs: Img[], apiKey: string): Promise<CallResult> {
  const t0 = Date.now();
  try {
    const body = {
      model: DOUBAO_MODEL,
      prompt,
      image: refs.map((r) => `data:${r.mimeType};base64,${r.data}`),
      sequential_image_generation: "disabled",
      response_format: "url",
      size: "2K",
      stream: false,
      watermark: false,
    };
    const resp = await fetch(DOUBAO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(300_000),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 500);
      const moderated = /sensitive|safety|block|moderation/i.test(text);
      return { ok: false, error: `HTTP ${resp.status}: ${text}`, ms: Date.now() - t0, moderated };
    }
    const data = (await resp.json()) as {
      data?: Array<{ url?: string; b64_json?: string }>;
      error?: { code?: string; message?: string };
    };
    if (data.error) {
      const msg = `${data.error.code}: ${data.error.message}`;
      return {
        ok: false,
        error: msg,
        ms: Date.now() - t0,
        moderated: /sensitive|content/i.test(data.error.code ?? ""),
      };
    }
    const first = data.data?.[0];
    if (!first?.url && !first?.b64_json) {
      return { ok: false, error: "no image", ms: Date.now() - t0, moderated: false };
    }
    let bytes: Buffer;
    if (first.url) {
      const imgResp = await fetch(first.url, { signal: AbortSignal.timeout(60_000) });
      if (!imgResp.ok) {
        return {
          ok: false,
          error: `download HTTP ${imgResp.status}`,
          ms: Date.now() - t0,
          moderated: false,
        };
      }
      bytes = Buffer.from(await imgResp.arrayBuffer());
    } else {
      bytes = Buffer.from(first.b64_json!, "base64");
    }
    return { ok: true, bytes, ms: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
      moderated: false,
    };
  }
}

async function callGemini(prompt: string, refs: Img[], apiKey: string): Promise<CallResult> {
  const t0 = Date.now();
  const parts: Array<Record<string, unknown>> = [
    { text: prompt },
    ...refs.map((r) => ({ inlineData: { mimeType: r.mimeType, data: r.data } })),
  ];
  const safetySettings = GEMINI_SAFETY_CATEGORIES.map((category) => ({
    category,
    threshold: "BLOCK_NONE",
  }));
  try {
    const resp = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
        safetySettings,
      }),
    });
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 400);
      const moderated = /safety|block|harm|prohibited/i.test(text);
      return { ok: false, error: `HTTP ${resp.status}: ${text}`, ms: Date.now() - t0, moderated };
    }
    const data = (await resp.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
        };
        finishReason?: string;
        finishMessage?: string;
        safetyRatings?: Array<{ category: string; probability: string }>;
      }>;
      promptFeedback?: { blockReason?: string };
    };
    if (data.promptFeedback?.blockReason) {
      return {
        ok: false,
        error: `prompt-blocked: ${data.promptFeedback.blockReason}`,
        ms: Date.now() - t0,
        moderated: true,
      };
    }
    const cand = data.candidates?.[0];
    const imgPart = cand?.content?.parts?.find((p) => p.inlineData);
    if (!imgPart?.inlineData) {
      const reason = cand?.finishMessage ?? cand?.finishReason ?? "no image";
      const moderated = /safety|prohibit|harm/i.test(reason);
      return { ok: false, error: `no-image: ${reason}`, ms: Date.now() - t0, moderated };
    }
    return {
      ok: true,
      bytes: Buffer.from(imgPart.inlineData.data, "base64"),
      ms: Date.now() - t0,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
      moderated: false,
    };
  }
}

// ── Resume state ───────────────────────────────────────────────────────────

type ResumeKey = string;

// IMPORTANT: track must be part of the key — doubao ref3-01 exists in both
// track-A and track-B and they are distinct runs. Earlier version omitted
// track and skipped 23 track-B cases that share basenames with track-A.
function resumeKey(
  phase: "4a" | "4b",
  provider: string,
  track: "A" | "B" | null,
  basename: string,
  runIdx: number,
): ResumeKey {
  return `${phase}|${provider}|${track ?? "-"}|${basename}|${runIdx}`;
}

async function loadExistingRuns(): Promise<{ done: Set<ResumeKey>; rows: RunRow[] }> {
  if (!fs.existsSync(RUNS_JSONL)) {
    return { done: new Set(), rows: [] };
  }
  const body = await fsp.readFile(RUNS_JSONL, "utf8");
  const rows: RunRow[] = [];
  const done = new Set<ResumeKey>();
  for (const line of body.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const row = JSON.parse(line) as RunRow;
      rows.push(row);
      done.add(resumeKey(row.phase, row.provider, row.track, row.basename, row.runIdx));
    } catch {
      // skip malformed
    }
  }
  return { done, rows };
}

function appendRunRow(row: RunRow) {
  fs.appendFileSync(RUNS_JSONL, JSON.stringify(row) + "\n");
}

// ── Concurrency pool ───────────────────────────────────────────────────────

async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
) {
  let cursor = 0;
  let completed = 0;
  const total = items.length;
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= total) {
        return;
      }
      await fn(items[idx], idx);
      completed++;
      if (onProgress) {
        onProgress(completed, total);
      }
    }
  });
  await Promise.all(workers);
}

// ── Phase 4a: strict repro on pass cases ───────────────────────────────────

interface CallUnit {
  phase: "4a" | "4b";
  c: CaseRecord;
  runIdx: number;
  prompt: string;
  promptMode: "original" | "plugin-wrap";
}

async function planPhase4a(cases: CaseRecord[]): Promise<CallUnit[]> {
  const units: CallUnit[] = [];
  for (const c of cases) {
    const rawPrompt = await loadOriginalPrompt(c);
    if (!rawPrompt) {
      console.warn(`[skip 4a] ${c.basename}: no prompt.txt`);
      continue;
    }
    // Always strip — regex is idempotent on clean prompts, and plan-JSON's
    // textOverlayFlag missed all gemini cases + verb-form text renders.
    const prompt = stripTextOverlay(rawPrompt);
    for (let k = 0; k < N_REPEATS; k++) {
      units.push({ phase: "4a", c, runIdx: k, prompt, promptMode: "original" });
    }
  }
  return units;
}

async function planPhase4b(
  failCases: CaseRecord[],
  unstablePassCases: CaseRecord[],
): Promise<CallUnit[]> {
  const units: CallUnit[] = [];
  const allForRescue = [...failCases, ...unstablePassCases];
  for (const c of allForRescue) {
    const caption = await resolveCaption(c);
    if (!caption) {
      console.warn(`[skip 4b] ${c.basename}: no caption`);
      continue;
    }
    const cleanedCaption = stripTextOverlay(caption);
    // buildPrompt takes scenePrompt (= the scene paragraph only), wraps it
    // in the full plugin v2 spine (face/body/angle/style/scene/styleLine).
    const wrapped = buildPrompt(cleanedCaption, PLUGIN_WRAP_STYLE, 1);
    for (let k = 0; k < N_REPEATS; k++) {
      units.push({ phase: "4b", c, runIdx: k, prompt: wrapped, promptMode: "plugin-wrap" });
    }
  }
  return units;
}

async function runUnit(
  unit: CallUnit,
  refs: Img[],
  keys: { doubao: string; gemini: string },
  imageDirFor: (phase: "4a" | "4b", provider: "doubao" | "gemini") => string,
): Promise<RunRow> {
  const res =
    unit.c.provider === "doubao"
      ? await callDoubao(unit.prompt, refs, keys.doubao)
      : await callGemini(unit.prompt, refs, keys.gemini);

  const stem = unit.c.proposedFilename.replace(/\.[^.]+$/, "");
  const row: RunRow = {
    phase: unit.phase,
    provider: unit.c.provider,
    basename: unit.c.basename,
    track: unit.c.track,
    sourceBatch: unit.c.sourceBatch,
    proposedFilename: unit.c.proposedFilename,
    runIdx: unit.runIdx,
    ok: res.ok,
    ms: res.ms,
    promptMode: unit.promptMode,
  };

  if (res.ok) {
    const imgDir = imageDirFor(unit.phase, unit.c.provider);
    ensureDir(imgDir);
    const outPath = path.join(imgDir, `${stem}-run${unit.runIdx}.jpeg`);
    await fsp.writeFile(outPath, res.bytes);
    row.imageSaved = path.relative(RESULTS_ROOT, outPath);
  } else {
    row.error = res.error;
    row.moderated = res.moderated;
  }
  return row;
}

// ── CSV emitters ───────────────────────────────────────────────────────────

function csvEscape(s: string | number | boolean | null | undefined): string {
  if (s === null || s === undefined) {
    return "";
  }
  const str = typeof s === "string" ? s : String(s);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function emitStabilityCsv(rows: RunRow[], cases: CaseRecord[]) {
  const byCase = new Map<string, RunRow[]>();
  for (const r of rows) {
    if (r.phase !== "4a") {
      continue;
    }
    const key = `${r.provider}|${r.track ?? "-"}|${r.basename}`;
    if (!byCase.has(key)) {
      byCase.set(key, []);
    }
    byCase.get(key)!.push(r);
  }

  const headers = [
    "provider",
    "track",
    "basename",
    "proposed_filename",
    "pass_rate",
    "passes",
    "runs",
    "bucket",
    "any_moderated",
    "mean_ms",
    "scene_cluster",
    "scene_risk",
  ];
  const out: string[] = [headers.join(",")];

  for (const c of cases) {
    const key = `${c.provider}|${c.track ?? "-"}|${c.basename}`;
    const runs = byCase.get(key) ?? [];
    if (runs.length === 0) {
      continue;
    }
    const passes = runs.filter((r) => r.ok).length;
    const passRate = +(passes / runs.length).toFixed(3);
    // Handoff threshold: >=70% pass = stable. Rate-based so partial N runs
    // (e.g. smoke test with N=3) bucket sensibly too.
    const bucket = passRate >= 0.7 ? "stable" : passes === 0 ? "total-fail" : "unstable";
    const anyMod = runs.some((r) => r.moderated === true);
    const meanMs = Math.round(runs.reduce((a, r) => a + r.ms, 0) / runs.length);
    out.push(
      [
        csvEscape(c.provider),
        csvEscape(c.track ?? ""),
        csvEscape(c.basename),
        csvEscape(c.proposedFilename),
        passRate,
        passes,
        runs.length,
        bucket,
        anyMod,
        meanMs,
        csvEscape(c.sceneCluster ?? ""),
        csvEscape(c.sceneRisk ?? ""),
      ].join(","),
    );
  }

  const csvPath = path.join(RESULTS_ROOT, "4a-stability-buckets.csv");
  fs.writeFileSync(csvPath, out.join("\n") + "\n");
  console.log(`[4a] wrote ${csvPath} with ${out.length - 1} cases`);
}

function emitRescueCsv(rows: RunRow[], cases: CaseRecord[], originalPass: Map<string, boolean>) {
  const byCase = new Map<string, RunRow[]>();
  for (const r of rows) {
    if (r.phase !== "4b") {
      continue;
    }
    const key = `${r.provider}|${r.track ?? "-"}|${r.basename}`;
    if (!byCase.has(key)) {
      byCase.set(key, []);
    }
    byCase.get(key)!.push(r);
  }

  const headers = [
    "provider",
    "track",
    "basename",
    "proposed_filename",
    "original_passed",
    "rescue_pass_rate",
    "rescue_passes",
    "rescue_runs",
    "rescue_bucket",
    "any_moderated",
    "mean_ms",
    "scene_cluster",
    "scene_risk",
  ];
  const out: string[] = [headers.join(",")];

  for (const c of cases) {
    const key = `${c.provider}|${c.track ?? "-"}|${c.basename}`;
    const runs = byCase.get(key) ?? [];
    if (runs.length === 0) {
      continue;
    }
    const passes = runs.filter((r) => r.ok).length;
    const passRate = +(passes / runs.length).toFixed(3);
    const bucket = passRate >= 0.7 ? "rescued" : passes === 0 ? "still-fails" : "partial";
    const anyMod = runs.some((r) => r.moderated === true);
    const meanMs = Math.round(runs.reduce((a, r) => a + r.ms, 0) / runs.length);
    const origKey = `${c.provider}|${c.track ?? "-"}|${c.basename}`;
    out.push(
      [
        csvEscape(c.provider),
        csvEscape(c.track ?? ""),
        csvEscape(c.basename),
        csvEscape(c.proposedFilename),
        originalPass.get(origKey) ?? false,
        passRate,
        passes,
        runs.length,
        bucket,
        anyMod,
        meanMs,
        csvEscape(c.sceneCluster ?? ""),
        csvEscape(c.sceneRisk ?? ""),
      ].join(","),
    );
  }

  const csvPath = path.join(RESULTS_ROOT, "4b-fail-rescue-buckets.csv");
  fs.writeFileSync(csvPath, out.join("\n") + "\n");
  console.log(`[4b] wrote ${csvPath} with ${out.length - 1} cases`);
}

// ── Main ───────────────────────────────────────────────────────────────────

function parseArgs() {
  const a = process.argv.slice(2);
  let phase: "4a" | "4b" | "both" = "both";
  let concurrency = DEFAULT_CONCURRENCY;
  let limit = 0;
  let providerFilter: "doubao" | "gemini" | null = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--phase") {
      phase = a[++i] as "4a" | "4b" | "both";
    } else if (a[i] === "--concurrency") {
      concurrency = Number(a[++i]);
    } else if (a[i] === "--limit") {
      limit = Number(a[++i]);
    } else if (a[i] === "--provider") {
      providerFilter = a[++i] as "doubao" | "gemini";
    }
  }
  return { phase, concurrency, limit, providerFilter };
}

async function main() {
  const { phase, concurrency, limit, providerFilter } = parseArgs();
  ensureDir(RESULTS_ROOT);
  if (providerFilter) {
    console.log(`[filter] provider=${providerFilter}`);
  }
  const { done, rows: existingRows } = await loadExistingRuns();
  const keys = await loadKeys();
  if (!keys.doubao) {
    throw new Error("no doubao key (ARK_API_KEY or ~/.openclaw/openclaw.json)");
  }
  if (!keys.gemini) {
    throw new Error("no gemini key (GEMINI_API_KEY or ~/.openclaw/openclaw.json)");
  }

  const refs = await loadFaceRefs();
  const plan: Plan = JSON.parse(await fsp.readFile(PLAN_PATH, "utf8"));

  const imageDirFor = (p: "4a" | "4b", provider: "doubao" | "gemini") =>
    path.join(RESULTS_ROOT, `${p}-images`, provider);

  const allRows: RunRow[] = [...existingRows];

  // Phase 4a
  if (phase === "4a" || phase === "both") {
    console.log(
      `\n=== Phase 4a: strict repro on ${plan.pass_cases.length} pass cases × N=${N_REPEATS} ===`,
    );
    const passCasesFiltered = providerFilter
      ? plan.pass_cases.filter((c) => c.provider === providerFilter)
      : plan.pass_cases;
    let units = await planPhase4a(passCasesFiltered);
    if (limit > 0) {
      units = units.slice(0, limit);
    }
    const pending = units.filter(
      (u) => !done.has(resumeKey(u.phase, u.c.provider, u.c.track, u.c.basename, u.runIdx)),
    );
    console.log(
      `[4a] ${units.length} units total, ${units.length - pending.length} already done, ${pending.length} pending`,
    );

    let progressTick = Date.now();
    await runPool(
      pending,
      concurrency,
      async (unit) => {
        const row = await runUnit(unit, refs, keys, imageDirFor);
        appendRunRow(row);
        allRows.push(row);
      },
      (d, t) => {
        const now = Date.now();
        if (now - progressTick > 5000 || d === t) {
          progressTick = now;
          console.log(`[4a progress] ${d}/${t}`);
        }
      },
    );
    console.log(`[4a] done`);

    emitStabilityCsv(allRows, plan.pass_cases);
  }

  // Phase 4b
  if (phase === "4b" || phase === "both") {
    // Re-derive unstable pass cases from 4a rows (in case we're resuming).
    const byCase4a = new Map<string, RunRow[]>();
    for (const r of allRows) {
      if (r.phase !== "4a") {
        continue;
      }
      const k = `${r.provider}|${r.track ?? "-"}|${r.basename}`;
      if (!byCase4a.has(k)) {
        byCase4a.set(k, []);
      }
      byCase4a.get(k)!.push(r);
    }
    const unstablePassCases = plan.pass_cases.filter((c) => {
      const k = `${c.provider}|${c.track ?? "-"}|${c.basename}`;
      const runs = byCase4a.get(k);
      if (!runs || runs.length === 0) {
        return false;
      }
      const passes = runs.filter((r) => r.ok).length;
      const passRate = passes / runs.length;
      return passRate < 0.7;
    });

    console.log(`\n=== Phase 4b: plugin-v2-wrap rescue ===`);
    const failFiltered = providerFilter
      ? plan.fail_cases.filter((c) => c.provider === providerFilter)
      : plan.fail_cases;
    const unstableFiltered = providerFilter
      ? unstablePassCases.filter((c) => c.provider === providerFilter)
      : unstablePassCases;
    console.log(
      `[4b] ${failFiltered.length} original fails + ${unstableFiltered.length} unstable pass = ${failFiltered.length + unstableFiltered.length} cases × N=${N_REPEATS}`,
    );

    let units = await planPhase4b(failFiltered, unstableFiltered);
    if (limit > 0) {
      units = units.slice(0, limit);
    }
    const pending = units.filter(
      (u) => !done.has(resumeKey(u.phase, u.c.provider, u.c.track, u.c.basename, u.runIdx)),
    );
    console.log(
      `[4b] ${units.length} units total, ${units.length - pending.length} already done, ${pending.length} pending`,
    );

    let progressTick = Date.now();
    await runPool(
      pending,
      concurrency,
      async (unit) => {
        const row = await runUnit(unit, refs, keys, imageDirFor);
        appendRunRow(row);
        allRows.push(row);
      },
      (d, t) => {
        const now = Date.now();
        if (now - progressTick > 5000 || d === t) {
          progressTick = now;
          console.log(`[4b progress] ${d}/${t}`);
        }
      },
    );
    console.log(`[4b] done`);

    const originalPass = new Map<string, boolean>();
    for (const c of [...plan.pass_cases, ...plan.fail_cases]) {
      originalPass.set(`${c.provider}|${c.track ?? "-"}|${c.basename}`, c.passed);
    }
    const rescueCases = [...plan.fail_cases, ...unstablePassCases];
    emitRescueCsv(allRows, rescueCases, originalPass);
  }

  console.log(`\n=== complete ===`);
  console.log(`results: ${RESULTS_ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
