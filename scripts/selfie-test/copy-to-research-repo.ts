/**
 * Copy pass + fail cases from /home/xingfanxia/tmp/single-pass-verified-plan.json
 * into the zhuzhu-selfie-research repo under a flat, provider-separated layout:
 *
 *   references/single-pass-verified/
 *     doubao-track-a/{images,prompts,errors}/
 *     doubao-track-b/{images,prompts,errors}/
 *     gemini/{images,prompts,errors}/
 *     README.md
 *
 * Per-bucket index.csv captures the full mapping from derived filename back
 * to original basename, source_batch, scene metadata, pass/fail, rescue
 * flags, etc. Errors (for fail cases) are copied to errors/<basename>.txt
 * and summarized in csv.
 *
 * Safe to rerun — it clears the single-pass-verified/ dir first. Does not
 * touch anything else under references/.
 *
 * Usage: bun scripts/selfie-test/copy-to-research-repo.ts
 *        bun scripts/selfie-test/copy-to-research-repo.ts --dry-run
 */

import * as fs from "node:fs";
import * as path from "node:path";

const PLAN_PATH = "/home/xingfanxia/tmp/single-pass-verified-plan.json";
const RESEARCH_ROOT = "/home/x_computelabs_ai/projects/zhuzhu-selfie-research";
const DEST_ROOT = path.join(RESEARCH_ROOT, "references", "single-pass-verified");

const DRY_RUN = process.argv.includes("--dry-run");

interface CaseRecord {
  provider: "doubao" | "gemini";
  track: "A" | "B" | null;
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

interface Plan {
  generated_at: string;
  pass_cases: CaseRecord[];
  fail_cases: CaseRecord[];
}

function bucketOf(r: CaseRecord): "doubao-track-a" | "doubao-track-b" | "gemini" {
  if (r.provider === "gemini") {
    return "gemini";
  }
  if (r.track === "A") {
    return "doubao-track-a";
  }
  if (r.track === "B") {
    return "doubao-track-b";
  }
  throw new Error(`unexpected record: ${JSON.stringify(r)}`);
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(0, dot) : name;
}

function csvEscape(s: string | null | undefined): string {
  if (s === null || s === undefined) {
    return "";
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rmrf(dir: string) {
  if (!fs.existsSync(dir)) {
    return;
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFileSafe(src: string | null, dst: string, dryRun: boolean): boolean {
  if (!src || !fs.existsSync(src)) {
    return false;
  }
  if (dryRun) {
    return true;
  }
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  return true;
}

function writeFileSafe(dst: string, content: string, dryRun: boolean) {
  if (dryRun) {
    return;
  }
  ensureDir(path.dirname(dst));
  fs.writeFileSync(dst, content);
}

const CSV_HEADERS = [
  "filename",
  "original_basename",
  "source_batch",
  "provider",
  "track",
  "scene_id",
  "cluster",
  "risk",
  "passed",
  "text_overlay_flag",
  "nested_recovered_from_parent",
  "error_summary",
  "caption_full",
];

function readErrorSummary(errorPath: string | null): string {
  if (!errorPath || !fs.existsSync(errorPath)) {
    return "";
  }
  try {
    const body = fs.readFileSync(errorPath, "utf8");
    // Tighten whitespace, cap to 300 chars for csv readability.
    return body.replace(/\s+/g, " ").slice(0, 300);
  } catch {
    return "";
  }
}

function writeReadme(
  destRoot: string,
  counts: Record<string, { pass: number; fail: number }>,
  dryRun: boolean,
) {
  const lines = [
    "# single-pass-verified",
    "",
    "Pass + fail cases from 5 source batches, copied from `/home/xingfanxia/tmp/`",
    "per the 2026-04-23 handoff scope. Provider is path-based (doubao-selfie-test/",
    "vs safety-matrix/), never from file extension.",
    "",
    "## Layout",
    "",
    "```",
    "doubao-track-a/   # face-ref-only, both ref1/ref2/ref3 scene sets",
    "doubao-track-b/   # face + XHS post screenshot ref, ref3 set only",
    "gemini/           # BLOCK_NONE config on gemini-3.1-flash-image-preview",
    "  images/<name>.jpeg    pass case image",
    "  prompts/<name>.txt    original prompt (pass AND fail)",
    "  errors/<name>.txt     fail case error message (fail only)",
    "  index.csv             filename -> original_basename + scene metadata",
    "```",
    "",
    "## Filename derivation",
    "",
    "Deterministic text-only slug from scene.json.caption (or prompt.txt Scene block for",
    "gemini-only cases): `<cluster>-<emphasis>-<up-to-2-setting-tokens>-<origId>.<ext>`.",
    "No subagent visual inspection. Original basename preserved in csv.",
    "",
    "## Counts",
    "",
  ];
  for (const [bucket, c] of Object.entries(counts)) {
    lines.push(`- **${bucket}**: ${c.pass} pass, ${c.fail} fail`);
  }
  lines.push("", "## Source batches", "");
  lines.push(
    "- `doubao-selfie-test/ref3-2026-04-22T12-42-37/` — ref3 set, 29 captions × track-A + track-B",
  );
  lines.push(
    "- `doubao-selfie-test/ref12-2026-04-22T13-43-26/` — ref1 + ref2 combined, 40 captions × track-A only",
  );
  lines.push(
    "- `safety-matrix/ref12-2026-04-22T13-43-16/gemini-none/` — ref1 + ref2 on gemini BLOCK_NONE",
  );
  lines.push(
    "- `safety-matrix/run-2026-04-22T12-53-41/gemini-none/` — ref3 set on gemini BLOCK_NONE",
  );
  lines.push("");
  lines.push("## Next steps (per handoff)", "");
  lines.push("- **Step 4a**: strict repro on pass cases × N=5, output `stability-buckets.csv`");
  lines.push(
    "- **Step 4b**: plugin v2 wrap rescue on unstable pass + 29 fail cases × N=5, output `fail-rescue-buckets.csv`",
  );
  lines.push("- **Step 5**: front-cam physics rewrite on stable cases");
  lines.push("- **Step 6**: extreme scene stress test");
  writeFileSafe(path.join(destRoot, "README.md"), lines.join("\n") + "\n", dryRun);
}

function extractSceneFromPrompt(promptPath: string | null): string | null {
  if (!promptPath || !fs.existsSync(promptPath)) {
    return null;
  }
  try {
    const body = fs.readFileSync(promptPath, "utf8");
    const m = body.match(/Scene:\s*([\s\S]+?)(?:\n\s*AVOID:|\n\s*$)/i);
    if (!m) {
      return null;
    }
    return m[1].trim().replace(/\s+/g, " ");
  } catch {
    return null;
  }
}

// For gemini cases (no scene.json), fill caption/cluster/risk from the
// doubao sibling case with the same basename. This is safe because the
// batches share scene definitions (verified against ref1-04 + ref3-01
// prompt diffs — identical content).
function buildSiblingMap(
  all: CaseRecord[],
): Map<string, { caption: string | null; cluster: string | null; risk: string | null }> {
  const m = new Map<
    string,
    { caption: string | null; cluster: string | null; risk: string | null }
  >();
  for (const r of all) {
    if (r.provider !== "doubao") {
      continue;
    }
    if (!r.captionFull && !r.sceneCluster) {
      continue;
    }
    if (m.has(r.basename)) {
      continue;
    }
    m.set(r.basename, {
      caption: r.captionFull,
      cluster: r.sceneCluster,
      risk: r.sceneRisk,
    });
  }
  return m;
}

function main() {
  const plan: Plan = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
  const all: CaseRecord[] = [...plan.pass_cases, ...plan.fail_cases];
  const siblingMap = buildSiblingMap(all);

  if (!DRY_RUN) {
    console.log(`[clear] removing ${DEST_ROOT} if it exists`);
    rmrf(DEST_ROOT);
  }

  const byBucket = new Map<string, CaseRecord[]>();
  for (const r of all) {
    const b = bucketOf(r);
    if (!byBucket.has(b)) {
      byBucket.set(b, []);
    }
    byBucket.get(b)!.push(r);
  }

  const counts: Record<string, { pass: number; fail: number }> = {};
  let totalImages = 0;
  let totalPrompts = 0;
  let totalErrors = 0;

  for (const [bucket, rows] of byBucket.entries()) {
    const bucketDir = path.join(DEST_ROOT, bucket);
    const imagesDir = path.join(bucketDir, "images");
    const promptsDir = path.join(bucketDir, "prompts");
    const errorsDir = path.join(bucketDir, "errors");

    const csvLines: string[] = [CSV_HEADERS.join(",")];
    let pass = 0;
    let fail = 0;

    rows.sort((a, b) => a.proposedFilename.localeCompare(b.proposedFilename));

    for (const r of rows) {
      const filename = r.proposedFilename; // e.g. "gym-cleavage-...-ref3-03.jpeg"
      const stem = stripExt(filename);

      // Copy image (pass only).
      if (r.passed && r.imagePath) {
        const imgDst = path.join(imagesDir, filename);
        if (copyFileSafe(r.imagePath, imgDst, DRY_RUN)) {
          totalImages++;
        }
      }

      // Copy prompt (all cases — prompt.txt exists for fails too).
      if (r.promptPath) {
        const promptDst = path.join(promptsDir, `${stem}.txt`);
        if (copyFileSafe(r.promptPath, promptDst, DRY_RUN)) {
          totalPrompts++;
        }
      }

      // Copy error (fail only).
      let errorSummary = "";
      if (!r.passed && r.errorPath) {
        const errDst = path.join(errorsDir, `${stem}.txt`);
        if (copyFileSafe(r.errorPath, errDst, DRY_RUN)) {
          totalErrors++;
        }
        errorSummary = readErrorSummary(r.errorPath);
      }

      if (r.passed) {
        pass++;
      } else {
        fail++;
      }

      const sibling = siblingMap.get(r.basename);
      const effCluster = r.sceneCluster ?? sibling?.cluster ?? "";
      const effRisk = r.sceneRisk ?? sibling?.risk ?? "";
      const effCaption =
        r.captionFull ?? sibling?.caption ?? extractSceneFromPrompt(r.promptPath) ?? "";

      csvLines.push(
        [
          csvEscape(filename),
          csvEscape(r.basename),
          csvEscape(r.sourceBatch),
          csvEscape(r.provider),
          csvEscape(r.track ?? ""),
          csvEscape(r.sceneId ?? ""),
          csvEscape(effCluster),
          csvEscape(effRisk),
          r.passed ? "true" : "false",
          r.textOverlayFlag ? "true" : "false",
          csvEscape(r.nestedRecoveredFromParent ?? ""),
          csvEscape(errorSummary),
          csvEscape(effCaption),
        ].join(","),
      );
    }

    writeFileSafe(path.join(bucketDir, "index.csv"), csvLines.join("\n") + "\n", DRY_RUN);
    counts[bucket] = { pass, fail };
    console.log(
      `[bucket] ${bucket}: ${pass} pass / ${fail} fail (csv ${csvLines.length - 1} rows)`,
    );
  }

  writeReadme(DEST_ROOT, counts, DRY_RUN);

  console.log(`\n=== copy summary${DRY_RUN ? " (DRY RUN)" : ""} ===`);
  console.log(`images copied: ${totalImages}`);
  console.log(`prompts copied: ${totalPrompts}`);
  console.log(`errors copied: ${totalErrors}`);
  console.log(`destination: ${DEST_ROOT}`);
}

main();
