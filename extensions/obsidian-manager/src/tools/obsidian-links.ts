import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import type { ObsidianConfig } from "../types.js";
import { readNote, findBacklinks } from "../vault-client.js";

export function createObsidianLinksTool(config: ObsidianConfig): AnyAgentTool {
  return {
    name: "obsidian_links",
    description:
      "Show forward wikilinks from a note and backlinks (other notes that link to it). Useful for exploring the knowledge graph.",
    parameters: Type.Object({
      path: Type.String({ description: "Path to the note relative to vault root" }),
    }),
    execute: async (_toolCallId: string, params: { path: string }) => {
      try {
        const note = readNote(config, params.path);
        const backlinks = findBacklinks(config, params.path);

        const result = {
          path: params.path,
          name: note.name,
          forwardLinks: note.links.map((l) => ({
            target: l.target,
            display: l.display,
          })),
          backlinks: backlinks.map((b) => ({
            path: b.path,
            name: b.name,
            context: b.context,
          })),
          forwardCount: note.links.length,
          backlinkCount: backlinks.length,
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
