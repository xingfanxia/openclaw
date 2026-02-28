import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { listDatabases } from "../notion-client.js";
import type { NotionConfig } from "../types.js";
import { resolveAccount } from "../types.js";

export function createNotionDatabasesTool(config: NotionConfig): AnyAgentTool {
  return {
    name: "notion_databases",
    description:
      "List all databases accessible to the Notion integration. Returns database IDs, titles, URLs, and their property schemas.",
    parameters: Type.Object({
      account_id: Type.Optional(
        Type.String({
          description: "Account to use (e.g. 'work', 'personal'). Defaults to work account.",
        }),
      ),
    }),
    execute: async (_toolCallId: string, params: { account_id?: string }) => {
      const account = resolveAccount(params.account_id, config);
      const databases = await listDatabases(account.integrationToken);

      const result = {
        account: account.id,
        workspace: account.workspace ?? account.id,
        databaseCount: databases.length,
        databases: databases.map((db) => ({
          id: db.id,
          title: db.title,
          url: db.url,
          lastEdited: db.lastEditedTime,
          properties: db.properties,
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  } as AnyAgentTool;
}
