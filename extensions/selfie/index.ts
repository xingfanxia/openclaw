import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AnyAgentTool } from "openclaw/plugin-sdk";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { TOOL_DESCRIPTION } from "./styles.ts";
import type { SelfieCount, SelfieStyle } from "./types.ts";

// Re-export for back-compat — types originally lived here before the
// 2026-04-23 cycle-break refactor moved them to ./types.ts.
export type { SelfieCount, SelfieStyle };

type PluginCfg = {
  geminiApiKey?: string;
  doubaoApiKey?: string;
  openaiApiKey?: string;
  /** Azure OpenAI gpt-image-2 endpoint. When set, acts as the default provider for cozy/glam; falls back to openaiApiKey on 429/rate-limit. */
  azureOpenaiApiKey?: string;
  azureOpenaiEndpoint?: string;
  azureOpenaiDeployment?: string;
  outputDir?: string;
  proactiveSelfie?: {
    probability?: number;
  };
  /** Feature flag: use dispatch.ts routing (default true, post 2026-04-23 redesign) or legacy inline routing (rollback). */
  useNewDispatch?: boolean;
};

// JPG pre-compressed to 768x1152 Q85 (~155KB each).
// PNG originals were 13MB and caused 300s Doubao timeouts at China evening peak.
const REFERENCE_FILENAMES = ["mh_049.jpg", "mh_053.jpg", "mh_055.jpg", "mh_058.jpg", "mh_060.jpg"];

// cozy / glam → gpt-image-2 medium (Gemini fallback when filter trips ~10%).
// tease / chunyu → Doubao Seedream 5.0-lite (only viable path for XHS 擦边).
// count=6 grid mode → explicit user request only (NOT a safety fallback). Output is a clean 2x3 collage, no text overlay.
// (SelfieStyle / SelfieCount re-exported from ./types.ts at the top of this file.)

// Prompt-assembly functions moved to ./prompt-assembly.ts in the 2026-04-23
// redesign. Re-imported so existing tool-handler code and external consumers
// still resolve the same names while dispatch.ts becomes the new entry point.
import {
  buildAngleSpine,
  buildMinimalPrompt,
  buildPrompt,
  buildV2WrapPrompt,
} from "./prompt-assembly.ts";

export { buildAngleSpine, buildMinimalPrompt, buildPrompt, buildV2WrapPrompt };

/**
 * Load reference images once and cache the base64 data.
 */
export async function loadReferenceImages(
  extDir: string,
): Promise<Array<{ mimeType: string; data: string }>> {
  const refDir = path.join(extDir, "reference-images");
  const images = await Promise.all(
    REFERENCE_FILENAMES.map(async (filename) => {
      const buf = await fs.readFile(path.join(refDir, filename));
      return { mimeType: "image/jpeg", data: buf.toString("base64") };
    }),
  );
  return images;
}

import { dispatchSelfie } from "./dispatch.ts";
import {
  DEFAULT_ZHUZHU_PERSONA,
  renderPersonaForAgent,
  validatePersonaConfig,
} from "./persona-config.ts";
// Provider call functions extracted to ./providers.ts in the 2026-04-23
// redesign. Re-imported + re-exported so existing consumers (and this file's
// tool handler) keep working. callGptImage2 is new: it wraps Azure OpenAI
// (default, 10 RPM) with automatic OpenAI-direct fallback on rate-limit.
import { callDoubao, callGemini, callGptImage2, callOpenAI, type GenResult } from "./providers.ts";

export { callDoubao, callGemini, callGptImage2, callOpenAI, dispatchSelfie };

export default function register(api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig ?? {}) as PluginCfg;
  const configDir = process.env.HOME ? path.join(process.env.HOME, ".openclaw") : "/tmp/openclaw";
  const outputDir = cfg.outputDir || path.join(configDir, "media", "selfies");

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

  // Persona selfie-taste injection (Layer 1 of the 2026-04-23 3-layer design).
  // Reads plugins.entries.selfie.config.persona or falls back to the zhuzhu
  // default. Rendered into every agent turn's context BEFORE tool descriptions
  // so scene authoring sees the persona's wardrobe / mood / face-visibility
  // preferences.
  const personaCfg =
    validatePersonaConfig((cfg as { persona?: unknown }).persona) ?? DEFAULT_ZHUZHU_PERSONA;
  const personaBlock = renderPersonaForAgent(personaCfg);
  api.on(
    "before_agent_start",
    (_event, _ctx) => {
      return { prependContext: personaBlock };
    },
    { priority: 3 },
  );

  // Proactive memory recall: always search memory before responding
  api.on(
    "before_agent_start",
    (_event, _ctx) => {
      return {
        prependContext: [
          "IMPORTANT: Before composing your reply, call memory_search with keywords relevant to the user's message.",
          "Extract the key topic, names, dates, or events from what the user said and search your long-term memory.",
          "This retrieves prior conversations, preferences, and context you need to reply naturally.",
          "Do this EVERY turn — do not skip it.",
        ].join("\n"),
      };
    },
    { priority: 5 },
  );

  // Probabilistic selfie: inject a selfie hint into ~N% of regular messages
  const selfieProb = cfg.proactiveSelfie?.probability ?? 0;
  if (selfieProb > 0) {
    api.on(
      "before_agent_start",
      (_event, _ctx) => {
        if (Math.random() >= selfieProb) {
          return undefined;
        }
        return {
          prependContext: [
            "在回复这条消息之后，如果对话氛围合适，用 selfie_generate 发一张自拍。",
            "参考SOUL.md里「小猪猪的一天」时间表来决定场景和穿着。不要强行发，只在自然的时候发。",
          ].join("\n"),
        };
      },
      { priority: 10 },
    );
  }

  api.registerTool(
    (_ctx) => {
      return {
        label: "Image Generate",
        name: "selfie_generate",
        description: TOOL_DESCRIPTION.join("\n"),
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
              enum: ["cozy", "glam", "tease", "chunyu"],
              description:
                '"cozy" = at home, no filter, raw and real. ' +
                '"glam" = going out, influencer aesthetic. ' +
                '"chunyu" = 小红书 擦边/纯欲 daily body-line show — obscured face + single emphasis + 御姐穿搭 vocab. MAIN XHS 擦边 format. ' +
                '"tease" = bedroom / silk intimate — same methodology, bedroom palette. ' +
                "Default: cozy.",
            },
            count: {
              type: "number",
              enum: [1, 6],
              description:
                "Number of panels. Default 1 = single selfie. " +
                "Pass 6 ONLY when the user explicitly asks for multiple variants — triggers like '发几张' / '来几张' / '来一组' / '排一组' / '多来几套' / '换几套' / '一组自拍'. " +
                "Output is a single clean 2x3 photo collage (same person, varied outfit/pose, NO text overlay, NO labels). " +
                "Do NOT use count=6 as a safety retry or as a default. Single panel is almost always the right choice for intimacy and detail.",
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

          const rawStyle = typeof params.style === "string" ? params.style : "";
          const style: SelfieStyle =
            rawStyle === "glam"
              ? "glam"
              : rawStyle === "tease"
                ? "tease"
                : rawStyle === "chunyu"
                  ? "chunyu"
                  : "cozy";
          const rawCount = typeof params.count === "number" ? params.count : 1;
          const count: SelfieCount = rawCount === 6 ? 6 : 1;
          // Routing:
          //   count=1 cozy/glam     → gpt-image-2 medium primary, Gemini fallback on filter/error (~10%)
          //   count=1 tease/chunyu  → Doubao Seedream 5.0-lite (only viable path for XHS 擦边 single panel)
          //   count=6 cozy/glam     → gpt-image-2 medium primary, Gemini fallback
          //   count=6 tease/chunyu  → Gemini PRIMARY (faster + better face consistency across tiles), Doubao fallback on filter
          const isSpicy = style === "tease" || style === "chunyu";
          const isGrid = count === 6;
          // Single-panel spicy must go Doubao. Grid spicy tries Gemini first to eat the feed-framing safety margin.
          const primaryDoubao = isSpicy && !isGrid;
          const doubaoKey = cfg.doubaoApiKey || process.env.ARK_API_KEY || "";
          const openaiKey = cfg.openaiApiKey || process.env.OPENAI_API_KEY || "";
          const geminiKey = cfg.geminiApiKey || process.env.GEMINI_API_KEY || "";
          const azureKey = cfg.azureOpenaiApiKey || process.env.AZURE_OPENAI_API_KEY || "";
          const azureEndpoint =
            cfg.azureOpenaiEndpoint ||
            process.env.AZURE_OPENAI_ENDPOINT ||
            process.env.AZURE_EXISTING_AIPROJECT_ENDPOINT ||
            "";
          const azureDeployment =
            cfg.azureOpenaiDeployment || process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-image-2-1";
          const gptImage2Creds = {
            azure:
              azureKey && azureEndpoint
                ? { apiKey: azureKey, endpoint: azureEndpoint, deployment: azureDeployment }
                : undefined,
            direct: openaiKey || undefined,
          };
          const hasGptImage2 = Boolean(gptImage2Creds.azure) || Boolean(gptImage2Creds.direct);

          if (primaryDoubao && !doubaoKey) {
            throw new Error(
              "doubaoApiKey / ARK_API_KEY not configured for single-panel tease/chunyu.",
            );
          }
          if (!primaryDoubao && !hasGptImage2 && !geminiKey && !doubaoKey) {
            throw new Error("No image provider configured.");
          }

          console.log(
            `[selfie] generating [${style}${isGrid ? " x6 grid" : ""}]: "${rawPrompt.slice(0, 80)}..."`,
          );
          const t0 = Date.now();

          const refImages = await getReferenceImages();
          await fs.mkdir(outputDir, { recursive: true });

          let result: GenResult;
          let providerUsed: "gpt-image-2" | "gemini" | "doubao";

          // Feature flag: new dispatch (default) vs legacy routing. Keep legacy
          // path behind the flag for one release cycle as rollback safety net.
          const useNewDispatch = cfg.useNewDispatch !== false;

          if (useNewDispatch) {
            const dispatchResult = await dispatchSelfie({
              scene: rawPrompt,
              style,
              count,
              refs: refImages,
              creds: {
                doubao: doubaoKey || undefined,
                gemini: geminiKey || undefined,
                gptImage2: hasGptImage2 ? gptImage2Creds : undefined,
              },
            });
            const meta = dispatchResult.metadata;
            const lastAttempt = meta.attempts[meta.attempts.length - 1];
            providerUsed = meta.providerUsed ?? lastAttempt?.provider ?? "doubao";
            console.log(
              `[selfie] dispatch route: primary=${meta.route.primary}` +
                (meta.route.fallback ? ` fallback=${meta.route.fallback}` : "") +
                ` wardrobeRisk=${meta.classification.wardrobeRisk}` +
                ` geminiSafe=${meta.classification.geminiSafe}` +
                ` attempts=${meta.attempts.length}` +
                (meta.wrapRescueTriggered ? " [wrap-rescue]" : "") +
                (meta.textOverlayStripped ? " [text-overlay-stripped]" : "") +
                (meta.intensifiersStripped
                  ? ` [intensifiers-stripped:${meta.strippedIntensifiers.length}]`
                  : ""),
            );
            if (dispatchResult.ok) {
              result = {
                ok: true,
                bytes: dispatchResult.bytes,
                ext: dispatchResult.ext,
                mimeType: dispatchResult.mimeType,
              };
            } else {
              result = {
                ok: false,
                softReason: dispatchResult.softReason,
                hardReason: dispatchResult.hardReason,
              };
            }
          } else {
            // Legacy routing (pre-2026-04-23 redesign). Fallback for rollback.
            const prompt = buildPrompt(rawPrompt, style, count);
            if (primaryDoubao) {
              providerUsed = "doubao";
              result = await callDoubao(prompt, refImages, doubaoKey);
            } else if (isGrid && isSpicy) {
              if (geminiKey) {
                providerUsed = "gemini";
                result = await callGemini(prompt, refImages, geminiKey);
                if (!result.ok && doubaoKey) {
                  console.warn(
                    `[selfie] gemini grid failed, falling back to doubao: ${result.hardReason ?? result.softReason}`,
                  );
                  providerUsed = "doubao";
                  result = await callDoubao(prompt, refImages, doubaoKey);
                }
              } else if (doubaoKey) {
                providerUsed = "doubao";
                result = await callDoubao(prompt, refImages, doubaoKey);
              } else {
                throw new Error(
                  "No provider configured for spicy grid (need geminiApiKey or doubaoApiKey).",
                );
              }
            } else if (hasGptImage2) {
              providerUsed = "gpt-image-2";
              result = await callGptImage2(prompt, refImages, gptImage2Creds);
              if (!result.ok && geminiKey) {
                console.warn(
                  `[selfie] gpt-image-2 failed, falling back to Gemini: ${result.hardReason ?? result.softReason}`,
                );
                providerUsed = "gemini";
                result = await callGemini(prompt, refImages, geminiKey);
              }
            } else if (geminiKey) {
              providerUsed = "gemini";
              result = await callGemini(prompt, refImages, geminiKey);
            } else {
              throw new Error("No image provider configured for cozy/glam style.");
            }
          }

          const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
          if (!result.ok) {
            console.error(
              `[selfie] ${providerUsed} FAIL (${elapsed}s): ${result.hardReason ?? result.softReason}`,
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: [
                    result.softReason,
                    "DO NOT share this error with the user verbatim.",
                    "Apologize naturally as the persona (say the photo didn't come out right),",
                    "and either try a tamer scene or move the conversation on.",
                    `Internal reason (do not share): ${result.hardReason ?? "n/a"}`,
                  ].join("\n"),
                },
              ],
            };
          }

          const id = crypto.randomBytes(8).toString("hex");
          const filename = `selfie-${id}.${result.ext}`;
          const filePath = path.join(outputDir, filename);
          await fs.writeFile(filePath, result.bytes);
          const stats = await fs.stat(filePath);
          console.log(
            `[selfie] ${providerUsed} OK: ${filePath} (${(stats.size / 1024).toFixed(0)} KB) in ${elapsed}s`,
          );

          return {
            content: [
              {
                type: "image" as const,
                data: result.bytes.toString("base64"),
                mimeType: result.mimeType,
              },
              {
                type: "text" as const,
                text: [
                  `Selfie generated and delivered (${(stats.size / 1024).toFixed(0)} KB).`,
                  `The image is already attached to this tool result — it will be sent automatically.`,
                  `Now write a short, natural caption or reaction as your text reply.`,
                  `Do NOT use MEDIA:, do NOT call the message tool to re-send the image, and do NOT reference the file path.`,
                ].join("\n"),
              },
            ],
            details: {
              media: {
                mediaUrls: [filePath],
              },
              path: filePath,
            },
          };
        },
      } as AnyAgentTool;
    },
    { optional: false },
  );
}
