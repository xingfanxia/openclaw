// Single-call dispatch for the selfie plugin — the new entry point that
// replaces the ad-hoc routing in index.ts's tool handler.
//
// Pipeline:
//   1. stripTextOverlay      — drop any agent-authored "render text" asks
//   2. stripIntensifiers     — drop persona-spicy adjectives that trip CV
//   3. classifyScene          — composition / wardrobeRisk / geminiSafe
//   4. selectRoute            — provider + fallback + promptMode
//   5. buildMinimalPrompt or buildV2WrapPrompt
//   6. call primary → (fallback if present) → (wrap-rescue if eligible)
//   7. return image + rich metadata for logging / agent explain-back
//
// Wrap-rescue policy (step 6 correction):
//   - Only doubao. Wrap on gemini amplifies classifier score (step 4b: 6%).
//   - Only wardrobe-trigger. Body-part-trigger scenes regressed under wrap
//     (step 6 S2: 3/5 → 0/5). Safe scenes don't need rescue.
//   - Only minimal-was-primary. If the first attempt was already v2-wrap
//     (e.g. grid mode), there's no rescue path to try.

import type { Buffer } from "node:buffer";
import { classifyScene, type SceneClassification } from "./classify.ts";
import { stripIntensifiers } from "./intensifier-strip.ts";
import { buildMinimalPrompt, buildV2WrapPrompt } from "./prompt-assembly.ts";
import {
  type Provider,
  type ProviderRoute,
  selectRoute,
  type PromptMode,
} from "./provider-routing.ts";
import {
  callDoubao as callDoubaoReal,
  callGemini as callGeminiReal,
  callGptImage2 as callGptImage2Real,
  type GenResult,
  type GptImage2Creds,
  type RefImage,
} from "./providers.ts";
import { stripTextOverlay } from "./text-overlay.ts";
import type { SelfieCount, SelfieStyle } from "./types.ts";

export interface DispatchCreds {
  doubao?: string;
  gemini?: string;
  gptImage2?: GptImage2Creds;
}

export interface DispatchRequest {
  scene: string;
  style: SelfieStyle;
  count: SelfieCount;
  refs: RefImage[];
  creds: DispatchCreds;
}

export interface DispatchAttempt {
  provider: Provider;
  promptMode: PromptMode;
  ok: boolean;
  hardReason?: string;
}

export interface DispatchMetadata {
  /** Original scene before any stripping. */
  originalScene: string;
  /** Post-strip scene actually sent to the provider. */
  cleanScene: string;
  /** True if stripTextOverlay modified the scene. */
  textOverlayStripped: boolean;
  /** True if stripIntensifiers modified the scene. */
  intensifiersStripped: boolean;
  /** Concrete intensifier phrases stripped (for route-log telemetry). */
  strippedIntensifiers: string[];
  classification: SceneClassification;
  route: ProviderRoute;
  attempts: DispatchAttempt[];
  /** Provider that returned the successful image (undefined if all attempts failed). */
  providerUsed?: Provider;
  /** Prompt mode used for the successful call. */
  promptModeUsed?: PromptMode;
  /** True if the wrap-rescue path was triggered (whether it succeeded or not). */
  wrapRescueTriggered: boolean;
}

export type DispatchResult =
  | {
      ok: true;
      bytes: Buffer;
      ext: "png" | "jpeg";
      mimeType: string;
      metadata: DispatchMetadata;
    }
  | {
      ok: false;
      softReason: string;
      hardReason?: string;
      metadata: DispatchMetadata;
    };

export interface DispatchDeps {
  callDoubao?: (prompt: string, refs: RefImage[], apiKey: string) => Promise<GenResult>;
  callGemini?: (prompt: string, refs: RefImage[], apiKey: string) => Promise<GenResult>;
  callGptImage2?: (prompt: string, refs: RefImage[], creds: GptImage2Creds) => Promise<GenResult>;
}

async function callProvider(
  provider: Provider,
  prompt: string,
  req: DispatchRequest,
  deps: Required<DispatchDeps>,
): Promise<GenResult> {
  switch (provider) {
    case "doubao":
      if (!req.creds.doubao) {
        return {
          ok: false,
          softReason: "Doubao not configured.",
          hardReason: "missing doubao credentials",
        };
      }
      return deps.callDoubao(prompt, req.refs, req.creds.doubao);
    case "gemini":
      if (!req.creds.gemini) {
        return {
          ok: false,
          softReason: "Gemini not configured.",
          hardReason: "missing gemini credentials",
        };
      }
      return deps.callGemini(prompt, req.refs, req.creds.gemini);
    case "gpt-image-2": {
      const creds = req.creds.gptImage2;
      if (!creds || (!creds.azure && !creds.direct)) {
        return {
          ok: false,
          softReason: "gpt-image-2 not configured.",
          hardReason: "missing azure or direct openai credentials",
        };
      }
      return deps.callGptImage2(prompt, req.refs, creds);
    }
    default:
      return {
        ok: false,
        softReason: "Unknown provider.",
        hardReason: `unknown provider: ${provider as string}`,
      };
  }
}

function buildPromptForMode(mode: PromptMode, req: DispatchRequest, cleanScene: string): string {
  return mode === "v2-wrap"
    ? buildV2WrapPrompt(cleanScene, req.style, req.count)
    : buildMinimalPrompt(cleanScene);
}

export async function dispatchSelfie(
  req: DispatchRequest,
  deps?: DispatchDeps,
): Promise<DispatchResult> {
  const resolvedDeps: Required<DispatchDeps> = {
    callDoubao: deps?.callDoubao ?? callDoubaoReal,
    callGemini: deps?.callGemini ?? callGeminiReal,
    callGptImage2: deps?.callGptImage2 ?? callGptImage2Real,
  };

  const originalScene = req.scene;
  const afterOverlay = stripTextOverlay(originalScene);
  const textOverlayStripped = afterOverlay !== originalScene.trim();

  const { scene: cleanScene, stripped: strippedIntensifiers } = stripIntensifiers(afterOverlay);
  const intensifiersStripped = strippedIntensifiers.length > 0;

  const classification = classifyScene(cleanScene);
  const route = selectRoute(req.style, classification, req.count);
  const attempts: DispatchAttempt[] = [];

  const prompt = buildPromptForMode(route.promptMode, req, cleanScene);

  let result = await callProvider(route.primary, prompt, req, resolvedDeps);
  attempts.push({
    provider: route.primary,
    promptMode: route.promptMode,
    ok: result.ok,
    hardReason: result.ok ? undefined : result.hardReason,
  });

  if (!result.ok && route.fallback) {
    result = await callProvider(route.fallback, prompt, req, resolvedDeps);
    attempts.push({
      provider: route.fallback,
      promptMode: route.promptMode,
      ok: result.ok,
      hardReason: result.ok ? undefined : result.hardReason,
    });
  }

  let wrapRescueTriggered = false;
  if (
    !result.ok &&
    route.wrapRescueEligible &&
    route.primary === "doubao" &&
    route.promptMode === "minimal-10line"
  ) {
    const wrappedPrompt = buildV2WrapPrompt(cleanScene, req.style, req.count);
    result = await callProvider("doubao", wrappedPrompt, req, resolvedDeps);
    wrapRescueTriggered = true;
    attempts.push({
      provider: "doubao",
      promptMode: "v2-wrap",
      ok: result.ok,
      hardReason: result.ok ? undefined : result.hardReason,
    });
  }

  const metadata: DispatchMetadata = {
    originalScene,
    cleanScene,
    textOverlayStripped,
    intensifiersStripped,
    strippedIntensifiers,
    classification,
    route,
    attempts,
    wrapRescueTriggered,
  };

  if (result.ok) {
    const lastAttempt = attempts[attempts.length - 1];
    metadata.providerUsed = lastAttempt.provider;
    metadata.promptModeUsed = lastAttempt.promptMode;
    return {
      ok: true,
      bytes: result.bytes,
      ext: result.ext,
      mimeType: result.mimeType,
      metadata,
    };
  }
  return {
    ok: false,
    softReason: result.softReason,
    hardReason: result.hardReason,
    metadata,
  };
}
