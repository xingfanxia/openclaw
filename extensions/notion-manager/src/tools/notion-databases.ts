import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import type { NotionConfig } from "../types.js";
import { listDatabases } from "../notion-client.js";

export function createNotionDatabasesTool(config: NotionConfig): AnyAgentTool {
  return {
    name: "notion_databases",
    description:
      "List all databases accessible to the Notion integration. Returns database IDs, titles, URLs, and their property schemas.",
    parameters: Type.Object({}),
    execute: async (_toolCallId: string, _params: Record<string, never>) => {
      const databases = await listDatabases(config);

      const result = {
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
