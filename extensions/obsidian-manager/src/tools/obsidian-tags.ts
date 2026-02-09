import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import type { ObsidianConfig } from "../types.js";
import { getAllTags, findNotesByTag } from "../vault-client.js";

export function createObsidianTagsTool(config: ObsidianConfig): AnyAgentTool {
  return {
    name: "obsidian_tags",
    description:
      "List all tags in the vault with counts, or find all notes that have a specific tag.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list_all"), Type.Literal("find_by_tag")], {
        description:
          "Action: 'list_all' to list all tags, 'find_by_tag' to find notes with a specific tag",
      }),
      tag: Type.Optional(
        Type.String({ description: "Tag to search for (required when action is 'find_by_tag')" }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: { action: "list_all" | "find_by_tag"; tag?: string },
    ) => {
      try {
        if (params.action === "list_all") {
          const tagCounts = getAllTags(config);
          const sorted = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([tag, count]) => ({ tag, count }));
          const result = { action: "list_all", totalTags: sorted.length, tags: sorted };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        } else {
          if (!params.tag) {
            const result = { error: "Parameter 'tag' is required when action is 'find_by_tag'" };
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
              details: result,
            };
          }
          const notes = findNotesByTag(config, params.tag);
          const result = {
            action: "find_by_tag",
            tag: params.tag,
            totalNotes: notes.length,
            notes,
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        }
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
