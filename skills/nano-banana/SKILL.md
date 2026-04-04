---
name: nano-banana
description: Generate or edit images via Nano Banana Pro (Gemini 3 Pro Image) or Nano Banana 2 (Gemini 3.1 Flash Image).
homepage: https://ai.google.dev/
metadata:
  {
    "openclaw":
      {
        "emoji": "🍌",
        "requires": { "bins": ["uv"], "env": ["GEMINI_API_KEY"] },
        "primaryEnv": "GEMINI_API_KEY",
        "install":
          [
            {
              "id": "uv-brew",
              "kind": "brew",
              "formula": "uv",
              "bins": ["uv"],
              "label": "Install uv (brew)",
            },
          ],
      },
  }
---

# Nano Banana Pro / Nano Banana 2

Use the bundled script to generate or edit images with either model.

Generate

```bash
uv run {baseDir}/scripts/generate_image.py --prompt "your image description" --filename "output.png" --resolution 1K
```

```bash
uv run {baseDir}/scripts/generate_image.py --prompt "your image description" --filename "output.png" --model pro
```

Edit (single image)

```bash
uv run {baseDir}/scripts/generate_image.py --prompt "edit instructions" --filename "output.png" --model pro -i "/path/in.png" --resolution 2K
```

Multi-image composition (up to 14 images)

```bash
uv run {baseDir}/scripts/generate_image.py --prompt "combine these into one scene" --filename "output.png" -i img1.png -i img2.png -i img3.png
```

A/B test (generates with both models, saves `-pro` and `-nb2` variants)

```bash
uv run {baseDir}/scripts/generate_image.py --prompt "your image description" --filename "output.png" --ab-test
```

Models

| Flag            | Name            | Gemini model ID                  | Notes                                   |
| --------------- | --------------- | -------------------------------- | --------------------------------------- |
| `pro`           | Nano Banana Pro | `gemini-3-pro-image-preview`     | Highest quality, more expensive         |
| `nb2` (default) | Nano Banana 2   | `gemini-3.1-flash-image-preview` | Same quality, Flash speed, ~40% cheaper |

API key

- `GEMINI_API_KEY` env var
- Or set `skills."nano-banana".apiKey` / `skills."nano-banana".env.GEMINI_API_KEY` in `~/.openclaw/openclaw.json`

Notes

- Resolutions: `1K` (default), `2K`, `4K`.
- Use timestamps in filenames: `yyyy-mm-dd-hh-mm-ss-name.png`.
- The script prints a `MEDIA:` line for OpenClaw to auto-attach on supported chat providers.
- Do not read the image back; report the saved path only.
