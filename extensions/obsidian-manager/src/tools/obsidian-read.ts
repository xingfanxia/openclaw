import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import type { ObsidianConfig } from "../types.js";
import { readNote } from "../vault-client.js";

export function createObsidianReadTool(config: ObsidianConfig): AnyAgentTool {
  return {
    name: "obsidian_read",
    description:
      "Read a note from the Obsidian vault. Returns the full content, parsed frontmatter, tags, and wikilinks.",
    parameters: Type.Object({
      path: Type.String({
        description: "Path to the note relative to vault root (e.g., 'folder/note.md')",
      }),
    }),
    execute: async (_toolCallId: string, params: { path: string }) => {
      try {
        const note = readNote(config, params.path);
        const result = {
          path: note.path,
          name: note.name,
          frontmatter: note.frontmatter,
          content: note.content,
          tags: note.tags,
          links: note.links,
          lastModified: note.lastModified,
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
