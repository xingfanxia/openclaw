/**
 * Step 5: physics-correct front-cam rewrite on the 103 stable cases
 * identified by step 4a.
 *
 * For each stable case:
 *   1. Classify: mirror-only (grid / full-body / rear-view) vs front-cam
 *      convertible. Mirror-only cases are tagged and skipped — their
 *      composition inherently requires mirror framing.
 *   2. For convertible cases, rewrite the scene paragraph:
 *      - Strip "mirror selfie" / "phone held at face level" / "arm extended
 *        holding phone" (the last is physically wrong for a front-cam shot —
 *        the camera IS the phone, it can't see itself).
 *      - Prepend "iPhone front-camera selfie from above, tight close-up of
 *        face and upper body, no phone visible in frame, arm holding phone
 *        cropped out of frame, slight wide-angle distortion characteristic
 *        of selfie lens."
 *   3. Run × provider × N=5 with the rewritten prompt.
 *   4. Bucket: preserved (>=70% still pass) vs degraded vs total-fail.
 *
 * Output: <research>/results/2026-04-23-step5/
 *   runs.jsonl
 *   5-frontcam-repro.csv
 *   images/<basename>-frontcam-run<k>.jpeg
 *
 * Usage:
 *   bun scripts/selfie-test/step5-frontcam-rewrite.ts --concurrency 3 [--provider doubao|gemini] [--limit N]
 *
 * Input: reads the 4a stability CSV at
 *   results/2026-04-23-step4/4a-stability-buckets.csv
 * and the original plan JSON for case-level details.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

// ── Config ─────────────────────────────────────────────────────────────────

const N_REPEATS = 5;
const DEFAULT_CONCURRENCY = 3;

const PLAN_PATH = "/home/xingfanxia/tmp/single-pass-verified-plan.json";
const RESEARCH_ROOT = "/home/x_computelabs_ai/projects/zhuzhu-selfie-research";
const STEP4_CSV = path.join(
  RESEARCH_ROOT,
  "results",
  "2026-04-23-step4",
  "4a-stability-buckets.csv",
);
const RESULTS_ROOT = path.join(RESEARCH_ROOT, "results", "2026-04-23-step5");
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

const FRONTCAM_PREFIX =
  "iPhone front-camera selfie from above, tight close-up of face and upper body, no phone visible in frame, arm holding phone cropped out of frame, slight wide-angle distortion characteristic of selfie lens. ";

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
  phase: "5";
  provider: "doubao" | "gemini";
  basename: string;
  track: "A" | "B" | null;
  sourceBatch: string;
  proposedFilename: string;
  runIdx: number;
  ok: boolean;
  ms: number;
  error?: string;
  moderated?: boolean;
  imageSaved?: string;
}

type Convertibility = "mirror-only" | "convertible";

// ── Helpers ────────────────────────────────────────────────────────────────

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

async function loadKeys() {
  const cfgPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  const raw = await fsp.readFile(cfgPath, "utf8");
  const cfg = JSON.parse(raw) as {
    plugins?: {
      entries?: { selfie?: { config?: { geminiApiKey?: string; doubaoApiKey?: string } } };
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

// Scenes whose composition inherently requires a mirror or back-cam POV —
// no point trying front-cam rewrite on them. Flag and skip.
const MIRROR_ONLY_PATTERNS = [
  /\b(?:grid|collage|2x\d|\dx\d|\dx\d grid|2-panel|two-panel)\b/i,
  /\bfull-?(?:body|length)\b/i,
  /\bback-?(?:of-?(?:head|body)|view|facing|turned)\b/i,
  /\brear(?:-view)?\b/i,
  /\boverhead\s+POV/i,
  /\bOOTD\b|outfit\s+of\s+the\s+day/i,
  /\bmirror\s+(?:wall|corner)\b/i,
];

function classifyConvertibility(caption: string): Convertibility {
  for (const re of MIRROR_ONLY_PATTERNS) {
    if (re.test(caption)) {
      return "mirror-only";
    }
  }
  return "convertible";
}

// Phrases that describe back-cam / mirror composition. Strip these so the
// scene stops implying a phone-in-frame or mirror reflection.
const STRIP_PHRASES = [
  /\bmirror\s+selfie\b/gi,
  /\bmirror\s+shot\b/gi,
  /\bphone\s+(?:held|raised|obscuring|blocking|covering)\b[^.,;]*/gi,
  /\barm\s+(?:extended|raised|outstretched)\s+(?:holding|with)\s+(?:the\s+)?phone\b/gi,
  /\bholding\s+(?:the\s+)?(?:phone|iPhone)\s+(?:up|at|in)\b[^.,;]*/gi,
  /\bface\s+(?:obscured|blocked|covered)\s+by\s+(?:the\s+)?phone\b/gi,
  /\bphone-?block\s+(?:mirror-)?selfie\s+technique\b/gi,
  /\bstandard\s+phone-?block\b[^.,;]*/gi,
  /\breflection\s+in\s+(?:the\s+)?mirror\b/gi,
  /\bin\s+(?:the\s+)?(?:wardrobe|bathroom|hallway|bedroom)\s+mirror\b/gi,
];

function rewriteSceneForFrontCam(originalScene: string): string {
  let s = originalScene;
  for (const re of STRIP_PHRASES) {
    s = s.replace(re, "");
  }
  // Tidy whitespace: collapse runs, fix ", ," artifacts from stripping.
  s = s
    .replace(/,\s*,/g, ",")
    .replace(/\s*—\s*,/g, " —")
    .replace(/\s*\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .trim();
  return FRONTCAM_PREFIX + s;
}

// The original prompt.txt has structure:
//   [face preserve lines]
//   [body lines]
//   Scene: <caption>
//   AVOID: ...
// We only rewrite the Scene: block; rest stays intact.
function rewritePrompt(originalPrompt: string): string {
  return originalPrompt.replace(
    /(^|\n)(Scene:\s*)([\s\S]+?)(\n\s*AVOID:)/i,
    (_match, pfx, sceneLabel, sceneBody, avoidStart) => {
      const rewritten = rewriteSceneForFrontCam(sceneBody.trim().replace(/\s+/g, " "));
      return `${pfx}${sceneLabel}${rewritten}${avoidStart}`;
    },
  );
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

// Text-overlay instructions stripped per step 1 policy. Regex expanded
// 2026-04-23 to catch verb forms ("captioned 'X'", "labelled 'X'"),
// watermark/banner/sticker language, and all gemini cases that slipped
// the original flag check (plan JSON had null captionFull for gemini).
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

function stripTextOverlay(text: string): string {
  return text
    .replace(TEXT_OVERLAY_SENTENCE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Providers (copy of step4 callers) ──────────────────────────────────────

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
      return {
        ok: false,
        error: `${data.error.code}: ${data.error.message}`,
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
      return {
        ok: false,
        error: `no-image: ${reason}`,
        ms: Date.now() - t0,
        moderated: /safety|prohibit|harm/i.test(reason),
      };
    }
    return { ok: true, bytes: Buffer.from(imgPart.inlineData.data, "base64"), ms: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
      moderated: false,
    };
  }
}

// ── Stable case selection from step 4a CSV ─────────────────────────────────

async function loadStableCases(): Promise<CaseRecord[]> {
  const csvBody = await fsp.readFile(STEP4_CSV, "utf8");
  const lines = csvBody.split("\n").filter(Boolean);
  const header = lines[0].split(",");
  const iProv = header.indexOf("provider");
  const iTrack = header.indexOf("track");
  const iBasename = header.indexOf("basename");
  const iBucket = header.indexOf("bucket");

  const stableKeys = new Set<string>();
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    if (cols[iBucket] !== "stable") {
      continue;
    }
    const track = cols[iTrack] || "-";
    stableKeys.add(`${cols[iProv]}|${track}|${cols[iBasename]}`);
  }

  const plan: Plan = JSON.parse(await fsp.readFile(PLAN_PATH, "utf8"));
  const stable: CaseRecord[] = [];
  for (const c of plan.pass_cases) {
    const k = `${c.provider}|${c.track ?? "-"}|${c.basename}`;
    if (stableKeys.has(k)) {
      stable.push(c);
    }
  }
  return stable;
}

// ── Resume ─────────────────────────────────────────────────────────────────

function resumeKey(provider: string, track: "A" | "B" | null, basename: string, runIdx: number) {
  return `5|${provider}|${track ?? "-"}|${basename}|${runIdx}`;
}

async function loadExistingRuns(): Promise<{ done: Set<string>; rows: RunRow[] }> {
  if (!fs.existsSync(RUNS_JSONL)) {
    return { done: new Set(), rows: [] };
  }
  const body = await fsp.readFile(RUNS_JSONL, "utf8");
  const rows: RunRow[] = [];
  const done = new Set<string>();
  for (const l of body.split("\n")) {
    if (!l.trim()) {
      continue;
    }
    try {
      const r = JSON.parse(l) as RunRow;
      rows.push(r);
      done.add(resumeKey(r.provider, r.track, r.basename, r.runIdx));
    } catch {}
  }
  return { done, rows };
}

function appendRunRow(row: RunRow) {
  fs.appendFileSync(RUNS_JSONL, JSON.stringify(row) + "\n");
}

// ── Pool ───────────────────────────────────────────────────────────────────

async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
) {
  let cursor = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) {
        return;
      }
      await fn(items[idx], idx);
      completed++;
      if (onProgress) {
        onProgress(completed, items.length);
      }
    }
  });
  await Promise.all(workers);
}

// ── Unit planning ──────────────────────────────────────────────────────────

interface CallUnit {
  c: CaseRecord;
  runIdx: number;
  rewrittenPrompt: string;
  convertibility: Convertibility;
}

function extractSceneFromPromptBody(body: string): string {
  const m = body.match(/Scene:\s*([\s\S]+?)(?:\n\s*AVOID:|\n\s*$)/i);
  if (!m) {
    return "";
  }
  return m[1].trim().replace(/\s+/g, " ");
}

async function planUnits(
  cases: CaseRecord[],
): Promise<{ units: CallUnit[]; mirrorOnly: CaseRecord[] }> {
  // Build sibling caption map from doubao cases (plan JSON only populates
  // captionFull for doubao — gemini cases have null captionFull and need a
  // fallback from the sibling doubao case sharing the same basename, or from
  // parsing the Scene: block of the case's own prompt.txt).
  const plan: Plan = JSON.parse(await fsp.readFile(PLAN_PATH, "utf8"));
  const siblingCaption = new Map<string, string>();
  for (const c of [...plan.pass_cases, ...plan.fail_cases]) {
    if (c.provider === "doubao" && c.captionFull) {
      if (!siblingCaption.has(c.basename)) {
        siblingCaption.set(c.basename, c.captionFull);
      }
    }
  }

  const units: CallUnit[] = [];
  const mirrorOnly: CaseRecord[] = [];
  for (const c of cases) {
    const originalPrompt = await loadOriginalPrompt(c);
    if (!originalPrompt) {
      console.warn(`[skip] ${c.basename}: no prompt.txt`);
      continue;
    }
    const caption =
      c.captionFull ?? siblingCaption.get(c.basename) ?? extractSceneFromPromptBody(originalPrompt);
    const conv = classifyConvertibility(caption);
    if (conv === "mirror-only") {
      mirrorOnly.push(c);
      continue;
    }
    // Always strip — idempotent; flag in plan JSON was incomplete for gemini.
    const cleanedOriginal = stripTextOverlay(originalPrompt);
    const rewritten = rewritePrompt(cleanedOriginal);
    for (let k = 0; k < N_REPEATS; k++) {
      units.push({ c, runIdx: k, rewrittenPrompt: rewritten, convertibility: "convertible" });
    }
  }
  return { units, mirrorOnly };
}

async function runUnit(
  unit: CallUnit,
  refs: Img[],
  keys: { doubao: string; gemini: string },
): Promise<RunRow> {
  const res =
    unit.c.provider === "doubao"
      ? await callDoubao(unit.rewrittenPrompt, refs, keys.doubao)
      : await callGemini(unit.rewrittenPrompt, refs, keys.gemini);

  const stem = unit.c.proposedFilename.replace(/\.[^.]+$/, "");
  const row: RunRow = {
    phase: "5",
    provider: unit.c.provider,
    basename: unit.c.basename,
    track: unit.c.track,
    sourceBatch: unit.c.sourceBatch,
    proposedFilename: unit.c.proposedFilename,
    runIdx: unit.runIdx,
    ok: res.ok,
    ms: res.ms,
  };
  if (res.ok) {
    const imgDir = path.join(RESULTS_ROOT, "images", unit.c.provider);
    ensureDir(imgDir);
    const outPath = path.join(imgDir, `${stem}-frontcam-run${unit.runIdx}.jpeg`);
    await fsp.writeFile(outPath, res.bytes);
    row.imageSaved = path.relative(RESULTS_ROOT, outPath);
  } else {
    row.error = res.error;
    row.moderated = res.moderated;
  }
  return row;
}

// ── CSV emitter ────────────────────────────────────────────────────────────

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

async function emitCsv(rows: RunRow[], cases: CaseRecord[], mirrorOnly: CaseRecord[]) {
  const step4Csv = await fsp.readFile(STEP4_CSV, "utf8");
  const step4Lines = step4Csv.split("\n").filter(Boolean);
  const step4Header = step4Lines[0].split(",");
  const iProv = step4Header.indexOf("provider");
  const iTrack = step4Header.indexOf("track");
  const iBasename = step4Header.indexOf("basename");
  const iRate = step4Header.indexOf("pass_rate");
  const step4Rate = new Map<string, number>();
  for (const line of step4Lines.slice(1)) {
    const cols = line.split(",");
    const k = `${cols[iProv]}|${cols[iTrack] || "-"}|${cols[iBasename]}`;
    step4Rate.set(k, Number(cols[iRate]));
  }

  const byCase = new Map<string, RunRow[]>();
  for (const r of rows) {
    const k = `${r.provider}|${r.track ?? "-"}|${r.basename}`;
    if (!byCase.has(k)) {
      byCase.set(k, []);
    }
    byCase.get(k)!.push(r);
  }

  const headers = [
    "provider",
    "track",
    "basename",
    "proposed_filename",
    "classification",
    "original_pass_rate",
    "frontcam_pass_rate",
    "frontcam_passes",
    "frontcam_runs",
    "delta_pp",
    "bucket",
    "any_moderated",
    "mean_ms",
  ];
  const out: string[] = [headers.join(",")];

  for (const c of cases) {
    const k = `${c.provider}|${c.track ?? "-"}|${c.basename}`;
    const origRate = step4Rate.get(k) ?? 0;
    const isMirror = mirrorOnly.some(
      (m) => m.provider === c.provider && m.track === c.track && m.basename === c.basename,
    );
    if (isMirror) {
      out.push(
        [
          csvEscape(c.provider),
          csvEscape(c.track ?? ""),
          csvEscape(c.basename),
          csvEscape(c.proposedFilename),
          "mirror-only",
          origRate,
          "",
          "",
          "",
          "",
          "skipped",
          "",
          "",
        ].join(","),
      );
      continue;
    }
    const runs = byCase.get(k) ?? [];
    if (runs.length === 0) {
      continue;
    }
    const passes = runs.filter((r) => r.ok).length;
    const rate = +(passes / runs.length).toFixed(3);
    const delta = +((rate - origRate) * 100).toFixed(1);
    const bucket =
      rate >= 0.7 ? "preserved" : passes === 0 ? "degraded-total-fail" : "degraded-partial";
    const anyMod = runs.some((r) => r.moderated === true);
    const meanMs = Math.round(runs.reduce((a, r) => a + r.ms, 0) / runs.length);
    out.push(
      [
        csvEscape(c.provider),
        csvEscape(c.track ?? ""),
        csvEscape(c.basename),
        csvEscape(c.proposedFilename),
        "convertible",
        origRate,
        rate,
        passes,
        runs.length,
        delta,
        bucket,
        anyMod,
        meanMs,
      ].join(","),
    );
  }

  const csvPath = path.join(RESULTS_ROOT, "5-frontcam-repro.csv");
  fs.writeFileSync(csvPath, out.join("\n") + "\n");
  console.log(`[5] wrote ${csvPath} with ${out.length - 1} rows`);
}

// ── Main ───────────────────────────────────────────────────────────────────

function parseArgs() {
  const a = process.argv.slice(2);
  let concurrency = DEFAULT_CONCURRENCY;
  let limit = 0;
  let providerFilter: "doubao" | "gemini" | null = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--concurrency") {
      concurrency = Number(a[++i]);
    } else if (a[i] === "--limit") {
      limit = Number(a[++i]);
    } else if (a[i] === "--provider") {
      providerFilter = a[++i] as "doubao" | "gemini";
    }
  }
  return { concurrency, limit, providerFilter };
}

async function main() {
  const { concurrency, limit, providerFilter } = parseArgs();
  ensureDir(RESULTS_ROOT);
  const keys = await loadKeys();
  if (!keys.doubao) {
    throw new Error("no doubao key");
  }
  if (!keys.gemini) {
    throw new Error("no gemini key");
  }

  const refs = await loadFaceRefs();
  const allStable = await loadStableCases();
  const cases = providerFilter ? allStable.filter((c) => c.provider === providerFilter) : allStable;

  console.log(`\n=== Step 5: front-cam rewrite ===`);
  console.log(
    `stable cases: ${cases.length}${providerFilter ? ` (filtered to ${providerFilter})` : ""}`,
  );

  const { units, mirrorOnly } = await planUnits(cases);
  console.log(
    `convertible units: ${units.length} (${units.length / N_REPEATS} cases × N=${N_REPEATS})`,
  );
  console.log(`mirror-only (skipped): ${mirrorOnly.length}`);
  for (const c of mirrorOnly) {
    console.log(`  [mirror-only] ${c.provider}/${c.track ?? "-"} ${c.basename}`);
  }

  const { done, rows: existingRows } = await loadExistingRuns();
  let plannedUnits = units;
  if (limit > 0) {
    plannedUnits = plannedUnits.slice(0, limit);
  }
  const pending = plannedUnits.filter(
    (u) => !done.has(resumeKey(u.c.provider, u.c.track, u.c.basename, u.runIdx)),
  );
  console.log(
    `[5] ${plannedUnits.length} units total, ${plannedUnits.length - pending.length} already done, ${pending.length} pending`,
  );

  const allRows: RunRow[] = [...existingRows];
  let progressTick = Date.now();
  await runPool(
    pending,
    concurrency,
    async (unit) => {
      const row = await runUnit(unit, refs, keys);
      appendRunRow(row);
      allRows.push(row);
    },
    (d, t) => {
      const now = Date.now();
      if (now - progressTick > 5000 || d === t) {
        progressTick = now;
        console.log(`[5 progress] ${d}/${t}`);
      }
    },
  );
  console.log(`[5] done`);

  await emitCsv(allRows, cases, mirrorOnly);

  console.log(`\n=== complete ===`);
  console.log(`results: ${RESULTS_ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
