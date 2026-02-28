import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import {
  jsonResult,
  readNumberParam,
  readStringParam,
} from "../../../../src/agents/tools/common.js";
import { wrapWebContent } from "../../../../src/security/external-content.js";
import type { WebReaderConfig } from "../types.js";

const DEFAULT_MAX_CHARS = 10_000;
const JINA_TIMEOUT_MS = 30_000;

const WebReadSchema = Type.Object({
  url: Type.String({ description: "URL to read and extract content from." }),
  max_chars: Type.Optional(
    Type.Number({
      description: "Maximum characters to return (default 10000).",
      minimum: 100,
    }),
  ),
});

interface JinaResponse {
  code: number;
  status: number;
  data?: {
    title?: string;
    description?: string;
    url?: string;
    content?: string;
    usage?: { tokens?: number };
  };
}

export function createWebReadTool(config: WebReaderConfig): AnyAgentTool {
  return {
    name: "web_fetch",
    description:
      "Fetch and extract readable content from a URL. Handles JS-rendered pages (SPAs, dynamic content). Returns structured text with title, description, and main content. Use for reading articles, docs, or any webpage.",
    parameters: WebReadSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const url = readStringParam(params, "url", { required: true });
      const maxChars = readNumberParam(params, "max_chars", { integer: true }) ?? DEFAULT_MAX_CHARS;

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

      const jinaUrl = `https://r.jina.ai/${url}`;
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (config.jinaApiKey) {
        headers.Authorization = `Bearer ${config.jinaApiKey}`;
      }

      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);

      let res: Response;
      try {
        res = await fetch(jinaUrl, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          throw new Error(`Jina Reader timed out after ${JINA_TIMEOUT_MS / 1000}s`);
        }
        throw new Error(`Jina Reader request failed: ${(error as Error).message}`);
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Jina Reader failed (${res.status}): ${detail || res.statusText}`);
      }

      const body = (await res.json()) as JinaResponse;
      const data = body.data;
      if (!data?.content) {
        throw new Error("Jina Reader returned no content for this URL");
      }

      // Truncate content to max_chars
      const content =
        data.content.length > maxChars
          ? `${data.content.slice(0, maxChars)}\n\n[truncated]`
          : data.content;

      // Wrap external content for security
      const wrappedContent = wrapWebContent(content, "web_fetch");

      const payload = {
        url,
        title: data.title ?? undefined,
        description: data.description ?? undefined,
        extractedUrl: data.url ?? url,
        contentLength: data.content.length,
        truncated: data.content.length > maxChars,
        maxChars,
        tookMs: Date.now() - start,
        externalContent: {
          untrusted: true,
          source: "web_fetch",
          wrapped: true,
        },
        text: wrappedContent,
      };

      return jsonResult(payload);
    },
  } as AnyAgentTool;
}
