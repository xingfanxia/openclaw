import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import type { ObsidianConfig } from "../types.js";
import { listNotes } from "../vault-client.js";

export function createObsidianListTool(config: ObsidianConfig): AnyAgentTool {
  return {
    name: "obsidian_list",
    description:
      "List notes in the Obsidian vault, optionally filtered by folder. Returns note paths, names, modification dates, and sizes.",
    parameters: Type.Object({
      folder: Type.Optional(
        Type.String({
          description: "Folder to list (relative to vault root). Lists entire vault if omitted.",
        }),
      ),
      recursive: Type.Optional(
        Type.Boolean({ description: "Include notes in subfolders (default: true)", default: true }),
      ),
      max_results: Type.Optional(
        Type.Number({
          description: "Maximum number of notes to return (default: 100)",
          default: 100,
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: { folder?: string; recursive?: boolean; max_results?: number },
    ) => {
      try {
        const notes = listNotes(
          config,
          params.folder,
          params.recursive ?? true,
          params.max_results ?? 100,
        );
        const result = {
          folder: params.folder ?? "/",
          totalNotes: notes.length,
          notes,
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
