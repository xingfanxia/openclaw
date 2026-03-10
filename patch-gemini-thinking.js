#!/usr/bin/env node
// Runtime patch: set includeThoughts to false in all Google/Gemini providers
// to prevent thinking text from leaking to Telegram.
const { execSync } = require("child_process");
const fs = require("fs");

const files = execSync(
  'grep -rl "includeThoughts: true" /app/node_modules/@mariozechner/pi-ai/dist/providers/*.js 2>/dev/null || true',
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);

if (files.length === 0) {
  console.log("[patch] No files with includeThoughts: true found — may already be patched");
  process.exit(0);
}

let patched = 0;
for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const updated = content.replace(/includeThoughts:\s*true/g, "includeThoughts: false");
  if (updated !== content) {
    fs.writeFileSync(file, updated, "utf8");
    console.log(`[patch] Patched includeThoughts → false in ${file}`);
    patched++;
  }
}
console.log(`[patch] Gemini thinking leak fix: ${patched} file(s) patched`);
