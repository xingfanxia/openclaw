import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { searchNotion } from "../notion-client.js";
import type { NotionConfig } from "../types.js";
import { resolveAccount } from "../types.js";

export function createNotionSearchTool(config: NotionConfig): AnyAgentTool {
  return {
    name: "notion_search",
    description:
      "Search for pages and databases in Notion by title or content. Returns matching pages and databases with their IDs, titles, and URLs.",
    parameters: Type.Object({
      query: Type.String({
        description: "Search query to find pages or databases by title/content",
      }),
      filter_type: Type.Optional(
        Type.Union([Type.Literal("page"), Type.Literal("database")], {
          description: "Filter results to only pages or only databases. Omit to search both.",
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
      params: { query: string; filter_type?: "page" | "database"; account_id?: string },
    ) => {
      const account = resolveAccount(params.account_id, config);
      const results = await searchNotion(
        account.integrationToken,
        params.query,
        params.filter_type,
      );
      const result = {
        query: params.query,
        account: account.id,
        workspace: account.workspace ?? account.id,
        resultCount: results.length,
        results: results.map((r) => ({
          id: r.id,
          title: r.title,
          url: r.url,
          type:
            "properties" in r &&
            "type" in (Object.values((r as Record<string, unknown>).properties ?? {})[0] ?? {})
              ? "database"
              : "page",
          lastEdited: r.lastEditedTime,
        })),
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  } as AnyAgentTool;
}
