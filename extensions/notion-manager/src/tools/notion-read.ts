import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import type { NotionConfig } from "../types.js";
import { readPageBlocks, getClient } from "../notion-client.js";

export function createNotionReadTool(config: NotionConfig): AnyAgentTool {
  return {
    name: "notion_read",
    description:
      "Read the full content of a Notion page. Converts all blocks (paragraphs, headings, lists, code, etc.) to readable text/markdown format.",
    parameters: Type.Object({
      page_id: Type.String({
        description: "The Notion page ID to read (UUID format, with or without dashes)",
      }),
    }),
    execute: async (_toolCallId: string, params: { page_id: string }) => {
      const notion = getClient(config);

      // Get page metadata
      const page = await notion.pages.retrieve({ page_id: params.page_id });
      const p = page as unknown as Record<string, unknown>;
      const props = (p.properties ?? {}) as Record<string, unknown>;

      // Extract title
      let title = "Untitled";
      for (const val of Object.values(props)) {
        const prop = val as Record<string, unknown>;
        if (prop.type === "title") {
          const titleArr = prop.title as Array<{ plain_text: string }> | undefined;
          if (titleArr && titleArr.length > 0) {
            title = titleArr.map((t) => t.plain_text).join("");
          }
          break;
        }
      }

      // Read all blocks
      const lines = await readPageBlocks(config, params.page_id);

      const result = {
        pageId: params.page_id,
        title,
        url: p.url as string,
        lastEdited: p.last_edited_time as string,
        content: lines.join("\n"),
        blockCount: lines.length,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  } as AnyAgentTool;
}
