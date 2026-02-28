import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { queryDatabase } from "../notion-client.js";
import type { NotionConfig } from "../types.js";
import { resolveAccount } from "../types.js";

export function createNotionDatabaseQueryTool(config: NotionConfig): AnyAgentTool {
  return {
    name: "notion_database_query",
    description:
      "Query a Notion database with optional filters and sorts. Returns pages (entries) matching the criteria. Use notion_databases first to find database IDs and property schemas.",
    parameters: Type.Object({
      database_id: Type.String({
        description: "The database ID to query",
      }),
      filter: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description:
            'Notion filter object. Example: {"property": "Status", "select": {"equals": "Done"}}',
        }),
      ),
      sort: Type.Optional(
        Type.Array(Type.Record(Type.String(), Type.Unknown()), {
          description:
            'Sort criteria. Example: [{"property": "Created", "direction": "descending"}]',
        }),
      ),
      max_results: Type.Optional(
        Type.Number({
          description: "Maximum number of results to return (default: 50, max: 100)",
          default: 50,
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
        database_id: string;
        filter?: Record<string, unknown>;
        sort?: Array<Record<string, unknown>>;
        max_results?: number;
        account_id?: string;
      },
    ) => {
      const account = resolveAccount(params.account_id, config);
      const pages = await queryDatabase(
        account.integrationToken,
        params.database_id,
        params.filter,
        params.sort,
        params.max_results ?? 50,
      );

      const result = {
        account: account.id,
        databaseId: params.database_id,
        resultCount: pages.length,
        pages: pages.map((p) => ({
          id: p.id,
          title: p.title,
          url: p.url,
          lastEdited: p.lastEditedTime,
          archived: p.archived,
          properties: p.properties,
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  } as AnyAgentTool;
}
