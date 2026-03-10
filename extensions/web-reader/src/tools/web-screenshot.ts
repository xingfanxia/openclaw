import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { readStringParam } from "../../../../src/agents/tools/common.js";
import type { WebReaderConfig } from "../types.js";
import { resolveBrowserlessBaseUrl } from "../types.js";

const SCREENSHOT_TIMEOUT_MS = 30_000;

const WebScreenshotSchema = Type.Object({
  url: Type.String({ description: "URL to take a screenshot of." }),
  full_page: Type.Optional(
    Type.Boolean({
      description: "Capture the full scrollable page (default: false, viewport only).",
    }),
  ),
});

export function createWebScreenshotTool(config: WebReaderConfig): AnyAgentTool | null {
  if (!config.browserlessToken) {
    return null;
  }

  const baseUrl = resolveBrowserlessBaseUrl(config);
  const token = config.browserlessToken;

  return {
    name: "web_screenshot",
    description:
      "Take a screenshot of a webpage using a headless browser. Returns a PNG image. Use for visually inspecting pages, checking layouts, or seeing content that requires rendering.",
    parameters: WebScreenshotSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const url = readStringParam(params, "url", { required: true });
      const fullPage = typeof params.full_page === "boolean" ? params.full_page : false;

      // Validate URL
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("Invalid URL: must be a valid http or https URL");
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Invalid URL: must be http or https");
      }

      const screenshotUrl = `${baseUrl}/screenshot?token=${token}`;
      const body = {
        url,
        options: {
          fullPage,
          type: "png",
        },
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SCREENSHOT_TIMEOUT_MS);

      let res: Response;
      try {
        res = await fetch(screenshotUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          throw new Error(`Screenshot timed out after ${SCREENSHOT_TIMEOUT_MS / 1000}s`);
        }
        throw new Error(`Screenshot request failed: ${(error as Error).message}`);
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Screenshot failed (${res.status}): ${detail || res.statusText}`);
      }

      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      const result: AgentToolResult<unknown> = {
        content: [
          {
            type: "text",
            text: `Screenshot of ${url} (${fullPage ? "full page" : "viewport"})`,
          },
          {
            type: "image",
            data: base64,
            mimeType: "image/png",
          },
        ],
        details: { url, fullPage },
      };

      return result;
    },
  } as AnyAgentTool;
}
