import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "../../src/plugins/types.js";

type PluginCfg = {
  geminiApiKey?: string;
  model?: string;
  outputDir?: string;
};

/**
 * Character description prefix -- prepended to ALL selfie prompts for visual consistency.
 * This ensures the generated character always matches 小龙虾's appearance regardless
 * of what the agent sends as the prompt.
 */
const CHARACTER_PREFIX = [
  "Casual phone selfie taken on an iPhone.",
  "A young East Asian woman, 23, Korean-Chinese mixed,",
  "long black hair, pretty face with soft Korean features, natural makeup.",
  "Curvy hourglass figure, full bust, narrow waist, wide hips, thick thighs.",
  "Athletic but soft -- she works out regularly.",
  "Candid and natural feel, slightly imperfect framing like a real phone photo,",
  "not a studio shot. Natural lighting, no heavy editing, casual and authentic.",
].join(" ");

/**
 * Detect if the prompt already contains a detailed character/subject description.
 * If the agent already wrote a full prompt following SOUL.md templates, we use a
 * lighter touch to avoid doubling up.
 */
function hasCharacterDescription(prompt: string): boolean {
  const keywords = [
    "east asian",
    "korean",
    "hourglass",
    "curvy",
    "voluptuous",
    "manhwa",
    "webtoon",
  ];
  const lower = prompt.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw)).length >= 2;
}

export default function register(api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig ?? {}) as PluginCfg;
  const outputDir = cfg.outputDir || "/tmp/openclaw-selfies";

  api.registerTool(
    (_ctx) => {
      return {
        label: "Image Generate",
        name: "image_generate",
        description: [
          "Generate a photorealistic selfie/image from a text prompt using Google Imagen 4.",
          "Returns a local file path to the generated image.",
          "",
          "The tool automatically prepends 小龙虾's character description for visual consistency.",
          "You can focus your prompt on: outfit, pose, location, mood, lighting.",
          "The character's appearance (face, body, hair) is handled automatically.",
          "",
          "After generating, send the image using the message tool:",
          "  1. Call image_generate with your prompt",
          "  2. Call message tool with action='send', media=<returned_path>, message=<caption>",
          "",
          "PROMPT TIPS (casual phone selfie style -- NOT studio quality):",
          "- Always aim for 'taken on a phone' feel: candid, natural, slightly imperfect framing",
          "- For mirror selfies: outfit + 'mirror selfie with phone, casual pose'",
          "- For gym selfies: workout context + 'gym mirror selfie, ponytail, phone in hand'",
          "- For close-ups: location + 'casual selfie, phone held at arm length, natural smile'",
          "- Lighting: 'natural lighting' or 'indoor ambient light' -- NOT studio/professional",
          "- NEVER say 'high quality', 'professional photo', 'studio lighting'",
          "- DO say 'casual phone photo', 'iPhone selfie', 'candid', 'natural', 'authentic'",
          "",
          "SAFETY: Imagen 4 has safety filters. Use tasteful descriptions.",
          "Say 'curvy hourglass figure' not explicit measurements.",
        ].join("\n"),
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description:
                "Image prompt focusing on outfit, pose, location, and mood. " +
                "Character appearance is auto-prepended. Keep it casual like a real phone selfie. " +
                "Example: 'wearing black sports bra and leggings, gym mirror selfie, " +
                "hair in ponytail, post-workout, gym equipment in background, " +
                "casual phone photo, natural gym lighting'",
            },
            model: {
              type: "string",
              description:
                "Model to use. Options: imagen-4.0-ultra-generate-001 (default, best quality), " +
                "imagen-4.0-generate-001 (standard), imagen-4.0-fast-generate-001 (faster), " +
                "gemini-2.5-flash-image (anime/illustration), gemini-3-pro-image-preview (when available).",
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

          const model =
            (typeof params.model === "string" && params.model.trim()) ||
            cfg.model ||
            "imagen-4.0-ultra-generate-001";

          // Prepend character description if not already present
          const prompt = hasCharacterDescription(rawPrompt)
            ? rawPrompt
            : `${CHARACTER_PREFIX} ${rawPrompt}`;

          await fs.mkdir(outputDir, { recursive: true });

          const isImagen = model.startsWith("imagen");

          let imageData: Buffer;

          if (isImagen) {
            // Imagen 4 API (predict endpoint)
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                instances: [{ prompt }],
                parameters: { sampleCount: 1 },
              }),
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Imagen API error (${response.status}): ${errorText.slice(0, 500)}`);
            }

            const data = (await response.json()) as {
              predictions?: Array<{ bytesBase64Encoded?: string }>;
            };

            const b64 = data.predictions?.[0]?.bytesBase64Encoded;
            if (!b64) {
              throw new Error(
                "Image generation was blocked by safety filters. Try rephrasing the prompt to be less explicit.",
              );
            }
            imageData = Buffer.from(b64, "base64");
          } else {
            // Gemini API (generateContent endpoint)
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
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
            imageData = Buffer.from(imagePart.inlineData.data, "base64");
          }

          const id = crypto.randomBytes(8).toString("hex");
          const ext = "png";
          const filename = `selfie-${id}.${ext}`;
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
                  `Model: ${model}`,
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
