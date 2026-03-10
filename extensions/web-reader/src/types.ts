export interface WebReaderConfig {
  browserlessToken?: string;
  browserlessBaseUrl?: string;
  jinaApiKey?: string;
}

const DEFAULT_BROWSERLESS_BASE_URL = "https://chrome.browserless.io";

export function resolveBrowserlessBaseUrl(config: WebReaderConfig): string {
  return config.browserlessBaseUrl?.trim() || DEFAULT_BROWSERLESS_BASE_URL;
}
