import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { readPageBlocks, getClient } from "../notion-client.js";
import type { NotionConfig } from "../types.js";
import { resolveAccount } from "../types.js";

export function createNotionReadTool(config: NotionConfig): AnyAgentTool {
  return {
    name: "notion_read",
    description:
      "Read the full content of a Notion page. Converts all blocks (paragraphs, headings, lists, code, etc.) to readable text/markdown format.",
    parameters: Type.Object({
      page_id: Type.String({
        description: "The Notion page ID to read (UUID format, with or without dashes)",
      }),
      account_id: Type.Optional(
        Type.String({
          description: "Account to use (e.g. 'work', 'personal'). Defaults to work account.",
        }),
      ),
    }),
    execute: async (_toolCallId: string, params: { page_id: string; account_id?: string }) => {
      const account = resolveAccount(params.account_id, config);
      const token = account.integrationToken;
      const notion = getClient(token);

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
      const lines = await readPageBlocks(token, params.page_id);

      const result = {
        pageId: params.page_id,
        account: account.id,
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
