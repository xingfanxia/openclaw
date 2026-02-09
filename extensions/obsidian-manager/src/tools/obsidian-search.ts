import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import type { ObsidianConfig } from "../types.js";
import { searchNotes } from "../vault-client.js";

export function createObsidianSearchTool(config: ObsidianConfig): AnyAgentTool {
  return {
    name: "obsidian_search",
    description:
      "Search notes in the Obsidian vault by filename, content, and optionally filter by tags. Returns matching notes ranked by relevance.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query to match against filenames and content" }),
      folder: Type.Optional(
        Type.String({ description: "Limit search to a specific folder (relative to vault root)" }),
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: "Filter results to notes containing at least one of these tags",
        }),
      ),
      max_results: Type.Optional(
        Type.Number({
          description: "Maximum number of results to return (default: 20)",
          default: 20,
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: { query: string; folder?: string; tags?: string[]; max_results?: number },
    ) => {
      try {
        const results = searchNotes(
          config,
          params.query,
          params.folder,
          params.tags,
          params.max_results ?? 20,
        );
        const result = {
          query: params.query,
          totalResults: results.length,
          results,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const result = { error: message };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }
    },
  } as AnyAgentTool;
}
