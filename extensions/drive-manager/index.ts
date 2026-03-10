import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { getDriveStatuses, formatDriveStatusText } from "./src/commands/drive-status.js";
import { createDriveCreateTool } from "./src/tools/drive-create.js";
import { createDriveInfoTool } from "./src/tools/drive-info.js";
import { createDriveListTool } from "./src/tools/drive-list.js";
import { createDriveReadTool } from "./src/tools/drive-read.js";
import { createDriveSearchTool } from "./src/tools/drive-search.js";
import { createDriveShareTool } from "./src/tools/drive-share.js";
import { createDriveUpdateTool } from "./src/tools/drive-update.js";
import { createDriveUploadTool } from "./src/tools/drive-upload.js";
import type { DriveConfig } from "./src/types.js";

export default function register(api: OpenClawPluginApi): void {
  const config = (api.pluginConfig ?? {}) as DriveConfig;
  const { accounts, oauth } = config;

  // Register 8 tools
  api.registerTool(createDriveSearchTool(oauth, accounts, config));
  api.registerTool(createDriveListTool(oauth, accounts, config));
  api.registerTool(createDriveReadTool(oauth, accounts, config));
  api.registerTool(createDriveCreateTool(oauth, accounts, config));
  api.registerTool(createDriveUploadTool(oauth, accounts, config));
  api.registerTool(createDriveUpdateTool(oauth, accounts, config));
  api.registerTool(createDriveShareTool(oauth, accounts, config));
  api.registerTool(createDriveInfoTool(oauth, accounts, config));

  // Register command
  api.registerCommand({
    name: "drive_status",
    acceptsArgs: true,
    description:
      "Show Google Drive storage quota and connection status for all configured accounts",
    handler: async () => {
      const statuses = await getDriveStatuses(oauth, accounts);
      return { text: formatDriveStatusText(statuses) };
    },
  });

  console.log(`[drive-manager] Registered: ${accounts.length} accounts, 8 tools, 1 command`);
}
