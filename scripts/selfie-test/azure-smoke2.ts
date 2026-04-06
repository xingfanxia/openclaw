// Round 2: narrower test informed by round 1 findings.
//
// Round 1 confirmed:
//   - /openai/v1/images/edits route EXISTS on services.ai.azure.com (got 400)
//   - Auth accepted either style (Bearer or api-key)
//   - Model name "gpt-image-2-1" rejected as "does not exist"
//
// Round 2 tests:
//   A. Classic Azure REST path: /openai/deployments/{deployment}/images/edits?api-version=...
//      (canonical Azure OpenAI deployment routing — different from v1 compat path)
//   B. v1 path with alternate model name values
//   C. Also try openai.azure.com domain vs services.ai.azure.com
//
// Goal: find at least one (url, auth, model) combination that returns a real image.

import { Buffer } from "node:buffer";

const apiKey = process.env.AZURE_OPENAI_API_KEY || "";
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-image-2-1";

if (!apiKey) {
  console.error("AZURE_OPENAI_API_KEY not set");
  process.exit(1);
}

const bases = [
  "https://xingf-mnqrf4mc-eastus2.services.ai.azure.com",
  "https://xingf-mnqrf4mc-eastus2.openai.azure.com",
];

// api-version values used by Azure gpt-image-1 / similar image models.
const apiVersions = ["2025-04-01-preview", "2025-03-01-preview", "2024-10-21"];

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64",
);

async function tryEdits(
  label: string,
  url: string,
  modelField: string,
  auth: "bearer" | "api-key",
): Promise<void> {
  const form = new FormData();
  form.set("model", modelField);
  form.set("prompt", "A cute baby polar bear, based on the reference.");
  form.set("size", "1024x1024");
  form.set("n", "1");
  form.append("image[]", new Blob([TINY_PNG], { type: "image/png" }), "ref.png");

  console.log(`── ${label} ──`);
  console.log(`POST ${url}`);
  console.log(`  model="${modelField}" auth=${auth}`);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: auth === "bearer" ? { Authorization: `Bearer ${apiKey}` } : { "api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    console.log(`  net err: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const text = await resp.text();
  console.log(`  HTTP ${resp.status}`);
  if (!resp.ok) {
    // Extract just the error message for brevity
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      console.log(`  err: ${j.error?.message ?? text.slice(0, 200)}`);
    } catch {
      console.log(`  body: ${text.slice(0, 200)}`);
    }
    return;
  }
  try {
    const j = JSON.parse(text) as { data?: Array<{ b64_json?: string; url?: string }> };
    const first = j.data?.[0];
    if (first?.b64_json || first?.url) {
      console.log(`  ✅ OK — got image`);
    } else {
      console.log(`  response shape: ${text.slice(0, 200)}`);
    }
  } catch {
    console.log(`  non-json: ${text.slice(0, 200)}`);
  }
}

void (async () => {
  // === Phase A: Classic Azure deployment path ===
  console.log("=".repeat(60));
  console.log("PHASE A: Classic Azure /openai/deployments/{dep} path");
  console.log("=".repeat(60));
  for (const base of bases) {
    for (const apiVer of apiVersions) {
      const url = `${base}/openai/deployments/${deployment}/images/edits?api-version=${apiVer}`;
      // Classic Azure typically uses api-key header, but try both.
      for (const auth of ["api-key", "bearer"] as const) {
        const label = `${base.replace("https://", "").split(".")[0]}… api-version=${apiVer} ${auth}`;
        await tryEdits(label, url, deployment, auth);
      }
    }
  }

  // === Phase B: v1 OpenAI-compat path with different model values ===
  console.log("");
  console.log("=".repeat(60));
  console.log("PHASE B: /openai/v1/images/edits with different model field values");
  console.log("=".repeat(60));
  const v1Url = `${bases[0]}/openai/v1/images/edits`;
  for (const model of ["gpt-image-1", "gpt-image-2", deployment, `deployments/${deployment}`]) {
    await tryEdits(`v1 model="${model}" bearer`, v1Url, model, "bearer");
  }

  console.log("");
  console.log("Done. Look for `✅ OK — got image` lines.");
})();
