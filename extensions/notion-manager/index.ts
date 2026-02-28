import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { getNotionStatus } from "./src/commands/notion-status.js";
import { createNotionAppendTool } from "./src/tools/notion-append.js";
import { createNotionCommentsTool } from "./src/tools/notion-comments.js";
import { createNotionCreateTool } from "./src/tools/notion-create.js";
import { createNotionDatabaseQueryTool } from "./src/tools/notion-database-query.js";
import { createNotionDatabasesTool } from "./src/tools/notion-databases.js";
import { createNotionReadTool } from "./src/tools/notion-read.js";
import { createNotionSearchTool } from "./src/tools/notion-search.js";
import { createNotionUpdateTool } from "./src/tools/notion-update.js";
import type { NotionConfig } from "./src/types.js";

export default function register(api: OpenClawPluginApi): void {
  const raw = (api.pluginConfig ?? {}) as Record<string, unknown>;

  // Build config with defaults
  const config: NotionConfig = {
    accounts: (raw.accounts ?? []) as NotionConfig["accounts"],
    defaultAccount: (raw.defaultAccount ?? "") as string,
    accountAliases: (raw.accountAliases ?? {}) as Record<string, string>,
  };

  // Validate at least one account exists
  if (config.accounts.length === 0) {
    console.warn("[notion-manager] No accounts configured. Add accounts to plugin config.");
  }

  // Default to first account if defaultAccount not set
  if (!config.defaultAccount && config.accounts.length > 0) {
    config.defaultAccount = config.accounts[0].id;
  }

  // Register 8 tools
  api.registerTool(createNotionSearchTool(config));
  api.registerTool(createNotionReadTool(config));
  api.registerTool(createNotionCreateTool(config));
  api.registerTool(createNotionUpdateTool(config));
  api.registerTool(createNotionDatabasesTool(config));
  api.registerTool(createNotionDatabaseQueryTool(config));
  api.registerTool(createNotionCommentsTool(config));
  api.registerTool(createNotionAppendTool(config));

  // Register command
  api.registerCommand({
    name: "notion_status",
    acceptsArgs: false,
    description: "Test Notion connection and show workspace info for all accounts",
    handler: async () => {
      const text = await getNotionStatus(config);
      return { text };
    },
  });

  const accountNames = config.accounts.map((a) => a.id).join(", ");
  console.log(
    `[notion-manager] Registered: 8 tools, 1 command (accounts: ${accountNames || "none"}, default: ${config.defaultAccount || "none"})`,
  );
}
