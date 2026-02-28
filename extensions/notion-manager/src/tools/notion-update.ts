import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { updatePage } from "../notion-client.js";
import type { NotionConfig } from "../types.js";
import { resolveAccount } from "../types.js";

export function createNotionUpdateTool(config: NotionConfig): AnyAgentTool {
  return {
    name: "notion_update",
    description:
      "Update a Notion page's properties or archive/unarchive it. Can modify database entry properties or archive pages.",
    parameters: Type.Object({
      page_id: Type.String({
        description: "The page ID to update",
      }),
      properties: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: "Properties to update, in Notion property format",
        }),
      ),
      archived: Type.Optional(
        Type.Boolean({
          description: "Set to true to archive the page, false to unarchive",
        }),
      ),
      account_id: Type.Optional(
        Type.String({
          description: "Account to use (e.g. 'work', 'personal'). Defaults to work account.",
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        page_id: string;
        properties?: Record<string, unknown>;
        archived?: boolean;
        account_id?: string;
      },
    ) => {
      const account = resolveAccount(params.account_id, config);
      const page = await updatePage(
        account.integrationToken,
        params.page_id,
        params.properties,
        params.archived,
      );

      const result = {
        updated: true,
        account: account.id,
        pageId: page.id,
        title: page.title,
        url: page.url,
        archived: page.archived,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  } as AnyAgentTool;
}
