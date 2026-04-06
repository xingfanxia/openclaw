/**
 * Audit the 4 scoped batches named in the 2026-04-23 handoff and emit a
 * plan JSON describing every case found (pass + fail), with its provider,
 * track, basename, original prompt path, and image/error path.
 *
 * No files are copied or renamed. Output goes to:
 *   /home/xingfanxia/tmp/single-pass-verified-plan.json
 *
 * Provider signal is PATH-BASED (memory rule corrected 2026-04-23):
 *   doubao-selfie-test/... -> doubao
 *   safety-matrix/...      -> gemini
 * Extension is NOT used as a provider signal — safety-matrix.ts picks the
 * file extension from the first-byte magic of the returned bytes, so
 * Gemini can emit image.jpeg too.
 *
 * Usage: bun scripts/selfie-test/audit-pass-cases.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

type Provider = "doubao" | "gemini";
type Track = "A" | "B" | null;

interface Source {
  provider: Provider;
  track: Track;
  root: string;
  sourceBatch: string;
  // if root itself contains case dirs, pass "" as caseRoot and caseDirFilter looks in root.
  caseRoot: string;
  caseDirGlob: RegExp;
}

const HOME = "/home/xingfanxia";

const SOURCES: Source[] = [
  {
    provider: "doubao",
    track: "A",
    root: `${HOME}/tmp/doubao-selfie-test/ref3-2026-04-22T12-42-37`,
    sourceBatch: "doubao-selfie-test/ref3-2026-04-22T12-42-37",
    caseRoot: "track-A",
    caseDirGlob: /^ref3-\d+$/,
  },
  {
    provider: "doubao",
    track: "B",
    root: `${HOME}/tmp/doubao-selfie-test/ref3-2026-04-22T12-42-37`,
    sourceBatch: "doubao-selfie-test/ref3-2026-04-22T12-42-37",
    caseRoot: "track-B",
    caseDirGlob: /^ref3-\d+$/,
  },
  {
    provider: "doubao",
    track: "A",
    root: `${HOME}/tmp/doubao-selfie-test/ref12-2026-04-22T13-43-26`,
    sourceBatch: "doubao-selfie-test/ref12-2026-04-22T13-43-26",
    caseRoot: "track-A",
    // "ref12" in the batch name = ref set 1 AND 2 combined (40 captions =
    // 22 ref1-XX + 18 ref2-XX). Summary.md confirms 37/40 pass on track-A.
    caseDirGlob: /^ref[12]-\d+$/,
  },
  {
    provider: "gemini",
    track: null,
    root: `${HOME}/tmp/safety-matrix/ref12-2026-04-22T13-43-16`,
    sourceBatch: "safety-matrix/ref12-2026-04-22T13-43-16",
    caseRoot: "gemini-none",
    // Same "ref12" = ref1 + ref2 convention as doubao sibling batch.
    caseDirGlob: /^ref[12]-\d+$/,
  },
  {
    provider: "gemini",
    track: null,
    root: `${HOME}/tmp/safety-matrix/run-2026-04-22T12-53-41`,
    sourceBatch: "safety-matrix/run-2026-04-22T12-53-41",
    caseRoot: "gemini-none",
    caseDirGlob: /^ref3-\d+$/,
  },
];

interface CaseRecord {
  provider: Provider;
  track: Track;
  basename: string;
  sourceBatch: string;
  passed: boolean;
  promptPath: string | null;
  imagePath: string | null;
  errorPath: string | null;
  scenePath: string | null;
  sceneId: string | null;
  sceneRisk: string | null;
  sceneCluster: string | null;
  captionFull: string | null;
  captionSnippet: string | null;
  textOverlayFlag: boolean;
  nestedRecoveredFromParent: string | null;
  proposedFilename: string;
}

interface SceneJson {
  id?: string;
  cluster?: string;
  risk?: string;
  caption?: string;
  track?: string;
  [k: string]: unknown;
}

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function safeReadJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function firstExisting(dir: string, names: string[]): string | null {
  for (const n of names) {
    const full = path.join(dir, n);
    if (fileExists(full)) {
      return full;
    }
  }
  return null;
}

// Detects scene-level instructions asking for rendered text/caption/title
// on the image — step 4 says to strip these before repro, so we flag here.
// Deterministic, text-only derivation of a short content slug from
// scene.json.caption. No visual inspection. Pipeline:
//   1. Cluster (scene.json) → lowercase token (outfit/bedroom/...)
//   2. "Emphasis on X" regex → emphasis token (cleavage/thighs/glutes/...)
//   3. Scan caption for high-signal setting/pose keywords from a fixed
//      vocabulary, keep up to 2 distinct tokens.
// Filename: <cluster>-<emphasis>-<setting-tokens>-<origId>.<ext>
//
// If regex misses, falls back to <cluster>-<risk>-<origId>.<ext>.
// The fixed vocabulary avoids per-caption hallucination — the same keyword
// list decides the tokens for every case.

const EMPHASIS_PATTERNS: RegExp[] = [/emphasis\s+on\s+(?:the\s+)?([a-z][a-z-]+)/i];

const SETTING_VOCAB: Array<[RegExp, string]> = [
  [/\bgrid\b|2x\d\b|\dx\d\b|collage\b/i, "grid"],
  [/fitting\s+room/i, "fittingroom"],
  [/dressing\s+room/i, "fittingroom"],
  [/mirror\s+selfie|full-?length\s+mirror|wardrobe\s+mirror|floor\s+mirror/i, "mirror"],
  [/front-?cam|front\s+camera/i, "frontcam"],
  [/back-?cam|back\s+camera/i, "backcam"],
  [/bathroom|tub|bathtub|shower/i, "bathroom"],
  [/hotel\s+(?:bed|room)|bed\b(?!\s?sheet)/i, "bedroom"],
  [/kneeling|lying\s+prone|lying\s+face-?down|on\s+all\s+fours|crouch/i, "prone"],
  [/standing|upright/i, "standing"],
  [/seated|sitting|on\s+(?:a\s+)?chair|at\s+(?:a\s+)?desk/i, "seated"],
  [/beach|sand|ocean|shore/i, "beach"],
  [/pool(?:side)?/i, "pool"],
  [/balcony|rooftop/i, "balcony"],
  [/outdoor|outside|street|park\b/i, "outdoor"],
  [/elevator|lift\b/i, "elevator"],
  [/corridor|hallway/i, "hallway"],
  [/car\b|driver\s+seat|passenger\s+seat/i, "car"],
  [/gym\b|yoga\b|pilates/i, "gym"],
  [/kitchen|counter/i, "kitchen"],
  [/sofa|couch|living\s+room/i, "livingroom"],
  [/lingerie|camisole|chemise|bustier|bodysuit|garter|stocking/i, "lingerie"],
  [/bikini|swimsuit|one-?piece/i, "bikini"],
  [/crop\s?top|midriff|navel/i, "croptop"],
  [/deep-?v|plunge|low-?cut/i, "deepv"],
  [/halter|open-?back|backless/i, "halter"],
  [/hotpants|booty\s?shorts|biker\s+shorts|short\s+shorts/i, "shorts"],
  [/micro-?mini|mini\s+skirt|mini\s+dress/i, "mini"],
  [/leggings|yoga\s+pants|bodycon/i, "bodycon"],
  [/sheer|see-?through|mesh\b/i, "sheer"],
  [/dress\b/i, "dress"],
  [/outfit\b|ootd/i, "ootd"],
];

function sanitizeToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 16);
}

// Extracts the "Scene: <paragraph>" block from a prompt.txt body. Returns
// null if not found. Used for gemini cases where scene.json is absent.
function extractSceneFromPrompt(promptPath: string | null): string | null {
  if (!promptPath) {
    return null;
  }
  let body: string;
  try {
    body = fs.readFileSync(promptPath, "utf8");
  } catch {
    return null;
  }
  const m = body.match(/Scene:\s*([\s\S]+?)(?:\n\s*AVOID:|\n\s*$)/i);
  if (!m) {
    return null;
  }
  return m[1].trim().replace(/\s+/g, " ");
}

function deriveProposedFilename(
  record: Omit<CaseRecord, "proposedFilename">,
  fallbackCaption: string | null,
  fallbackCluster: string | null,
  fallbackRisk: string | null,
): string {
  const id = record.basename;
  const ext = record.imagePath ? path.extname(record.imagePath).replace(/^\./, "") : "jpeg";
  // Use FULL caption, not snippet — snippet was truncated at 220 chars and
  // clipped "Emphasis on cleavage" to "cleava" on ref3-23.
  const caption = record.captionFull ?? fallbackCaption ?? "";
  const rawCluster = record.sceneCluster ?? fallbackCluster ?? null;
  const cluster = rawCluster ? sanitizeToken(rawCluster) : null;

  let emphasis: string | null = null;
  for (const re of EMPHASIS_PATTERNS) {
    const m = caption.match(re);
    if (m && m[1]) {
      emphasis = sanitizeToken(m[1]);
      break;
    }
  }

  const tokens: string[] = [];
  const seen = new Set<string>();
  const push = (tok: string | null) => {
    if (!tok) {
      return;
    }
    if (seen.has(tok)) {
      return;
    }
    seen.add(tok);
    tokens.push(tok);
  };

  push(cluster);
  push(emphasis);
  for (const [re, tok] of SETTING_VOCAB) {
    if (tokens.length >= 4) {
      break;
    }
    if (re.test(caption)) {
      push(tok);
    }
  }

  const parts = tokens.length > 0 ? tokens : [fallbackRisk ? sanitizeToken(fallbackRisk) : "scene"];
  return `${parts.join("-")}-${id}.${ext}`;
}

const TEXT_OVERLAY_PATTERNS = [
  /\btitle\s+(?:on\s+(?:top|image)|overlay|card|text|references?|reads)\b/i,
  /\bsubtitle\s+reads\b/i,
  /\bheading\s+(?:reads|on|at)\b/i,
  /\bheader\s+(?:at|on|reads)\b/i,
  /\bcaption\s+(?:at|in|on|overlay|across|reads)\b/i,
  /\btext\s+(?:overlay|on\s+image|in\s+corner|at\s+top|at\s+bottom|reads)\b/i,
  /\blabel\s+reads\b/i,
  /\badd\s+(?:a\s+)?(?:title|caption|header|text|subtitle)\b/i,
  /\b(?:write|render)\s+(?:the\s+)?(?:title|caption|text|words|words?\s+reading)\b/i,
  /\bwords?\s+reading\s+['"“]/i,
  /今日穿搭.{0,10}(?:header|top|标题|字)/i,
  /分享.{0,10}(?:title|header|标题|在顶|顶部)/i,
  /overlay\s+reads\b/i,
];

function hasTextOverlayInstruction(caption: string | null): boolean {
  if (!caption) {
    return false;
  }
  return TEXT_OVERLAY_PATTERNS.some((re) => re.test(caption));
}

function collectCases(src: Source): CaseRecord[] {
  const caseParent = src.caseRoot ? path.join(src.root, src.caseRoot) : src.root;
  if (!dirExists(caseParent)) {
    console.warn(`[warn] case parent missing: ${caseParent}`);
    return [];
  }
  const topEntries = fs
    .readdirSync(caseParent, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => src.caseDirGlob.test(e.name))
    .map((e) => e.name)
    .toSorted();

  // Recover case dirs accidentally nested one level deeper (user confirmed
  // ref3-15 was manually dropped into ref3-16/ — same pattern applies to any
  // other misplacement inside same-track sibling).
  const nestedRecoveries: { basename: string; caseDir: string }[] = [];
  for (const topName of topEntries) {
    const topDir = path.join(caseParent, topName);
    const nested = fs
      .readdirSync(topDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .filter((e) => src.caseDirGlob.test(e.name))
      .filter((e) => !topEntries.includes(e.name));
    for (const n of nested) {
      nestedRecoveries.push({
        basename: n.name,
        caseDir: path.join(topDir, n.name),
      });
    }
  }

  const entries = [
    ...topEntries.map((b) => ({ basename: b, caseDir: path.join(caseParent, b) })),
    ...nestedRecoveries,
  ].toSorted((a, b) => a.basename.localeCompare(b.basename));

  const out: CaseRecord[] = [];
  for (const { basename, caseDir } of entries) {
    const imagePath = firstExisting(caseDir, ["image.jpeg", "image.png", "image.jpg"]);
    const errorPath = firstExisting(caseDir, ["error.txt"]);
    const promptPath = firstExisting(caseDir, ["prompt.txt"]);
    const scenePath = firstExisting(caseDir, ["scene.json"]);
    const scene = scenePath ? safeReadJson<SceneJson>(scenePath) : null;

    const caption = scene?.caption ?? null;
    const captionSnippet = caption
      ? caption.length > 220
        ? `${caption.slice(0, 220)}…`
        : caption
      : null;

    const parentDir = path.basename(path.dirname(caseDir));
    const nestedRecoveredFromParent =
      parentDir !== src.caseRoot && parentDir !== basename ? parentDir : null;

    const partial: Omit<CaseRecord, "proposedFilename"> = {
      provider: src.provider,
      track: src.track,
      basename,
      sourceBatch: src.sourceBatch,
      passed: !!imagePath,
      promptPath,
      imagePath,
      errorPath,
      scenePath,
      sceneId: scene?.id ?? null,
      sceneRisk: scene?.risk ?? null,
      sceneCluster: scene?.cluster ?? null,
      captionFull: caption,
      captionSnippet,
      textOverlayFlag: hasTextOverlayInstruction(caption),
      nestedRecoveredFromParent,
    };
    // Defer proposedFilename computation until the second pass where we can
    // cross-lookup doubao siblings for gemini cases that lack scene.json.
    out.push({ ...partial, proposedFilename: "" });
  }
  return out;
}

function groupKey(r: CaseRecord): string {
  const trackPart = r.track ? `track-${r.track}` : "none";
  return `${r.provider}/${trackPart}/${r.sourceBatch}`;
}

interface GroupSummary {
  group: string;
  total: number;
  pass: number;
  fail: number;
  passRate: number;
  textOverlayPassCount: number;
}

function summarize(records: CaseRecord[]): GroupSummary[] {
  const byGroup = new Map<string, CaseRecord[]>();
  for (const r of records) {
    const k = groupKey(r);
    if (!byGroup.has(k)) {
      byGroup.set(k, []);
    }
    byGroup.get(k)!.push(r);
  }
  return Array.from(byGroup.entries())
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([group, rows]) => {
      const pass = rows.filter((r) => r.passed);
      const fail = rows.filter((r) => !r.passed);
      return {
        group,
        total: rows.length,
        pass: pass.length,
        fail: fail.length,
        passRate: rows.length > 0 ? +(pass.length / rows.length).toFixed(3) : 0,
        textOverlayPassCount: pass.filter((r) => r.textOverlayFlag).length,
      };
    });
}

// For doubao ref3: compare track-A vs track-B on same basename.
// Flags {A-fail + B-pass} pairs — XHS-ref unlock candidates.
function computeTrackCrossover(records: CaseRecord[]): Array<{
  basename: string;
  trackA: { passed: boolean; sourceBatch: string } | null;
  trackB: { passed: boolean; sourceBatch: string } | null;
  category:
    | "A-pass/B-pass"
    | "A-pass/B-fail"
    | "A-fail/B-pass"
    | "A-fail/B-fail"
    | "A-only"
    | "B-only";
}> {
  const doubao = records.filter((r) => r.provider === "doubao" && /ref3-\d+$/.test(r.basename));
  const byBasename = new Map<string, { A?: CaseRecord; B?: CaseRecord }>();
  for (const r of doubao) {
    if (!r.track) {
      continue;
    }
    const entry = byBasename.get(r.basename) ?? {};
    entry[r.track] = r;
    byBasename.set(r.basename, entry);
  }

  return Array.from(byBasename.entries())
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([basename, { A, B }]) => {
      let category:
        | "A-pass/B-pass"
        | "A-pass/B-fail"
        | "A-fail/B-pass"
        | "A-fail/B-fail"
        | "A-only"
        | "B-only";
      if (A && B) {
        if (A.passed && B.passed) {
          category = "A-pass/B-pass";
        } else if (A.passed && !B.passed) {
          category = "A-pass/B-fail";
        } else if (!A.passed && B.passed) {
          category = "A-fail/B-pass";
        } else {
          category = "A-fail/B-fail";
        }
      } else if (A) {
        category = "A-only";
      } else {
        category = "B-only";
      }

      return {
        basename,
        trackA: A ? { passed: A.passed, sourceBatch: A.sourceBatch } : null,
        trackB: B ? { passed: B.passed, sourceBatch: B.sourceBatch } : null,
        category,
      };
    });
}

function main() {
  const allRecords: CaseRecord[] = [];
  for (const src of SOURCES) {
    const records = collectCases(src);
    allRecords.push(...records);
  }

  // Build basename -> first doubao record with scene.json metadata.
  // Used to fill cluster/risk/caption for gemini siblings that don't have
  // their own scene.json. The scene content is shared between doubao and
  // gemini batches (verified against ref1-04 and ref3-01 diffs).
  const doubaoMeta = new Map<
    string,
    { caption: string | null; cluster: string | null; risk: string | null }
  >();
  for (const r of allRecords) {
    if (r.provider !== "doubao") {
      continue;
    }
    if (!r.sceneCluster && !r.captionFull) {
      continue;
    }
    if (doubaoMeta.has(r.basename)) {
      continue;
    }
    doubaoMeta.set(r.basename, {
      caption: r.captionFull,
      cluster: r.sceneCluster,
      risk: r.sceneRisk,
    });
  }

  // Resolve proposedFilename for every record with enriched fallbacks.
  for (const r of allRecords) {
    const sibling = doubaoMeta.get(r.basename);
    // Prefer sibling's FULL caption over snippet fallback. For gemini cases
    // we also try extracting the Scene: block from their own prompt.txt.
    const fallbackCaption =
      r.captionFull ?? sibling?.caption ?? extractSceneFromPrompt(r.promptPath);
    const fallbackCluster = r.sceneCluster ?? sibling?.cluster ?? null;
    const fallbackRisk = r.sceneRisk ?? sibling?.risk ?? null;
    r.proposedFilename = deriveProposedFilename(r, fallbackCaption, fallbackCluster, fallbackRisk);
  }

  const summary = summarize(allRecords);
  const crossover = computeTrackCrossover(allRecords);
  const crossoverCounts = crossover.reduce<Record<string, number>>((acc, c) => {
    acc[c.category] = (acc[c.category] ?? 0) + 1;
    return acc;
  }, {});

  const passCases = allRecords.filter((r) => r.passed);
  const failCases = allRecords.filter((r) => !r.passed);

  const outputPath = `${HOME}/tmp/single-pass-verified-plan.json`;
  const payload = {
    generated_at: new Date().toISOString(),
    provider_rule:
      "path-based: doubao-selfie-test/* -> doubao, safety-matrix/* -> gemini (extension is NOT a signal)",
    scope: SOURCES.map((s) => ({
      provider: s.provider,
      track: s.track,
      sourceBatch: s.sourceBatch,
      caseRoot: s.caseRoot,
      caseDirGlobSource: s.caseDirGlob.source,
    })),
    summary,
    crossover_counts: crossoverCounts,
    total_cases: allRecords.length,
    total_pass: passCases.length,
    total_fail: failCases.length,
    pass_cases: passCases,
    fail_cases: failCases,
    track_crossover: crossover,
  };

  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

  // Console summary for human review.
  console.log("\n=== AUDIT SUMMARY ===");
  console.log(
    `total cases: ${allRecords.length} (pass=${passCases.length}, fail=${failCases.length})`,
  );
  console.log(`\nper-group pass counts:`);
  for (const row of summary) {
    console.log(
      `  ${row.group}: ${row.pass}/${row.total} pass (${(row.passRate * 100).toFixed(1)}%)` +
        (row.textOverlayPassCount > 0
          ? `  [text-overlay pass flagged: ${row.textOverlayPassCount}]`
          : ""),
    );
  }

  console.log("\ndoubao ref3 track crossover (A vs B on same basename):");
  for (const [cat, n] of Object.entries(crossoverCounts)) {
    console.log(`  ${cat}: ${n}`);
  }

  const unlockCandidates = crossover.filter((c) => c.category === "A-fail/B-pass");
  if (unlockCandidates.length > 0) {
    console.log(`\nXHS-ref unlock candidates (A-fail / B-pass):`);
    for (const c of unlockCandidates) {
      console.log(`  ${c.basename}`);
    }
  }

  const textOverlayPass = passCases.filter((r) => r.textOverlayFlag);
  if (textOverlayPass.length > 0) {
    console.log(`\npass cases with text-overlay instructions (will be stripped in step 4):`);
    for (const r of textOverlayPass) {
      console.log(`  ${r.provider} track-${r.track ?? "none"} ${r.basename}`);
    }
  }

  console.log(`\nfull plan JSON -> ${outputPath}`);
}

main();
