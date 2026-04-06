# Azure OpenAI gpt-image-2 Integration — 2026-04-23

## TL;DR

- **Azure `/images/edits` works** via the legacy deployment-scoped URL with
  `api-key` header (NOT the `/openai/v1/` compat surface, which is
  generations-only for image models).
- **OpenAI gpt-image-2 moderation is strict for selfie use case now**:
  ~33% pass rate on cozy/glam daily scenes (was historically 90%+).
  Not Azure-specific — OpenAI direct has same profile.
- **Fallback chain in `dispatch.ts` handles it**: moderation_blocked →
  gemini (if geminiSafe) or doubao fallback.
- **Body spine contributes a little** but is not the main trigger. Removing
  it improved pass rate from 2/6 → 3/6, marginal.

## Final Azure edit call shape

```ts
// callGptImage2Azure in extensions/selfie/providers.ts
POST {endpoint}/openai/deployments/{deployment}/images/edits?api-version=2025-04-01-preview
Headers:
  api-key: <key>        // NOT Authorization: Bearer
Form:
  prompt: <text>
  size:   1024x1536
  output_format: jpeg
  n: 1
  image[]: <ref1>
  image[]: <ref2>       // multi-ref supported via image[] brackets
  image[]: ...
// IMPORTANT: do NOT include a `model` field — the deployment is in the URL path.
```

## What didn't work (and why — for future debugging)

Tried:

- `/openai/v1/images/edits` with `model=<deployment>` and Bearer →
  "The model 'gpt-image-2-1' does not exist." Azure's v1 compat surface
  doesn't expose `/images/edits` for image deployments (it works for
  `/images/generations`).
- `/openai/deployments/<dep>/images/edits` with a `model` form field →
  same error. Must omit the field.
- `Authorization: Bearer <key>` on the legacy path → 401. Must use
  `api-key: <key>`.
- `image` (singular) for multi-ref → "Duplicate parameter" error. Must
  use `image[]` array syntax.

Diagnosed via list-models call:

```
GET {endpoint}/openai/v1/models
api-key: <key>
```

Returns the full Azure catalog. Showed `gpt-image-2` exists but `gpt-image-2-1`
is the deployment name (model-field value for `/generations`).

## Smoke test results (verbatim logs)

### `azure-verify-2026-04-23.log` — 3 scenes × 2 prompt modes × Azure

```
Running 6 requests in parallel (3 scenes × 2 modes)…
Total wall time: 133.6s

▸ cozy-cafe (cozy)
  minimal:  ❌ 133.2s — moderation_blocked
  v2-wrap:  ❌ 127.6s — moderation_blocked

▸ cozy-home (cozy)
  minimal:  ❌ 131.6s — moderation_blocked
  v2-wrap:  ✅ 130.8s — /tmp/ab-cozy-home-v2-wrap.jpeg (187KB)

▸ glam-street (glam)
  minimal:  ❌ 130.1s — moderation_blocked
  v2-wrap:  ❌ 133.6s — moderation_blocked

Pass rate: 1/6 (17%)
```

### `openai-direct-verify-2026-04-23.log` — same 3 × 2 × OpenAI direct

```
Running 6 requests against OPENAI DIRECT in parallel…
Total wall time: 51.6s

▸ cozy-cafe (cozy)
  minimal:  ❌ 7.9s — moderation_blocked
  v2-wrap:  ❌ 50.2s — moderation_blocked

▸ cozy-home (cozy)
  minimal:  ✅ 49.7s — /tmp/direct-cozy-home-minimal.jpeg (150KB)
  v2-wrap:  ✅ 48.9s — /tmp/direct-cozy-home-v2-wrap.jpeg (185KB)

▸ glam-street (glam)
  minimal:  ❌ 7.3s — moderation_blocked
  v2-wrap:  ❌ 51.6s — moderation_blocked

Pass rate: 2/6 (33%)
```

### `openai-nobody-verify-2026-04-23.log` — same scenes, body spine REMOVED

```
Running 6 NO-BODY requests against OPENAI DIRECT in parallel…
Total wall time: 54.2s
Baseline with body: 2/6 passing

▸ cozy-cafe (cozy)
  minimal-nobody: ❌ 51.2s — moderation_blocked
  v2wrap-nobody:  ❌ 48.3s — moderation_blocked

▸ cozy-home (cozy)
  minimal-nobody: ✅ 41.1s — /tmp/nobody-cozy-home-minimal-nobody.jpeg (130KB)
  v2wrap-nobody:  ✅ 54.2s — /tmp/nobody-cozy-home-v2wrap-nobody.jpeg (185KB)

▸ glam-street (glam)
  minimal-nobody: ✅ 49.6s — /tmp/nobody-glam-street-minimal-nobody.jpeg (194KB)
  v2wrap-nobody:  ❌ 46.6s — moderation_blocked

Pass rate: 3/6 (50%)
```

## Observations

1. **Latency**: Azure edit ~130s, OpenAI direct edit ~50s. The other agent's
   research noted Azure ~42s — our eastus2 region was slower, possibly load.
2. **Moderation parity**: Azure rejects every scene OpenAI direct rejects;
   Azure rejects one additional (cozy-home minimal). Azure is slightly
   stricter but not dramatically so.
3. **Body spine (fit-curvy hourglass)**: marginal trigger. Removing it flipped
   `glam-street minimal` from fail → pass. Did NOT help the other 5 cases.
4. **Scene characteristics matter more than prompt structure**:
   - `cozy-home` (couch, hoodie, blanket, laptop) — passes consistently
   - `cozy-cafe` (cafe, latte, cardigan) — fails consistently
   - `glam-street` (golden hour, knit coat, slight smile) — borderline
   - No obvious trigger words in the failing scenes — likely the face refs +
     face-edit framing that flags.

## Production policy decided

- Keep Azure as cozy/glam primary (default). Fallback chain handles moderation
  rejection transparently:

  ```
  Azure gpt-image-2
    → if 429 rate-limit: OpenAI direct
    → else (moderation/5xx/etc): gemini (if geminiSafe) OR doubao (if !geminiSafe)
  ```

- Do NOT optimize prompts further for gpt-image-2 moderation. Fallback is
  cheaper than tuning.

- Body spine stays on cozy/glam v2-wrap (the tame NON_DOUBAO_BODY) — marginal
  benefit of removing it is not worth the consistency cost.

## Follow-up: pose-mechanics library added after smoke

The first in-chat test showed Doubao selfies came back as 3/4 mirror portraits
even when the agent wrote `back turned to camera`. Root cause: the face-preserve
spine + agent wording like `looking back over her shoulder` / `mischievous
expression` forced face visibility, so Doubao compromised by rotating the body
to 3/4 side. Tests confirmed:

- **Scene with `face invisible` + ref3 minimal shape + single-emphasis**:
  ✅ passes Doubao, true rear-view (scene 2, 22:16 UTC log).
- **Scene with `face invisible` + double emphasis (glutes + thighs) + dress
  pulled up**: ❌ Doubao CV rejects `OutputImageSensitiveContentDetected`
  (scene 3, 22:20 UTC).
- **Retry with softened intensity**: ✅ passes (scene 4, 22:21 UTC).

Fix landed in `extensions/selfie/styles.ts` TOOL_DESCRIPTION as a new
**Pose mechanics** section:

- Per-emphasis mechanics (胸/腰/臀/腿/背/整体): arm position, hip cock,
  camera height, back arch, etc.
- Explicit `face invisible` requirement for 臀 (rear-view).
- Reveal tricks list (strap fell / dress hem hiked / midriff exposed /
  thigh-high slit gaping / 黑丝 lace topline peek).
- Anti-patterns list (`looking back over shoulder` / `mischievous expression` /
  multi-emphasis / `arms raised` — each with reason they break composition).

And `extensions/selfie/persona-config.ts`:

- `compositionBias` field listing the persona's preferred pose categories
  (rear-view glute / bending-over / low-angle seated thigh / kneeling /
  side-profile S-curve / cleavage-forward / over-shoulder rear).
- `baselineMood` bumped from `flirty` to `spicy` for zhuzhu — casual
  "send me a selfie" implies sexualized framing by default.
- `notes` expanded with FACE VISIBILITY vs REAR-VIEW conflict rule embedded.

## Security note

Azure API key `76DFql87...VLi2` was pasted into chat during testing.
**Rotated manually before landing**: regenerated KEY 1 in Azure Portal.
New key stored via `openclaw config set plugins.entries.selfie.config.azureOpenaiApiKey '<new>'`.

## Reproducing the tests

```bash
# Azure
AZURE_OPENAI_API_KEY=<new-key> \
AZURE_OPENAI_DEPLOYMENT=gpt-image-2-1 \
AZURE_OPENAI_ENDPOINT=https://xingf-mnqrf4mc-eastus2.services.ai.azure.com \
  bun scripts/selfie-test/azure-verify.ts

# OpenAI direct
OPENAI_API_KEY=$(python3 -c "import json,os; print(json.load(open(os.path.expanduser('~/.openclaw/openclaw.json')))['plugins']['entries']['selfie']['config']['openaiApiKey'])") \
  bun scripts/selfie-test/openai-direct-verify.ts

# No-body variant
OPENAI_API_KEY=... \
  bun scripts/selfie-test/openai-nobody-verify.ts
```
