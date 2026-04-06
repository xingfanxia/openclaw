// One-shot smoke test for Azure OpenAI gpt-image-2 integration.
//
// Validates 3 assumptions the selfie plugin makes about Azure:
//   1. /images/generations works (matches your original code sample)
//   2. /images/edits works (required by selfie — we need ref images)
//   3. Bearer auth is accepted (vs api-key header)
//
// Run with:
//   export AZURE_OPENAI_API_KEY=<key-from-azure-portal>
//   pnpm bun scripts/selfie-test/azure-smoke.ts
//
// Read Key1/Key2 from Azure Portal → your OpenAI resource → Keys and Endpoint.

import { Buffer } from "node:buffer";

const rawEndpoint = (
  process.env.AZURE_OPENAI_ENDPOINT ||
  process.env.AZURE_EXISTING_AIPROJECT_ENDPOINT ||
  "https://xingf-mnqrf4mc-eastus2.services.ai.azure.com"
).replace(/\/$/, "");

const apiKey = process.env.AZURE_OPENAI_API_KEY || "";
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-image-2-1";

if (!apiKey) {
  console.error("AZURE_OPENAI_API_KEY not set.\n  export AZURE_OPENAI_API_KEY=<key> && rerun");
  process.exit(1);
}

// Strip a trailing `/openai/v1` (classic endpoint form) so we can try
// multiple path bases independent of what the env var happens to include.
const base = rawEndpoint.replace(/\/openai\/v1$/i, "").replace(/\/openai$/i, "");

// URL candidates to try, ordered by likelihood:
//   1. OpenAI-SDK-compat path on v1 API (what `openai` SDK uses with Azure endpoint)
//   2. Direct /openai/ path (used by some Azure Cognitive Services resources)
//   3. /models/<deployment>/images/... (newer Azure AI Services unified routing)
//   4. Bare /images/... (minimal — likely fails but cheap to check)
const pathCandidates = (op: "generations" | "edits") => [
  { label: "openai/v1/images", url: `${base}/openai/v1/images/${op}` },
  { label: "openai/images", url: `${base}/openai/images/${op}` },
  { label: `models/${deployment}/images`, url: `${base}/models/${deployment}/images/${op}` },
  { label: "images (bare)", url: `${base}/images/${op}` },
];

console.log(`Base endpoint: ${base}`);
console.log(`Deployment:    ${deployment}`);
console.log(`Key length:    ${apiKey.length}`);
console.log("");

// 1x1 transparent PNG — smallest legal ref image for edits endpoint.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64",
);

async function tryRequest(
  label: string,
  url: string,
  init: RequestInit,
  authStyle: "bearer" | "api-key",
): Promise<void> {
  console.log(`── ${label} (auth: ${authStyle}) ──`);
  console.log(`POST ${url}`);
  let resp: Response;
  try {
    resp = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        ...(authStyle === "bearer" ? { Authorization: `Bearer ${apiKey}` } : { "api-key": apiKey }),
      },
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    console.log(`  network error: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  console.log(`  HTTP ${resp.status} ${resp.statusText}`);
  const text = await resp.text();
  if (!resp.ok) {
    console.log(`  body (first 500 chars): ${text.slice(0, 500)}`);
    return;
  }
  try {
    const json = JSON.parse(text) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const first = json.data?.[0];
    if (first?.b64_json) {
      console.log(`  OK — got b64_json image (${first.b64_json.length} chars base64)`);
    } else if (first?.url) {
      console.log(`  OK — got url: ${first.url.slice(0, 100)}...`);
    } else {
      console.log(`  response shape unexpected: ${text.slice(0, 300)}`);
    }
  } catch {
    console.log(`  non-json body (first 300 chars): ${text.slice(0, 300)}`);
  }
}

async function testGenerate(authStyle: "bearer" | "api-key", url: string, label: string) {
  await tryRequest(
    `generate @ ${label}`,
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: deployment,
        prompt: "A cute baby polar bear.",
        size: "1024x1024",
        n: 1,
      }),
    },
    authStyle,
  );
  console.log("");
}

async function testEdits(authStyle: "bearer" | "api-key", url: string, label: string) {
  const form = new FormData();
  form.set("model", deployment);
  form.set("prompt", "A cute baby polar bear, based on the reference.");
  form.set("size", "1024x1024");
  form.set("n", "1");
  form.append("image[]", new Blob([TINY_PNG], { type: "image/png" }), "ref.png");

  await tryRequest(`edits @ ${label}`, url, { method: "POST", body: form }, authStyle);
  console.log("");
}

void (async () => {
  console.log("=".repeat(60));
  console.log("PHASE 1: /images/generations (text-to-image, no refs)");
  console.log("=".repeat(60));
  console.log("");
  for (const auth of ["bearer", "api-key"] as const) {
    for (const cand of pathCandidates("generations")) {
      await testGenerate(auth, cand.url, cand.label);
    }
  }

  console.log("=".repeat(60));
  console.log("PHASE 2: /images/edits (with reference image)");
  console.log("=".repeat(60));
  console.log("");
  for (const auth of ["bearer", "api-key"] as const) {
    for (const cand of pathCandidates("edits")) {
      await testEdits(auth, cand.url, cand.label);
    }
  }

  console.log("Done. Look for `OK — got b64_json` or `OK — got url` lines.");
  console.log("Selfie plugin needs a working /images/edits route.");
})();
