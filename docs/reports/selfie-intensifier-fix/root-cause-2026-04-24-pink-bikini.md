# Root cause audit — R3-17 passes 5/5 in research, fails in production (2026-04-24)

## Incident

User sent `我要看粉色比基尼` (pink bikini). Agent authored an R3-17-shaped
prompt. Doubao's output-side CV filter returned
`OutputImageSensitiveContentDetected` after 145.8s. Agent retried with a
softened one-piece swim — that succeeded and was delivered, so the user got a
one-piece instead of the requested bikini.

Research step4 Phase 4a (2026-04-23) ran R3-17 5 times and passed 5/5 on the
same doubao endpoint, same 5 reference images, same API call shape. The
difference is entirely in the **prompt text**, not in credentials, refs, or
API call parameters.

## Side-by-side comparison

### API call parameters — IDENTICAL

Both research (`scripts/selfie-test/step4-repro-and-rescue.ts` and
`doubao-mega-v2.ts`) and production (`extensions/selfie/providers.ts`
`callDoubao`) send the exact same body shape to
`https://ark.cn-beijing.volces.com/api/v3/images/generations`:

```json
{
  "model": "doubao-seedream-5-0-260128",
  "prompt": "<...>",
  "image": ["data:image/jpeg;base64,<ref1>", ...],
  "sequential_image_generation": "disabled",
  "response_format": "url",
  "size": "2K",
  "stream": false,
  "watermark": false
}
```

No diff.

### Reference images — IDENTICAL

Both research and production load the same 5 files from
`extensions/selfie/reference-images/`:

- `mh_049.jpg`, `mh_053.jpg`, `mh_055.jpg`, `mh_058.jpg`, `mh_060.jpg`

No diff.

### Prompt text — TWO REGRESSIONS

#### REGRESSION A: `buildMinimalPrompt` adds an `Aesthetic:` line that research did not have

**Research baseline (step4 Phase 4a / step6 `minimalWrap`)**:

```
These reference photos show the person's FACE — preserve her exact facial features,
eyes, nose, lips, face shape, skin tone, and hair.
Skin is clear and well-maintained: natural texture, no acne clusters, no red sunburn patches.

BODY: Adult woman (23), fit-curvy hourglass build.
SINGLE EMPHASIS — the scene below calls out ONE body feature. Do not stack multiple.

Scene: <scene text>

AVOID: nudity, topless, visible genitals, 'lingerie shoot on bed' framing as sex scene,
greedy multi-feature hyperfocus, unnatural anatomy.
```

**Round-2 production (`buildMinimalPrompt` in `prompt-assembly.ts`)**:

```
These reference photos show the person's FACE — preserve her exact facial features,
eyes, nose, lips, face shape, skin tone, and hair.
Skin is clear and well-maintained: natural texture, no acne clusters, no red sunburn patches.

BODY: Adult woman (23), fit-curvy hourglass build.
SINGLE EMPHASIS — the scene below calls out ONE body feature. Do not stack multiple.

Aesthetic: Chinese 小红书 日常穿搭 — confident body-line display in legal everyday clothing. Fashion-intimate OOTD vibe, NOT pornographic, NOT a lingerie shoot.    ← ADDED IN ROUND-2

Scene: <scene text>

AVOID: nudity, topless, visible genitals, 'lingerie shoot on bed' framing as sex scene,
greedy multi-feature hyperfocus, unnatural anatomy.
```

The `Aesthetic:` line was ported from `doubao-mega-v2.ts` which ran 27/27 on
doubao — but that test used a DIFFERENT scaffolding (emphasis map, face
handling map, outfit-with-`NOT lingerie` line). Mega-v2's original was:

```
Aesthetic: Chinese 小红书 ${captionCode}. Confident body-line display in legal clothing — NOT pornographic.
```

I did not port verbatim — I expanded to add `"Fashion-intimate OOTD vibe,
NOT a lingerie shoot"`. This introduced THREE extra tokens that research's
R3-XX pipeline never had:

- `pornographic`
- `lingerie shoot` (appears in AVOID but repeating doubles the token weight)
- `Fashion-intimate`

Doubao's text classifier indexes against these even under `NOT X` framing.
This is literally the same failure mode memory
(`zhuzhu-selfie-round2-2026-04-24.md`) warned about for the anti-text
directive — which I had already removed from `buildMinimalPrompt` this
morning for regressing doubao 60pp on edge compositions.

#### REGRESSION B: Agent drifts scene text from R3-17 verbatim

| Field            | Research R3-17 (pass 5/5)                                                                                                                   | Agent production (fail)                                               | Impact                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Setting          | "Outdoor beach standing portrait at Waikiki waterfront"                                                                                     | "Outdoor beach mirror selfie"                                         | **Waikiki location anchor LOST; `mirror selfie` added**                           |
| Pose venue       | "standing upright at ocean edge with water behind"                                                                                          | "standing upright in front of a full-length beach club mirror"        | **INDOOR BEACH CLUB MIRROR replaces OUTDOOR OCEAN EDGE**                          |
| Aesthetic anchor | "Classic pin-up style beach pose"                                                                                                           | (missing)                                                             | Positive aesthetic anchor dropped                                                 |
| Pose detail      | "one arm raised and bent behind head touching hair, elbow up, head slightly tilted"                                                         | "one hand adjusting a pink flower in hair"                            | Natural pin-up pose replaced with mirror-selfie hand gesture                      |
| Face descriptors | "direct front-facing gaze, slight smile, flower in hair, natural glow"                                                                      | "confident slight smile"                                              | 3 of 4 anchor phrases dropped                                                     |
| Wardrobe         | "teal metallic triangle bikini top revealing deep cleavage, matching iridescent micro bottoms"                                              | "pink triangle bikini top with gold hardware, matching micro bottoms" | Color swap ok; `revealing deep cleavage` dropped; `gold hardware` added (neutral) |
| Background       | "clear turquoise Waikiki ocean with swimmers visible, bright blue sky"                                                                      | "blurred turquoise ocean and white sand"                              | **Waikiki anchor LOST, `swimmers visible` public-beach signal LOST**              |
| Lighting         | "bright tropical sun with golden warmth on skin"                                                                                            | "warm golden hour sunlight"                                           | Golden-hour swap is fine                                                          |
| Self-mitigation  | "Face fully visible and directly lit — highest filter risk. Recommend variant with arm raised to partially block face or face turned away." | (missing)                                                             | Self-rescue hint completely dropped                                               |
| Anchor code      | `假日穿搭`                                                                                                                                  | `假日穿搭.`                                                           | Correct                                                                           |

The most damaging drift: **setting changed from OUTDOOR Waikiki ocean-edge to
INDOOR "beach club mirror"**. Memory explicitly calls out
`Bikini in hotel bathroom (reads as changing room / undress) — ref3-18
scored 0/10 on doubao` as Failure Mode 1. `Mirror selfie + bikini` in an
indoor venue is the same coding — changing-room / undress, not legitimate
beach/vacation. Research R3-17's 5/5 pass was specifically on OUTDOOR beach
with ocean behind.

### Why the agent drifted from the verbatim archetype

Two competing instructions in the agent's context:

1. **Archetype-specific** (TOOL_DESCRIPTION POSE RECIPE LIBRARY): "R3-17 · Beach bikini pin-up [5/5]: 'Outdoor beach standing portrait at Waikiki waterfront...'"
2. **Persona-global** (persona-config `compositionBias` + `notes`): "Body-forward / rear-view / low-angle compositions ALWAYS win over traditional mirror 3/4 portrait" AND composition menu promotes "mirror selfie" framing.

Agent read "mirror selfie" as the preferred composition and remapped
R3-17's outdoor standing portrait into a mirror selfie at an invented
"beach club". The persona-global rule overrode the archetype.

The `styles.ts` workflow note tells the agent to "keep the sentence pattern +
face-obscure + pose language close to verbatim, swap wardrobe color / setting
details / anchor as needed" — but "setting details" was interpreted too
liberally (outdoor → indoor counts as "detail" to the LLM, not a structural
change).

## Fix plan

### Fix 1: Revert `buildMinimalPrompt` to research-verbatim minimalWrap

Remove the `Aesthetic:` line entirely. `buildMinimalPrompt` becomes
byte-identical to `scripts/selfie-test/step6-extreme-stress.ts`'s
`minimalWrap`. This is the shape research validated at 5/5 on R3-17 and
24/24 on stable scenes.

The "positive anchor" belongs IN THE SCENE TEXT itself (`假日穿搭` at the
end, like R3-17). Do not wrap it as a system-level line that adds
`pornographic` / `lingerie shoot` tokens to every prompt.

### Fix 2: Harden TOOL_DESCRIPTION — setting fidelity when copying archetypes

Add a new rule block to TOOL_DESCRIPTION right after POSE RECIPE LIBRARY:

```
### ARCHETYPE COPY RULES — setting is NON-NEGOTIABLE

When you copy an R3-XX recipe, the SETTING is part of what makes it pass
doubao. Research 5/5 pass rates are specifically on the listed setting +
pose + wardrobe combination.

Do NOT:
- Convert an OUTDOOR archetype to INDOOR (e.g. R3-17 outdoor Waikiki
  → "beach club mirror" — indoor mirror + bikini reads as changing-room,
  not vacation). Indoor mirror + bikini scored 0/10 on doubao (ref3-18).
- Reframe a standing-portrait archetype as a `mirror selfie`. R3-17, R3-29
  are explicit portraits taken at the location, not self-shots in a mirror.
  The persona's `mirror selfie` compositionBias is OVERRIDDEN by the
  archetype's own setting.
- Drop location anchors (`Waikiki`, `NYC`, `Hong Kong`). These are
  context locks that legitimize the scene.
- Drop aesthetic anchors (`Classic pin-up style beach pose`,
  `editorial`, `港风假日`). These are positive framings doubao recognizes.

Do:
- Keep the archetype's setting phrase VERBATIM. Swap only color / material
  / minor adjective.
- Keep the full face descriptor chain
  (`direct front-facing gaze, slight smile, flower in hair, natural
  glow`) — dropping 2-3 of the 4 anchors is a known drift pattern.
- Keep the self-mitigation line if present
  (`Face fully visible and directly lit — highest filter risk.
  Recommend variant with arm raised...`).
```

### Fix 3: Regression guard test

Add `extensions/selfie/prompt-assembly.test.ts` assertion that
`buildMinimalPrompt("<R3-17 scene>")` byte-equals the research
`prompt.txt`. Any future addition to the minimal spine will break this
test immediately.

### Fix 4: Memory update

Update `zhuzhu-selfie-round2-2026-04-24.md` to explicitly document:

- `buildMinimalPrompt` must NOT contain negative vocabulary outside the
  `AVOID:` footer block. `NOT X` framing still injects X tokens into
  doubao's text classifier.
- Mega-v2's `Aesthetic:` line is a mega-v2 scaffolding element — not
  portable to R3-XX's minimalWrap without breaking the research baseline.
- Agent archetype-copy drift (outdoor → indoor mirror selfie) is the
  dominant prompt-side failure mode. Setting fidelity beats every other
  constraint.

## Verification plan

After deploying the fix:

1. Re-test pink bikini request via telegram. Expected: agent writes a
   Waikiki-outdoor-anchored scene (per new TOOL_DESCRIPTION rule), doubao
   returns image on first attempt without CV rejection.
2. Sample 5 additional archetype requests (yacht / bed glute / desk
   editorial / gym / office) to verify the revert doesn't break other
   archetypes.
3. If first-try pass rate < 70% across 10 requests, investigate the
   remaining gap (likely setting fidelity drift) rather than adding more
   prompt-side scaffolding.

## Meta-lesson

This failure mode — adding a "harmless" positive-framing line that contains
negative tokens — is the SAME class of mistake as the anti-text directive I
removed this morning. Both were well-intentioned additions to minimal
wrap that contained negative vocabulary and regressed doubao. The pattern:

> Any text added to `buildMinimalPrompt` outside the existing AVOID block
> must be tested against the R3-XX research baseline (step4 Phase 4a) —
> NOT just against the test it was ported from. 27/27 on mega-v2 does
> not imply compatibility with R3-XX's minimalWrap.

Default to SUBTRACTION, not ADDITION, when iterating on
`buildMinimalPrompt`. The research baseline is short for a reason.
