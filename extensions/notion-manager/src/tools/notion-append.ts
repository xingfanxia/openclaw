import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import type { NotionConfig } from "../types.js";
import { appendBlocks } from "../notion-client.js";

export function createNotionAppendTool(config: NotionConfig): AnyAgentTool {
  return {
    name: "notion_append",
    description:
      "Append content blocks to an existing Notion page. Adds new blocks at the end of the page without modifying existing content. Supports markdown-style formatting.",
    parameters: Type.Object({
      page_id: Type.String({
        description: "The page ID to append content to",
      }),
      content: Type.String({
        description:
          "Content to append in markdown format. Supports headings (#), lists (- or 1.), code blocks (```), quotes (>), to-dos (- [ ]), and dividers (---)",
      }),
    }),
    execute: async (_toolCallId: string, params: { page_id: string; content: string }) => {
      const { blocksAdded } = await appendBlocks(config, params.page_id, params.content);

      const result = {
        appended: true,
        pageId: params.page_id,
        blocksAdded,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  } as AnyAgentTool;
}
