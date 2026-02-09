import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import type { ObsidianConfig } from "../types.js";
import { updateNote } from "../vault-client.js";

export function createObsidianUpdateTool(config: ObsidianConfig): AnyAgentTool {
  return {
    name: "obsidian_update",
    description:
      "Update an existing note in the Obsidian vault. Can update content, frontmatter, or both. Frontmatter is merged with existing values.",
    parameters: Type.Object({
      path: Type.String({ description: "Path to the note relative to vault root" }),
      content: Type.Optional(
        Type.String({ description: "New markdown content (replaces existing content)" }),
      ),
      frontmatter: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: "Frontmatter keys to update (merged with existing frontmatter)",
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: { path: string; content?: string; frontmatter?: Record<string, unknown> },
    ) => {
      try {
        const note = updateNote(config, params.path, params.content, params.frontmatter);
        const result = {
          path: note.path,
          name: note.name,
          frontmatter: note.frontmatter,
          tags: note.tags,
          links: note.links,
          lastModified: note.lastModified,
          contentLength: note.content.length,
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
