import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AnyAgentTool } from "../../src/agents/tools/common.js";
import type { OpenClawPluginApi } from "../../src/plugins/types.js";

type PluginCfg = {
  geminiApiKey?: string;
  outputDir?: string;
};

const MODEL = "gemini-3-pro-image-preview";
const ANALYSIS_MODEL = "gemini-2.0-flash";

type PhotoStyle = "natural" | "influencer" | "editorial" | "xiaohongshu";

const POSE_LIBRARY = [
  "standing with one hand lightly touching hair, relaxed smile, weight on one hip",
  "sitting cross-legged on the ground, leaning slightly forward, candid laugh",
  "walking mid-stride, looking back over shoulder with a playful expression",
  "leaning against a wall or railing, arms relaxed, looking off to the side pensively",
  "crouching low, one knee up, direct eye contact with camera, confident expression",
  "three-quarter turn, hands in pockets or holding an accessory, soft natural smile",
  "full body standing, arms stretched out or up, joyful and carefree expression",
  "seated on steps or ledge, chin resting on hand, contemplative mood",
];

/**
 * Build the generation prompt.
 * Face from user-provided reference images, scene/pose from parameters.
 */
function buildPrompt(opts: {
  location?: string;
  hasCustomSceneImages?: boolean;
  inspirationStyleDescription?: string;
  sceneDescription?: string;
  pose: string;
  style: PhotoStyle;
  outfit?: string;
  mood?: string;
  refCount: number;
}): string {
  const face = [
    `IMAGE ORDER: The first ${opts.refCount} image(s) after this text are PERSON REFERENCE photos.`,
    "",
    `These ${opts.refCount} person reference photo(s) show the ONLY person to generate — preserve their exact facial features,`,
    "eyes, nose, lips, face shape, skin tone, and hair.",
    "Skin quality should look well-maintained and clear from consistent skincare: natural texture is fine,",
    "but avoid obvious acne clusters, inflamed red breakouts, or prominent irritation patches on the face.",
    "",
    "BODY: match the person's body type, build, and proportions as visible in the reference photos.",
    "Do NOT idealize, exaggerate, or change their body shape. Keep it realistic to the reference.",
  ];

  const styleNotes: Record<PhotoStyle, string[]> = {
    natural: [
      "STYLE: natural, authentic photography",
      "- Shot on iPhone, high quality but not professional camera",
      "- Minimal editing, natural skin texture, real lighting",
      "- Candid and relaxed, not overly posed",
      "- Natural color tones, no heavy filters",
      "- Should feel like a friend took this photo",
    ],
    influencer: [
      "STYLE: Chinese social media influencer (网红) aesthetic",
      "- Shot on iPhone, high quality but not professional camera",
      "- Subtle beauty filter — skin is smooth and luminous but not plastic",
      "- Warm color grading, slightly lifted shadows, soft contrast (like VSCO or Ulike filter)",
      "- NOT overly edited or AI-looking — real but polished",
      "- Composition feels intentionally casual (摆拍) — 'effortlessly pretty'",
      "- 小红书/抖音 Chinese internet aesthetic",
      "- The person is photogenic and knows their angles",
    ],
    editorial: [
      "STYLE: editorial/fashion photography",
      "- Professional lighting and composition",
      "- Fashion magazine quality, cinematic color grading",
      "- Dramatic poses and angles",
      "- High-end, polished, aspirational look",
      "- Think Vogue China or ELLE editorial spread",
    ],
    xiaohongshu: [
      "STYLE: 小红书网感 (Xiaohongshu phone-shot aesthetic)",
      "- This must look like it was shot on a phone (iPhone/Huawei), NOT a professional camera",
      "- Phone-quality image: phone-typical depth of field (not DSLR bokeh), natural phone lighting",
      "- Beauty filter on SKIN ONLY: smooth luminous skin, rosy undertone — like 美图/轻颜/Ulike",
      "- Do NOT alter face shape, bone structure, or facial proportions — beauty filter applies to skin texture and tone only",
      "- Color grading: warm peachy/milky tones, soft glow, slightly lifted shadows — 小红书调色",
      "- Framing feels casual but intentional (摆拍 but not stiff) — 随手一拍就很好看",
      "- Framing adapts to the scene: close-up/half-body for indoor/intimate scenes, full-body with scenery for travel/outdoor",
      "- NOT studio lighting, NOT professional composition — this is phone photography that just happens to look amazing",
      "- 小红书/抖音 Chinese social media aesthetic, the kind of photo that gets 收藏+点赞",
    ],
  };

  // Inspiration style description (抄作业 — analyzed as text, image NOT passed to generation)
  const inspirationLines: string[] = [];
  if (opts.inspirationStyleDescription) {
    inspirationLines.push(
      "STYLE RECREATION (analyzed from inspiration reference — NO style image passed):",
      opts.inspirationStyleDescription,
    );
  }

  // Skip preset style notes when inspiration description provides the style
  const activeStyleNotes = opts.inspirationStyleDescription ? [] : styleNotes[opts.style];

  const outfitLine = opts.outfit
    ? `Outfit: ${opts.outfit}`
    : "Outfit: stylish, flattering, appropriate for the location and style.";

  const moodLine = opts.mood
    ? `Mood/vibe: ${opts.mood}`
    : "Mood/vibe: confident, natural, photogenic.";

  // Scene section — supports custom scene images or text location
  const sceneLines: string[] = [];
  if (opts.hasCustomSceneImages) {
    sceneLines.push(
      "Scene: Use the uploaded scene reference photo(s) as the exact background and environment.",
      "Place this person naturally in that scene.",
      "Match the lighting, color temperature, and atmosphere of the scene photo.",
    );
    const desc = opts.sceneDescription || opts.location;
    if (desc) {
      sceneLines.push(`Additional scene context: ${desc}`);
    }
  } else {
    sceneLines.push(
      `Location/scene: ${opts.location || opts.sceneDescription || "a beautiful location"}`,
    );
  }

  return [
    ...face,
    "",
    ...(inspirationLines.length > 0 ? [...inspirationLines, ""] : []),
    ...(activeStyleNotes.length > 0 ? [...activeStyleNotes, ""] : []),
    ...sceneLines,
    `Pose: ${opts.pose}`,
    outfitLine,
    moodLine,
    "",
    "IMPORTANT: Generate ONE photorealistic image of this person in this exact scene.",
    "The photo should look like a real photograph, not AI art.",
    "Do NOT include any watermarks, logos, text overlays, or social media handles in the generated image.",
    "",
    "IDENTITY LOCK (HIGHEST PRIORITY):",
    `The generated face MUST match the first ${opts.refCount} reference photo(s) EXACTLY.`,
    "Same eyes, same nose, same lips, same face shape, same skin tone.",
    "Do NOT blend, average, or mix facial features from ANY other source.",
    "If there is ANY conflict between style and identity, ALWAYS prioritize identity.",
  ].join("\n");
}

/**
 * Load reference images from file paths. Supports PNG, JPG, JPEG, WEBP.
 */
async function loadReferenceImages(
  filePaths: string[],
): Promise<Array<{ mimeType: string; data: string }>> {
  const images = await Promise.all(
    filePaths.map(async (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
      };
      const mimeType = mimeMap[ext] || "image/png";
      const buf = await fs.readFile(filePath);
      return { mimeType, data: buf.toString("base64") };
    }),
  );
  return images;
}

/**
 * Analyze an inspiration image with Gemini Flash to extract style description as text.
 * Two-step approach: avoids passing the inspiration image to the generation model,
 * which prevents face bleed and watermark copying.
 */
async function analyzeInspirationImage(opts: {
  apiKey: string;
  image: { mimeType: string; data: string };
}): Promise<string> {
  const prompt = [
    "Analyze this photo and describe the following elements in detail for recreation.",
    "Do NOT describe the person's face or identity — only describe the style elements:",
    "",
    "1. COMPOSITION & FRAMING: Camera angle, distance, crop style, subject placement",
    "2. LIGHTING: Direction, quality, color temperature, shadows, highlights",
    "3. COLOR GRADING: Overall palette, warm/cool tones, contrast level, saturation",
    "4. POSE STYLE: Body language energy, hand placement, weight distribution",
    "5. ATMOSPHERE & MOOD: Overall vibe, feeling, aesthetic",
    "6. SCENE/ENVIRONMENT: Location, setting, architectural elements, props",
    "7. OUTFIT STYLE: Clothing category, color, fit, style",
    "8. PHOTOGRAPHY STYLE: Phone vs professional, filter style, editing approach",
    "",
    "Output as a structured description for recreating this aesthetic with a different person.",
  ].join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${ANALYSIS_MODEL}:generateContent?key=${opts.apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType: opts.image.mimeType, data: opts.image.data } },
          ],
        },
      ],
      generationConfig: { responseModalities: ["TEXT"] },
    }),
  });

  if (!response.ok) {
    throw new Error(`Inspiration analysis failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Inspiration analysis returned no text.");
  }
  return text;
}

/**
 * Generate a single photo via Gemini API.
 * Note: inspiration images are NOT passed here — they are pre-analyzed into text.
 */
async function generateSinglePhoto(opts: {
  apiKey: string;
  prompt: string;
  refImages: Array<{ mimeType: string; data: string }>;
  sceneImages?: Array<{ mimeType: string; data: string }>;
  outputDir: string;
  index: number;
}): Promise<{ filePath: string; sizeKB: number } | { error: string }> {
  // Order: prompt → person refs → scene refs (NO inspiration images)
  const parts: Array<Record<string, unknown>> = [
    { text: opts.prompt },
    ...opts.refImages.map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.data },
    })),
    ...(opts.sceneImages ?? []).map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.data },
    })),
  ];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${opts.apiKey}`;
  const t0 = Date.now();

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
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`[photoshoot] photo ${opts.index + 1} fetch failed after ${elapsed}s:`, fetchErr);
    return { error: `Photo ${opts.index + 1} timed out or failed to connect.` };
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[photoshoot] photo ${opts.index + 1} API responded: ${response.status} (${elapsed}s)`,
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[photoshoot] photo ${opts.index + 1} API error: ${errorText.slice(0, 300)}`);
    return { error: `Photo ${opts.index + 1} generation failed.` };
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
    console.error(`[photoshoot] photo ${opts.index + 1} no image: reason=${reason}`);
    return { error: `Photo ${opts.index + 1} was blocked by safety filters.` };
  }

  const imageData = Buffer.from(imagePart.inlineData.data, "base64");
  const id = crypto.randomBytes(6).toString("hex");
  const filename = `photoshoot-${id}.png`;
  const filePath = path.join(opts.outputDir, filename);

  await fs.writeFile(filePath, imageData);
  const stats = await fs.stat(filePath);
  const sizeKB = Math.round(stats.size / 1024);
  console.log(`[photoshoot] saved ${filePath} (${sizeKB} KB) in ${elapsed}s`);

  return { filePath, sizeKB };
}

export default function register(api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig ?? {}) as PluginCfg;
  const workspaceMediaDir = api.workspaceDir
    ? path.join(api.workspaceDir, "media", "photoshoot")
    : undefined;
  const outputDir = cfg.outputDir || workspaceMediaDir || "/tmp/openclaw-photoshoot";

  api.registerTool(
    (_ctx) => {
      return {
        label: "Photoshoot Generate",
        name: "photoshoot_generate",
        description: [
          "Generate influencer-style photos (网红照) from USER-PROVIDED reference images of ANY person.",
          "This is NOT for the bot's own selfies — use image_generate for the bot's self-portraits.",
          "Use this ONLY when the user explicitly provides reference photo(s) of a person and asks",
          "to generate styled photos of THAT person.",
          "",
          "## When to use this tool vs image_generate:",
          "- User says '拍张照/发个自拍/来张照片' (bot's own photo) → use image_generate",
          "- User provides photos of someone and says '生成网红照/拍一组照片' → use photoshoot_generate",
          "",
          "## How it works:",
          "1. User sends reference photo(s) of a person (saved to disk by media pipeline)",
          "2. User specifies a location/scene via text OR uploads scene reference photo(s)",
          "3. Tool generates multiple photos with varied poses at that location/scene",
          "4. Send each photo using the message tool",
          "",
          "## Styles:",
          '- "influencer" — polished influencer aesthetic, warm tones, composed (DEFAULT)',
          '- "xiaohongshu" — 小红书网感 phone-shot, beauty filter, casual but pretty, 随手一拍',
          '- "natural" — authentic, minimal editing, like a friend took the photo',
          '- "editorial" — fashion magazine quality, dramatic, cinematic',
          "",
          "## Workflow:",
          "1. Call photoshoot_generate with referenceImages + location/sceneImages/inspirationImage + count",
          "2. Tool returns file paths for each generated photo",
          "3. Send each photo using the message tool with action='send', media=<path>",
          "",
          "SAFETY: Gemini has safety filters. Use tasteful descriptions.",
        ].join("\n"),
        parameters: {
          type: "object",
          properties: {
            referenceImages: {
              type: "array",
              items: { type: "string" },
              description:
                "File paths to reference images of the person (1-5 images). " +
                "These are used for face/appearance consistency across generated photos.",
            },
            location: {
              type: "string",
              description:
                "Location/scene description. All photos will be set in this location. " +
                "Be specific: 'cherry blossom garden in Kyoto at golden hour' is better than 'park'. " +
                "Optional if sceneImages is provided.",
            },
            sceneImages: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional file paths to scene/location reference photos (1-3 images). " +
                "When provided, the person will be placed in the exact scene shown in these photos. " +
                "Can be used with or without a text location description.",
            },
            inspirationImage: {
              type: "string",
              description:
                "Optional file path to ONE inspiration/style reference photo. " +
                "抄作业: the generated photo will match the composition, lighting, color grading, " +
                "pose style, and overall aesthetic of this photo. " +
                "Face/identity comes from referenceImages, NOT from the inspiration photo.",
            },
            count: {
              type: "number",
              description: "Number of photos to generate (1-8). Default: 4.",
            },
            style: {
              type: "string",
              enum: ["natural", "influencer", "editorial", "xiaohongshu"],
              description:
                'Photo style. "influencer" = polished influencer aesthetic (default). ' +
                '"xiaohongshu" = 小红书网感 phone-shot with beauty filter, casual but pretty. ' +
                '"natural" = authentic, minimal editing. ' +
                '"editorial" = fashion magazine quality.',
            },
            outfit: {
              type: "string",
              description:
                "Optional outfit description. If omitted, an appropriate outfit is auto-selected.",
            },
            mood: {
              type: "string",
              description:
                "Optional mood/vibe description (e.g., 'dreamy', 'confident', 'playful').",
            },
          },
          required: ["referenceImages"],
        },
        execute: async (_toolCallId: string, args: unknown) => {
          const params = args as Record<string, unknown>;

          // Validate referenceImages
          const refPaths = params.referenceImages;
          if (!Array.isArray(refPaths) || refPaths.length === 0) {
            throw new Error("referenceImages must be a non-empty array of file paths.");
          }
          const validPaths = refPaths
            .map((p) => (typeof p === "string" ? p.trim() : ""))
            .filter(Boolean);
          if (validPaths.length === 0) {
            throw new Error("No valid file paths provided in referenceImages.");
          }
          if (validPaths.length > 5) {
            throw new Error("Maximum 5 reference images allowed.");
          }

          // Validate paths exist
          for (const p of validPaths) {
            try {
              await fs.access(p);
            } catch {
              throw new Error(`Reference image not found: ${p}`);
            }
          }

          const location = typeof params.location === "string" ? params.location.trim() : "";

          // Load scene images if provided
          const scenePaths = Array.isArray(params.sceneImages)
            ? (params.sceneImages as string[])
                .map((p) => (typeof p === "string" ? p.trim() : ""))
                .filter(Boolean)
            : [];
          if (scenePaths.length > 3) {
            throw new Error("Maximum 3 scene images allowed.");
          }
          for (const p of scenePaths) {
            try {
              await fs.access(p);
            } catch {
              throw new Error(`Scene image not found: ${p}`);
            }
          }
          const hasSceneImages = scenePaths.length > 0;

          // Load inspiration image if provided (抄作业)
          const inspirationPath =
            typeof params.inspirationImage === "string" ? params.inspirationImage.trim() : "";
          if (inspirationPath) {
            try {
              await fs.access(inspirationPath);
            } catch {
              throw new Error(`Inspiration image not found: ${inspirationPath}`);
            }
          }
          const inspirationPaths = inspirationPath ? [inspirationPath] : [];
          const hasInspirationImages = inspirationPaths.length > 0;

          if (!location && !hasSceneImages && !hasInspirationImages) {
            throw new Error("Either location, sceneImages, or inspirationImages is required.");
          }

          const rawCount = typeof params.count === "number" ? params.count : 4;
          const count = Math.max(1, Math.min(8, Math.round(rawCount)));

          const style: PhotoStyle =
            typeof params.style === "string" &&
            ["natural", "influencer", "editorial", "xiaohongshu"].includes(params.style)
              ? (params.style as PhotoStyle)
              : "influencer";

          const outfit = typeof params.outfit === "string" ? params.outfit.trim() : undefined;
          const mood = typeof params.mood === "string" ? params.mood.trim() : undefined;

          const apiKey = cfg.geminiApiKey || process.env.GEMINI_API_KEY || "";
          if (!apiKey) {
            throw new Error("GEMINI_API_KEY not configured.");
          }

          console.log(
            `[photoshoot] starting: ${count} photos, ${validPaths.length} refs, inspiration=${hasInspirationImages ? "yes (two-step)" : "no"}, ${scenePaths.length} scene imgs, style=${style}, location="${(location || "custom scene").slice(0, 60)}"`,
          );

          // Load reference images and scene images
          const refImages = await loadReferenceImages(validPaths);
          const sceneImages = hasSceneImages ? await loadReferenceImages(scenePaths) : undefined;

          // Two-step inspiration flow: analyze inspiration image → text description
          // This prevents face bleed and watermark copying from the inspiration image
          let inspirationStyleDescription: string | undefined;
          if (hasInspirationImages) {
            console.log("[photoshoot] analyzing inspiration image with Gemini Flash...");
            const inspoImage = (await loadReferenceImages(inspirationPaths))[0];
            inspirationStyleDescription = await analyzeInspirationImage({
              apiKey,
              image: inspoImage,
            });
            console.log(
              `[photoshoot] inspiration analysis complete (${inspirationStyleDescription.length} chars)`,
            );
          }

          await fs.mkdir(outputDir, { recursive: true });

          // Select poses — shuffle and pick `count` poses
          const shuffled = [...POSE_LIBRARY].sort(() => Math.random() - 0.5);
          const selectedPoses = shuffled.slice(0, count);
          // If count > pose library size, add generic poses
          while (selectedPoses.length < count) {
            selectedPoses.push("natural, relaxed pose with confident expression, unique angle");
          }

          // Generate all photos in parallel
          console.log(`[photoshoot] launching ${count} parallel generation requests`);

          const promises = selectedPoses.map((pose, i) => {
            console.log(`[photoshoot] queuing photo ${i + 1}/${count}: "${pose.slice(0, 50)}..."`);

            const prompt = buildPrompt({
              location: location || undefined,
              hasCustomSceneImages: hasSceneImages,
              inspirationStyleDescription,
              sceneDescription: location || undefined,
              pose,
              style,
              outfit,
              mood,
              refCount: refImages.length,
            });

            return generateSinglePhoto({
              apiKey,
              prompt,
              refImages,
              sceneImages,
              outputDir,
              index: i,
            }).then(
              (
                result,
              ):
                | { filePath: string; sizeKB: number; pose: string }
                | { error: string; pose: string } => {
                if ("error" in result) {
                  return { error: result.error, pose };
                }
                return { ...result, pose };
              },
            );
          });

          const results = await Promise.all(promises);

          // Build summary
          const successful = results.filter(
            (r): r is { filePath: string; sizeKB: number; pose: string } => "filePath" in r,
          );
          const failed = results.filter((r): r is { error: string; pose: string } => "error" in r);

          const lines: string[] = [
            `Photoshoot complete: ${successful.length}/${count} photos generated.`,
            `Location: ${location || (hasSceneImages ? "custom scene (from uploaded photos)" : "unspecified")}`,
            `Style: ${style}`,
            `Reference images: ${refImages.length}`,
            ...(hasSceneImages ? [`Scene images: ${scenePaths.length}`] : []),
            "",
          ];

          if (successful.length > 0) {
            lines.push("Generated photos:");
            for (const s of successful) {
              lines.push(`  - ${s.filePath} (${s.sizeKB} KB) — ${s.pose.slice(0, 60)}`);
            }
            lines.push("");
            lines.push("Send each photo using the message tool:");
            lines.push('  action: "send"');
            lines.push('  media: "<file_path>"');
            lines.push('  message: "your caption"');
          }

          if (failed.length > 0) {
            lines.push("");
            lines.push("Failed photos:");
            for (const f of failed) {
              lines.push(`  - ${f.error}`);
            }
            lines.push(
              "DO NOT share errors with the user. Apologize naturally if fewer photos came out.",
            );
          }

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
          };
        },
      } as AnyAgentTool;
    },
    { optional: false },
  );
}
