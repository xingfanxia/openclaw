import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { getCalendarStatuses, formatCalendarStatusText } from "./src/commands/calendar-status.js";
import { createCalendarAgendaTool } from "./src/tools/calendar-agenda.js";
import { createCalendarCreateTool } from "./src/tools/calendar-create.js";
import { createCalendarDeleteTool } from "./src/tools/calendar-delete.js";
import { createCalendarEventsTool } from "./src/tools/calendar-events.js";
import { createCalendarListTool } from "./src/tools/calendar-list.js";
import { createCalendarQuickAddTool } from "./src/tools/calendar-quick-add.js";
import { createCalendarUpdateTool } from "./src/tools/calendar-update.js";
import type { PluginConfig } from "./src/types.js";

export default function register(api: OpenClawPluginApi): void {
  const config = (api.pluginConfig ?? {}) as PluginConfig;
  const { accounts, oauth } = config;
  // Prefer the global user timezone from agents.defaults, fall back to plugin config, then PST.
  const defaultTimezone =
    api.config.agents?.defaults?.userTimezone?.trim() ||
    config.defaultTimezone ||
    "America/Los_Angeles";
  const defaultAccount = config.defaultAccount ?? accounts[0]?.id ?? "work";
  const aliases = config.accountAliases ?? {};

  // Register 7 tools
  api.registerTool(createCalendarListTool(oauth, accounts, defaultAccount, aliases));
  api.registerTool(
    createCalendarEventsTool(oauth, accounts, defaultTimezone, defaultAccount, aliases),
  );
  api.registerTool(
    createCalendarCreateTool(oauth, accounts, defaultTimezone, defaultAccount, aliases),
  );
  api.registerTool(
    createCalendarUpdateTool(oauth, accounts, defaultTimezone, defaultAccount, aliases),
  );
  api.registerTool(createCalendarDeleteTool(oauth, accounts, defaultAccount, aliases));
  api.registerTool(createCalendarQuickAddTool(oauth, accounts, defaultAccount, aliases));
  api.registerTool(
    createCalendarAgendaTool(oauth, accounts, defaultTimezone, defaultAccount, aliases),
  );

  // Register commands
  api.registerCommand({
    name: "calendar_status",
    acceptsArgs: true,
    description: "Show Google Calendar access status for all configured accounts",
    handler: async () => {
      const statuses = await getCalendarStatuses(oauth, accounts);
      return { text: formatCalendarStatusText(statuses) };
    },
  });

  console.log(
    `[calendar-manager] Registered: ${accounts.length} accounts, 7 tools, 1 command (default: ${defaultAccount})`,
  );
}
