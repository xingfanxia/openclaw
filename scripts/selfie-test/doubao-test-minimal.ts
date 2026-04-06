#!/usr/bin/env bun
/**
 * Minimal test: does Doubao Seedream accept a base64 data URI as `image`?
 * If yes, we can reuse local reference images without hosting them.
 *
 * Usage: bun scripts/selfie-test/doubao-test-minimal.ts
 */

import fs from "node:fs/promises";
import path from "node:path";

const ARK_KEY = process.env.ARK_API_KEY ?? "";
if (!ARK_KEY) {
  throw new Error("ARK_API_KEY env var is required. Export it before running this script.");
}
const ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const MODEL = "doubao-seedream-5-0-260128";

const REF_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "extensions",
  "selfie",
  "reference-images",
);

async function toDataUri(filepath: string): Promise<string> {
  const buf = await fs.readFile(filepath);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function main() {
  const refPath = path.join(REF_DIR, "mh_049.png");
  console.log(`[test] loading ref: ${refPath}`);
  const dataUri = await toDataUri(refPath);
  console.log(`[test] data URI length: ${dataUri.length}`);

  const body = {
    model: MODEL,
    prompt: "Generate a casual selfie of this person at home, cozy vibe",
    image: dataUri,
    sequential_image_generation: "disabled",
    response_format: "url",
    size: "2K",
    stream: false,
    watermark: false,
  };

  console.log(`[test] calling Doubao with base64 data URI...`);
  const t0 = Date.now();

  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ARK_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[test] status: ${resp.status} (${elapsed}s)`);

  const text = await resp.text();
  console.log(`[test] body: ${text.slice(0, 1000)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
