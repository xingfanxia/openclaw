import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { createPage } from "../notion-client.js";
import type { NotionConfig } from "../types.js";
import { resolveAccount } from "../types.js";

export function createNotionCreateTool(config: NotionConfig): AnyAgentTool {
  return {
    name: "notion_create",
    description:
      "Create a new page in Notion. The page can be created under an existing page (as a child) or in a database (as a new entry). Supports markdown-style content.",
    parameters: Type.Object({
      parent_id: Type.String({
        description: "ID of the parent page or database where the new page will be created",
      }),
      title: Type.String({
        description: "Title of the new page",
      }),
      content: Type.Optional(
        Type.String({
          description:
            "Page content in markdown format. Supports headings (#), lists (- or 1.), code blocks (```), quotes (>), to-dos (- [ ]), and dividers (---)",
        }),
      ),
      parent_type: Type.Optional(
        Type.Union([Type.Literal("database_id"), Type.Literal("page_id")], {
          description: 'Whether parent_id is a database or page. Defaults to "database_id".',
        }),
      ),
      properties: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description:
            "Database properties to set (for database parents). Use Notion property format.",
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
        parent_id: string;
        title: string;
        content?: string;
        parent_type?: "database_id" | "page_id";
        properties?: Record<string, unknown>;
        account_id?: string;
      },
    ) => {
      const account = resolveAccount(params.account_id, config);
      const parentType = params.parent_type ?? "database_id";
      const page = await createPage(
        account.integrationToken,
        params.parent_id,
        params.title,
        params.content,
        params.properties,
        parentType,
      );

      const result = {
        created: true,
        account: account.id,
        pageId: page.id,
        title: page.title,
        url: page.url,
        parentType: page.parentType,
        parentId: page.parentId,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  } as AnyAgentTool;
}
