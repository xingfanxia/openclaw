import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { createVideoDownloadTool } from "./src/tools/video-download.js";
import type { YtDownloaderConfig } from "./src/types.js";

export default function register(api: OpenClawPluginApi): void {
  const config = (api.pluginConfig ?? {}) as YtDownloaderConfig;
  const { accounts, oauth } = config;

  api.registerTool(createVideoDownloadTool(oauth, accounts, config));

  console.log(
    `[yt-downloader] Registered: ${accounts?.length ?? 0} accounts, 1 tool (video_download)`,
  );
}
