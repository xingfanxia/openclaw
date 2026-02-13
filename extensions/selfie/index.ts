import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawPluginApi } from "../../src/plugins/types.js";

type PluginCfg = {
  geminiApiKey?: string;
  outputDir?: string;
};

const MODEL = "gemini-3-pro-image-preview";

const REFERENCE_FILENAMES = ["mh_049.png", "mh_053.png", "mh_055.png", "mh_058.png", "mh_060.png"];

/**
 * Hybrid-s2 prompt: face from reference images, body from text, scene from agent.
 */
function buildPrompt(scenePrompt: string): string {
  return [
    "These reference photos show the person's FACE — preserve her exact facial features,",
    "eyes, nose, lips, face shape.",
    "",
    "Generate her with this body type: curvy hourglass figure with full bust, narrow waist,",
    "wide hips, and thick thighs. Athletic but soft — she works out regularly.",
    "",
    `New scene: ${scenePrompt}`,
    "",
    "Style: photorealistic casual iPhone selfie, candid, natural lighting, NOT studio or AI-looking.",
  ].join("\n");
}

/**
 * Load reference images once and cache the base64 data.
 */
async function loadReferenceImages(
  extDir: string,
): Promise<Array<{ mimeType: string; data: string }>> {
  const refDir = path.join(extDir, "reference-images");
  const images = await Promise.all(
    REFERENCE_FILENAMES.map(async (filename) => {
      const buf = await fs.readFile(path.join(refDir, filename));
      return { mimeType: "image/png", data: buf.toString("base64") };
    }),
  );
  return images;
}

export default function register(api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig ?? {}) as PluginCfg;
  const outputDir = cfg.outputDir || "/tmp/openclaw-selfies";

  // Resolve extension directory for reference images
  const extDir = path.dirname(fileURLToPath(import.meta.url));

  // Cache reference images (loaded lazily on first call)
  let refImagesPromise: Promise<Array<{ mimeType: string; data: string }>> | null = null;
  function getReferenceImages() {
    if (!refImagesPromise) {
      refImagesPromise = loadReferenceImages(extDir);
    }
    return refImagesPromise;
  }

  api.registerTool(
    (_ctx) => {
      return {
        label: "Image Generate",
        name: "image_generate",
        description: [
          "Generate a photorealistic selfie using face reference images + your scene description.",
          "Uses hybrid s2 strategy: face accuracy from reference photos, body from text, scene from you.",
          "",
          "The tool handles face consistency and body description automatically.",
          "You write a creative scene prompt — describe the setting, outfit, pose, mood, lighting.",
          "",
          "Think about what fits the current moment:",
          "- Time of day, season, weather",
          "- What she'd actually be doing right now",
          "- Her mood, recent conversation topics",
          "- Mix up outfits, locations, poses naturally",
          "",
          "Examples (inspiration, not templates):",
          '- "Post-workout in the gym, hair in messy ponytail, wearing black sports bra and leggings, slight flush, gym equipment behind"',
          '- "Morning coffee at a sunny cafe window, oversized cream sweater, sleepy soft smile, warm light"',
          '- "Getting ready for dinner, little black dress, doing hair in bathroom mirror, phone in hand"',
          '- "Lazy Sunday on the couch, oversized hoodie, messy bun, laptop nearby, cozy blankets"',
          '- "Walking through a park in autumn, fitted jacket, scarf, golden hour light filtering through trees"',
          "",
          "After generating, send the image using the message tool:",
          "  1. Call image_generate with your scene prompt",
          "  2. Call message tool with action='send', media=<returned_path>, message=<caption>",
          "",
          "SAFETY: Gemini has safety filters. Use tasteful descriptions.",
        ].join("\n"),
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description:
                "Creative scene description: outfit, pose, location, mood, lighting. " +
                "Face and body are handled automatically from reference images. " +
                "Focus on making the scene feel natural and contextual.",
            },
          },
          required: ["prompt"],
        },
        execute: async (_toolCallId: string, args: unknown) => {
          const params = args as Record<string, unknown>;
          const rawPrompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
          if (!rawPrompt) {
            throw new Error("prompt is required");
          }

          const apiKey = cfg.geminiApiKey || process.env.GEMINI_API_KEY || "";
          if (!apiKey) {
            throw new Error("GEMINI_API_KEY not configured.");
          }

          const refImages = await getReferenceImages();
          const prompt = buildPrompt(rawPrompt);

          await fs.mkdir(outputDir, { recursive: true });

          // Build multimodal request: reference images + text prompt
          const parts: Array<Record<string, unknown>> = [
            ...refImages.map((img) => ({
              inlineData: { mimeType: img.mimeType, data: img.data },
            })),
            { text: prompt },
          ];

          const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: { responseModalities: ["IMAGE"] },
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API error (${response.status}): ${errorText.slice(0, 500)}`);
          }

          const data = (await response.json()) as {
            candidates?: Array<{
              content?: {
                parts?: Array<{ inlineData?: { mimeType: string; data: string } }>;
              };
              finishReason?: string;
              finishMessage?: string;
            }>;
          };

          const candidate = data.candidates?.[0];
          const imagePart = candidate?.content?.parts?.find((p) => p.inlineData);
          if (!imagePart?.inlineData) {
            const reason = candidate?.finishMessage || candidate?.finishReason || "unknown";
            throw new Error(`Image generation failed: ${reason}`);
          }
          const imageData = Buffer.from(imagePart.inlineData.data, "base64");

          const id = crypto.randomBytes(8).toString("hex");
          const filename = `selfie-${id}.png`;
          const filePath = path.join(outputDir, filename);

          await fs.writeFile(filePath, imageData);
          const stats = await fs.stat(filePath);

          return {
            content: [
              {
                type: "text" as const,
                text: [
                  `Image generated and saved to: ${filePath}`,
                  `Size: ${(stats.size / 1024).toFixed(0)} KB`,
                  `Model: ${MODEL}`,
                  `Reference images: ${REFERENCE_FILENAMES.length} face refs used`,
                  "",
                  `Send it using the message tool:`,
                  `  action: "send"`,
                  `  media: "${filePath}"`,
                  `  message: "your caption"`,
                ].join("\n"),
              },
            ],
          };
        },
      };
    },
    { optional: false },
  );
}
