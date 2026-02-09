import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import type { ObsidianConfig } from "../types.js";
import { writeNote } from "../vault-client.js";

export function createObsidianWriteTool(config: ObsidianConfig): AnyAgentTool {
  return {
    name: "obsidian_write",
    description:
      "Create a new note in the Obsidian vault with optional YAML frontmatter. Parent directories are created automatically.",
    parameters: Type.Object({
      path: Type.String({
        description: "Path for the new note relative to vault root (e.g., 'projects/my-note.md')",
      }),
      content: Type.String({ description: "Markdown content of the note (without frontmatter)" }),
      frontmatter: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description:
            "Optional YAML frontmatter as key-value pairs (e.g., {title: '...', tags: ['a','b']})",
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: { path: string; content: string; frontmatter?: Record<string, unknown> },
    ) => {
      try {
        const result = writeNote(config, params.path, params.content, params.frontmatter);
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
