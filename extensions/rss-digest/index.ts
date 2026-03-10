import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { handleRssCommand } from "./src/rss-command.js";
import { createRssFetchTool } from "./src/rss-fetch-tool.js";
import type { RssDigestConfig } from "./src/types.js";

export default function register(api: OpenClawPluginApi): void {
  const config = (api.pluginConfig ?? {}) as RssDigestConfig;

  api.registerTool(createRssFetchTool(config));

  api.registerCommand({
    name: "rss",
    acceptsArgs: true,
    description: "Fetch and display recent RSS posts. Usage: /rss [hours=24] [limit=30]",
    handler: async (ctx) => {
      const args = (ctx.args ?? "").trim();
      const text = await handleRssCommand(config, args);
      return { text };
    },
  });

  const feedCount = config.feeds?.length ?? 0;
  const source = config.opmlUrl ? "OPML" : `${feedCount} feeds`;
  console.log(`[rss-digest] Registered: rss_fetch tool, /rss command (${source})`);
}
