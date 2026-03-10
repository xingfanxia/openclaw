import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { createWebReadTool } from "./src/tools/web-read.js";
import { createWebScreenshotTool } from "./src/tools/web-screenshot.js";
import type { WebReaderConfig } from "./src/types.js";

export default function register(api: OpenClawPluginApi): void {
  const raw = (api.pluginConfig ?? {}) as Record<string, unknown>;

  const config: WebReaderConfig = {
    browserlessToken: typeof raw.browserlessToken === "string" ? raw.browserlessToken : undefined,
    browserlessBaseUrl:
      typeof raw.browserlessBaseUrl === "string" ? raw.browserlessBaseUrl : undefined,
    jinaApiKey: typeof raw.jinaApiKey === "string" ? raw.jinaApiKey : undefined,
  };

  const tools: string[] = [];

  // web_fetch via Jina Reader (replaces built-in web_fetch)
  api.registerTool(createWebReadTool(config));
  tools.push("web_fetch");

  // web_screenshot requires browserless token
  const screenshotTool = createWebScreenshotTool(config);
  if (screenshotTool) {
    api.registerTool(screenshotTool);
    tools.push("web_screenshot");
  }

  console.log(`[web-reader] Registered: ${tools.length} tools (${tools.join(", ")})`);
}
