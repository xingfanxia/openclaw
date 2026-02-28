import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { getVaultStatus } from "./src/commands/obsidian-status.js";
import { handleObsidianSync } from "./src/commands/obsidian-sync-cmd.js";
import { createObsidianLinksTool } from "./src/tools/obsidian-links.js";
import { createObsidianListTool } from "./src/tools/obsidian-list.js";
import { createObsidianReadTool } from "./src/tools/obsidian-read.js";
import { createObsidianSearchTool } from "./src/tools/obsidian-search.js";
import { createObsidianSyncTool } from "./src/tools/obsidian-sync.js";
import { createObsidianTagsTool } from "./src/tools/obsidian-tags.js";
import { createObsidianUpdateTool } from "./src/tools/obsidian-update.js";
import { createObsidianWriteTool } from "./src/tools/obsidian-write.js";
import type { ObsidianConfig } from "./src/types.js";

export default function register(api: OpenClawPluginApi): void {
  const config = (api.pluginConfig ?? {}) as ObsidianConfig;

  if (!config.vaultPath) {
    console.warn("[obsidian-manager] No vaultPath configured — tools will not function.");
  }

  // Register 8 tools
  api.registerTool(createObsidianSearchTool(config));
  api.registerTool(createObsidianReadTool(config));
  api.registerTool(createObsidianWriteTool(config));
  api.registerTool(createObsidianUpdateTool(config));
  api.registerTool(createObsidianListTool(config));
  api.registerTool(createObsidianTagsTool(config));
  api.registerTool(createObsidianLinksTool(config));
  api.registerTool(createObsidianSyncTool(config));

  // Register 2 commands
  api.registerCommand({
    name: "obsidian_status",
    acceptsArgs: false,
    description: "Show Obsidian vault info: note count, folder count, size, and git status",
    handler: async () => {
      const text = await getVaultStatus(config);
      return { text };
    },
  });

  api.registerCommand({
    name: "obsidian_sync",
    acceptsArgs: true,
    description:
      "Trigger git sync for the Obsidian vault. Usage: /obsidian_sync [pull|push|sync|status] (default: sync)",
    handler: async (ctx) => {
      const args = (ctx.args ?? "").trim();
      return handleObsidianSync(config, args);
    },
  });

  console.log(
    `[obsidian-manager] Registered: vault=${config.vaultPath ?? "NOT SET"}, 8 tools, 2 commands`,
  );
}
