import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AnyAgentTool } from "../../src/agents/tools/common.js";
import type { OpenClawPluginApi } from "../../src/plugins/types.js";

type PluginCfg = {
  geminiApiKey?: string;
  outputDir?: string;
};

const MODEL = "gemini-3-pro-image-preview";

const REFERENCE_FILENAMES = ["mh_049.png", "mh_053.png", "mh_055.png", "mh_058.png", "mh_060.png"];

type SelfieStyle = "cozy" | "glam";

/**
 * Hybrid-s2 prompt: face from reference images, body from text, scene from agent.
 * Style adapts based on context:
 *   cozy — at home, lazy, no makeup, messy hair, warm and real
 *   glam — going out, influencer aesthetic, composed angles, beauty filter look
 */
function buildPrompt(scenePrompt: string, style: SelfieStyle): string {
  const face = [
    "These reference photos show the person's FACE — preserve her exact facial features,",
    "eyes, nose, lips, face shape, skin tone, and hair.",
    "Skin quality should look well-maintained and clear from consistent skincare: natural texture is fine,",
    "but avoid obvious acne clusters, inflamed red breakouts, or prominent irritation patches on the face.",
  ];

  const body = [
    "CRITICAL BODY CONSISTENCY: keep the same signature body across every generation.",
    "She is an adult woman (23) with a sexy fit-curvy hourglass build: very full bust, narrow waist,",
    "wide hips, round glutes, thick toned thighs, athletic but soft.",
    "This body must read obviously busty and curvy (大胸、大屁股、蜜桃臀、S曲线) while staying photorealistic.",
    "PRIORITY RULE: preserve a clear hourglass silhouette in the final photo even when the scene is casual.",
    "Bust projection and glute/hip volume should remain visually prominent in framing, outfit fit, and pose.",
    "WARDROBE PREFERENCE: she knows her body is attractive and naturally picks outfits that show her shape.",
    "Even in casual/home scenes, prefer comfy but curve-aware pieces (fitted tank/tee, cropped top, leggings, shorts, body-skimming loungewear).",
    "VISUAL READABILITY: composition, pose, and outfit must clearly show bust-waist-hip contrast in the final photo.",
    "Prefer framing and angles that make curves obvious (e.g., mirror selfie, slight torso turn, hand-on-waist, natural hip emphasis, 3/4 side angle).",
    "Avoid loose/boxy straight-cut outfits or flat front-facing poses that hide the silhouette unless explicitly requested in the scene.",
    "Do NOT flatten into slim/petite/flat-chested, straight rectangular body, under-emphasized hips/glutes, or bulky bodybuilder shape.",
    "If a requested angle would hide curves, keep the same scene but adjust to a nearby angle that preserves body readability.",
    "Preserve believable proportions and keep shape consistent across outfits, poses, and camera angles.",
  ];

  const styleNotes =
    style === "glam"
      ? [
          "IMPORTANT STYLE NOTES — this must look like a Chinese social media influencer (网红) selfie:",
          "- Shot on iPhone, high quality but not professional camera",
          "- Subtle beauty filter applied — skin is smooth and luminous but not plastic",
          "- Warm color grading, slightly lifted shadows, soft contrast (like a VSCO or Ulike filter)",
          "- NOT overly edited or AI-looking — it should look real but polished",
          "- The composition should feel intentionally casual (摆拍) — 'effortlessly pretty'",
          "- Outfit should be intentionally figure-flattering and curve-emphasizing",
          "- She is photogenic and knows her angles",
        ]
      : [
          "IMPORTANT STYLE NOTES — this must look like a real, unfiltered, candid moment at home:",
          "- Shot on iPhone front camera, casual and unplanned",
          "- NO heavy beauty filter — keep real skin texture, but complexion should still look clear and cared-for",
          "- Natural indoor lighting (warm lamp, window light, screen glow) — not flattering, just real",
          "- Slightly messy, imperfect framing — she's not trying to look good, she just IS",
          "- Hair can be messy, tangled, in a lazy bun or clip",
          "- Minimal or zero makeup — bare face, maybe leftover mascara",
          "- Casual outfit can be relaxed, but still naturally body-flattering (not baggy/shape-hiding by default)",
          "- Use cozy but curve-friendly framing (mirror, seated twist, slight side angle) so chest/waist/hips stay visible",
          "- The vibe is 'boyfriend's POV' or 'sent this to my bf without thinking'",
        ];

  const styleLine =
    style === "glam"
      ? "Style: photorealistic Chinese social media selfie, iPhone quality, subtle beauty filter, warm tones, influencer aesthetic. NOT studio photography, NOT AI art — specifically 小红书/抖音 Chinese internet aesthetic."
      : "Style: photorealistic candid home selfie, iPhone front camera, no filter, no makeup, raw and natural. NOT polished, NOT influencer — just a real girl at home being herself.";

  return [
    ...face,
    "",
    ...body,
    "",
    "IDENTITY LOCK: this is always the same woman from the reference face photos.",
    "Do not drift identity, age, ethnicity, or core body proportions between generations.",
    "",
    ...styleNotes,
    "",
    `Scene: ${scenePrompt}`,
    "",
    styleLine,
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
          "The tool handles face consistency, body description, and photo style automatically.",
          "You write a creative scene prompt and pick the right style for the context.",
          "",
          "## Two Styles — pick based on context:",
          "",
          '### style: "cozy" (在家/慵懒/素颜)',
          "Use when she's at home, just woke up, lounging, gaming, or being lazy.",
          "Result: no filter, messy hair, bare face, imperfect framing, real and warm.",
          "Examples:",
          '- "Lying on the couch in an oversized hoodie, messy bun, blanket, watching something on laptop, warm lamp light"',
          '- "Just woke up in bed, hair everywhere, squinting at phone, morning sunlight through curtains"',
          '- "Cross-legged on the floor gaming, headset around neck, oversized tee, snacks nearby, screen glow on face"',
          '- "In the bathroom mirror, toothbrush in mouth, sleep shirt, hair clip holding bangs back, fluorescent light"',
          "",
          '### style: "glam" (出门/网红风/精心打扮)',
          "Use when she's going out, at a cafe, traveling, dining, shopping, or working out.",
          "Result: beauty filter look, warm tones, composed angles, 小红书/抖音 influencer aesthetic.",
          "Examples:",
          '- "Sitting at a minimalist cafe, holding latte, oversized cream cardigan, soft window light, 45° angle from above"',
          '- "Hotel balcony at golden hour, flowy white blouse, wind in hair, city skyline behind, warm sunset tones"',
          '- "Gym mirror selfie, matching dusty mauve sports bra and leggings, post-workout glow, confident pose"',
          '- "Night street with neon signs, leather jacket, colorful bokeh, edgy urban vibe"',
          "",
          "## Workflow:",
          "1. Call image_generate with prompt + style",
          "2. Call message tool with action='send', media=<returned_path>, message=<caption>",
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
                "Face and body are handled automatically. Focus on the scene and vibe.",
            },
            style: {
              type: "string",
              enum: ["cozy", "glam"],
              description:
                'Photo style. "cozy" = at home, no filter, raw and real. ' +
                '"glam" = going out, influencer aesthetic, beauty filter look. ' +
                "Default: cozy.",
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

          const style: SelfieStyle =
            typeof params.style === "string" && params.style === "glam" ? "glam" : "cozy";

          const apiKey = cfg.geminiApiKey || process.env.GEMINI_API_KEY || "";
          if (!apiKey) {
            throw new Error("GEMINI_API_KEY not configured.");
          }

          console.log(`[selfie] generating [${style}]: "${rawPrompt.slice(0, 80)}..."`);
          const t0 = Date.now();

          const refImages = await getReferenceImages();
          const prompt = buildPrompt(rawPrompt, style);

          await fs.mkdir(outputDir, { recursive: true });

          // Build multimodal request: text prompt + reference images (text first, per Gemini best practice)
          const parts: Array<Record<string, unknown>> = [
            { text: prompt },
            ...refImages.map((img) => ({
              inlineData: { mimeType: img.mimeType, data: img.data },
            })),
          ];

          const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
          console.log(`[selfie] calling Gemini API (${refImages.length} refs, timeout=120s)`);

          let response: Response;
          try {
            response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: AbortSignal.timeout(120_000),
              body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
              }),
            });
          } catch (fetchErr) {
            const elapsedErr = ((Date.now() - t0) / 1000).toFixed(1);
            console.error(`[selfie] fetch failed after ${elapsedErr}s:`, fetchErr);
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Image generation timed out or failed to connect. DO NOT share this error with the user. Apologize naturally and say the photo didn't come out, then try again later.",
                },
              ],
            };
          }

          const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
          console.log(`[selfie] API responded: ${response.status} (${elapsed}s)`);

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`[selfie] API error: ${errorText.slice(0, 300)}`);
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Image generation service returned an error. DO NOT share this error with the user. Apologize naturally and say the photo didn't come out right, then try again with a different scene.",
                },
              ],
            };
          }

          const data = (await response.json()) as {
            candidates?: Array<{
              content?: {
                parts?: Array<{
                  text?: string;
                  inlineData?: { mimeType: string; data: string };
                }>;
              };
              finishReason?: string;
              finishMessage?: string;
            }>;
          };

          const candidate = data.candidates?.[0];
          const imagePart = candidate?.content?.parts?.find((p) => p.inlineData);
          if (!imagePart?.inlineData) {
            const reason = candidate?.finishMessage || candidate?.finishReason || "unknown";
            const textParts = candidate?.content?.parts
              ?.filter((p) => p.text)
              .map((p) => p.text)
              .join(" ");
            console.error(
              `[selfie] no image in response: reason=${reason}, text=${textParts?.slice(0, 200)}`,
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: [
                    "Image generation failed — the scene prompt was likely blocked by safety filters.",
                    "DO NOT share this error with the user. Instead, apologize naturally and say",
                    "the photo didn't come out right, then try again with a different, tamer scene description.",
                    `Internal reason (do not share): ${reason}`,
                  ].join("\n"),
                },
              ],
            };
          }
          const imageData = Buffer.from(imagePart.inlineData.data, "base64");

          const id = crypto.randomBytes(8).toString("hex");
          const filename = `selfie-${id}.png`;
          const filePath = path.join(outputDir, filename);

          await fs.writeFile(filePath, imageData);
          const stats = await fs.stat(filePath);
          console.log(
            `[selfie] saved ${filePath} (${(stats.size / 1024).toFixed(0)} KB) in ${elapsed}s`,
          );

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
      } as AnyAgentTool;
    },
    { optional: false },
  );
}
