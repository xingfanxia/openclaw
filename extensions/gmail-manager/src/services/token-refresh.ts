import type { OAuthConfig } from "../oauth2.js";
import { refreshAccessToken } from "../oauth2.js";
import { loadTokens, setToken, isTokenExpired } from "../token-store.js";

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

let refreshTimer: ReturnType<typeof setInterval> | null = null;

async function refreshAllTokens(oauthConfig: OAuthConfig): Promise<void> {
  const tokens = loadTokens();

  for (const [accountId, token] of Object.entries(tokens)) {
    if (isTokenExpired(token)) {
      try {
        const refreshed = await refreshAccessToken(oauthConfig, token.refreshToken);
        setToken({
          ...token,
          accessToken: refreshed.accessToken,
          expiryDate: refreshed.expiryDate,
        });
        console.log(`[gmail-manager] Refreshed token for account: ${accountId}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[gmail-manager] Failed to refresh token for ${accountId}: ${message}`);
      }
    }
  }
}

export function startTokenRefreshService(oauthConfig: OAuthConfig): void {
  if (refreshTimer) {
    return;
  }

  // Refresh immediately on start
  refreshAllTokens(oauthConfig).catch((err) => {
    console.error("[gmail-manager] Initial token refresh failed:", err);
  });

  // Then refresh periodically
  refreshTimer = setInterval(() => {
    refreshAllTokens(oauthConfig).catch((err) => {
      console.error("[gmail-manager] Periodic token refresh failed:", err);
    });
  }, REFRESH_INTERVAL_MS);

  console.log(
    `[gmail-manager] Token refresh service started (interval: ${REFRESH_INTERVAL_MS / 60000}min)`,
  );
}

export function stopTokenRefreshService(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
    console.log("[gmail-manager] Token refresh service stopped");
  }
}
