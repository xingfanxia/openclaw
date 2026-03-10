#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "google-genai>=1.0.0",
#     "pillow>=10.0.0",
# ]
# ///
"""
Generate images using Google's Nano Banana APIs (Nano Banana Pro or Nano Banana 2).

Models:
    pro  — Nano Banana Pro  (gemini-3-pro-image-preview)   highest quality, more expensive
    nb2  — Nano Banana 2    (gemini-3.1-flash-image-preview) same quality, Flash speed, ~40% cheaper

Usage:
    uv run generate_image.py --prompt "your image description" --filename "output.png" [--model pro|nb2] [--resolution 1K|2K|4K] [--api-key KEY]

A/B test (runs both models, saves with -pro and -nb2 suffixes):
    uv run generate_image.py --prompt "your image description" --filename "output.png" --ab-test

Multi-image editing (up to 14 images):
    uv run generate_image.py --prompt "combine these images" --filename "output.png" -i img1.png -i img2.png -i img3.png
"""

import argparse
import os
import sys
from pathlib import Path

MODEL_MAP = {
    "pro": "gemini-3-pro-image-preview",
    "nb2": "gemini-3.1-flash-image-preview",
}

MODEL_LABELS = {
    "pro": "Nano Banana Pro",
    "nb2": "Nano Banana 2",
}


def get_api_key(provided_key: str | None) -> str | None:
    """Get API key from argument first, then environment."""
    if provided_key:
        return provided_key
    return os.environ.get("GEMINI_API_KEY")


def main():
    parser = argparse.ArgumentParser(
        description="Generate images using Nano Banana (Pro or 2)"
    )
    parser.add_argument(
        "--prompt", "-p",
        required=True,
        help="Image description/prompt"
    )
    parser.add_argument(
        "--filename", "-f",
        required=True,
        help="Output filename (e.g., sunset-mountains.png)"
    )
    parser.add_argument(
        "--model", "-m",
        choices=["pro", "nb2"],
        default="nb2",
        help="Model to use: pro = Nano Banana Pro (highest quality), nb2 = Nano Banana 2 (Flash speed, ~40%% cheaper)"
    )
    parser.add_argument(
        "--ab-test",
        action="store_true",
        help="Run generation with both models, saving with -pro and -nb2 suffixes"
    )
    parser.add_argument(
        "--input-image", "-i",
        action="append",
        dest="input_images",
        metavar="IMAGE",
        help="Input image path(s) for editing/composition. Can be specified multiple times (up to 14 images)."
    )
    parser.add_argument(
        "--resolution", "-r",
        choices=["1K", "2K", "4K"],
        default="1K",
        help="Output resolution: 1K (default), 2K, or 4K"
    )
    parser.add_argument(
        "--api-key", "-k",
        help="Gemini API key (overrides GEMINI_API_KEY env var)"
    )

    args = parser.parse_args()

    # Get API key
    api_key = get_api_key(args.api_key)
    if not api_key:
        print("Error: No API key provided.", file=sys.stderr)
        print("Please either:", file=sys.stderr)
        print("  1. Provide --api-key argument", file=sys.stderr)
        print("  2. Set GEMINI_API_KEY environment variable", file=sys.stderr)
        sys.exit(1)

    # Import here after checking API key to avoid slow import on error
    from google import genai
    from google.genai import types
    from PIL import Image as PILImage

    # Initialise client
    client = genai.Client(api_key=api_key)

    # Load input images if provided (up to 14 supported)
    input_images = []
    output_resolution = args.resolution
    if args.input_images:
        if len(args.input_images) > 14:
            print(f"Error: Too many input images ({len(args.input_images)}). Maximum is 14.", file=sys.stderr)
            sys.exit(1)

        max_input_dim = 0
        for img_path in args.input_images:
            try:
                img = PILImage.open(img_path)
                input_images.append(img)
                print(f"Loaded input image: {img_path}")

                # Track largest dimension for auto-resolution
                width, height = img.size
                max_input_dim = max(max_input_dim, width, height)
            except Exception as e:
                print(f"Error loading input image '{img_path}': {e}", file=sys.stderr)
                sys.exit(1)

        # Auto-detect resolution from largest input if not explicitly set
        if args.resolution == "1K" and max_input_dim > 0:  # Default value
            if max_input_dim >= 3000:
                output_resolution = "4K"
            elif max_input_dim >= 1500:
                output_resolution = "2K"
            else:
                output_resolution = "1K"
            print(f"Auto-detected resolution: {output_resolution} (from max input dimension {max_input_dim})")

    # Build contents (images first if editing, prompt only if generating)
    if input_images:
        contents = [*input_images, args.prompt]
        img_count = len(input_images)
        print(f"Processing {img_count} image{'s' if img_count > 1 else ''} with resolution {output_resolution}...")
    else:
        contents = args.prompt
        print(f"Generating image with resolution {output_resolution}...")

    def generate_and_save(model_key: str, output_path: Path) -> bool:
        """Run generation with a specific model and save the result. Returns True on success."""
        model_id = MODEL_MAP[model_key]
        label = MODEL_LABELS[model_key]
        output_path.parent.mkdir(parents=True, exist_ok=True)

        print(f"\n--- {label} ({model_id}) ---")
        try:
            response = client.models.generate_content(
                model=model_id,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_modalities=["TEXT", "IMAGE"],
                    image_config=types.ImageConfig(
                        image_size=output_resolution
                    )
                )
            )

            # Process response and convert to PNG
            image_saved = False
            for part in response.parts:
                if part.text is not None:
                    print(f"Model response: {part.text}")
                elif part.inline_data is not None:
                    from io import BytesIO

                    # inline_data.data is already bytes, not base64
                    image_data = part.inline_data.data
                    if isinstance(image_data, str):
                        import base64
                        image_data = base64.b64decode(image_data)

                    image = PILImage.open(BytesIO(image_data))

                    # Ensure RGB mode for PNG
                    if image.mode == 'RGBA':
                        rgb_image = PILImage.new('RGB', image.size, (255, 255, 255))
                        rgb_image.paste(image, mask=image.split()[3])
                        rgb_image.save(str(output_path), 'PNG')
                    elif image.mode == 'RGB':
                        image.save(str(output_path), 'PNG')
                    else:
                        image.convert('RGB').save(str(output_path), 'PNG')
                    image_saved = True

            if image_saved:
                full_path = output_path.resolve()
                print(f"\nImage saved: {full_path}")
                print(f"MEDIA: {full_path}")
                return True
            else:
                print(f"Error: No image was generated by {label}.", file=sys.stderr)
                return False

        except Exception as e:
            print(f"Error generating image with {label}: {e}", file=sys.stderr)
            return False

    # Determine which models to run
    if args.ab_test:
        base = Path(args.filename)
        stem = base.stem
        suffix = base.suffix or ".png"
        parent = base.parent

        any_success = False
        for key in ("pro", "nb2"):
            out = parent / f"{stem}-{key}{suffix}"
            if generate_and_save(key, out):
                any_success = True
        if not any_success:
            sys.exit(1)
    else:
        output_path = Path(args.filename)
        if not generate_and_save(args.model, output_path):
            sys.exit(1)


if __name__ == "__main__":
    main()
