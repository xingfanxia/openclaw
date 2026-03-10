import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { handleGmailAuth } from "./src/commands/gmail-auth.js";
import { getAccountStatuses, formatStatusText } from "./src/commands/gmail-status.js";
import { exchangeCodeForTokens } from "./src/oauth2.js";
import { startTokenRefreshService, stopTokenRefreshService } from "./src/services/token-refresh.js";
import { getToken, setToken } from "./src/token-store.js";
import { createGmailBlockTool } from "./src/tools/gmail-block.js";
import { createGmailCheckTool } from "./src/tools/gmail-check.js";
import { createGmailFilterTool } from "./src/tools/gmail-filter.js";
import { createGmailLabelsTool } from "./src/tools/gmail-labels.js";
import { createGmailManageTool } from "./src/tools/gmail-manage.js";
import { createGmailReadTool } from "./src/tools/gmail-read.js";
import { createGmailSearchTool } from "./src/tools/gmail-search.js";
import { createGmailSendTool } from "./src/tools/gmail-send.js";
import { createGmailUnsubscribeTool } from "./src/tools/gmail-unsubscribe.js";

interface AccountConfig {
  id: string;
  email: string;
  type: string;
}

interface PluginConfig {
  accounts: AccountConfig[];
  oauth: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  cron?: {
    enabled?: boolean;
    schedule?: string;
    channels?: string[];
  };
}

export default function register(api: OpenClawPluginApi): void {
  const config = (api.pluginConfig ?? {}) as PluginConfig;
  const { accounts, oauth } = config;

  // Register tools
  api.registerTool(createGmailCheckTool(oauth, accounts));
  api.registerTool(createGmailUnsubscribeTool(oauth, accounts));
  api.registerTool(createGmailBlockTool(oauth, accounts));
  api.registerTool(createGmailSendTool(oauth, accounts));
  api.registerTool(createGmailSearchTool(oauth, accounts));
  api.registerTool(createGmailFilterTool(oauth, accounts));
  api.registerTool(createGmailLabelsTool(oauth, accounts));
  api.registerTool(createGmailReadTool(oauth, accounts));
  api.registerTool(createGmailManageTool(oauth, accounts));

  // Register commands
  api.registerCommand({
    name: "gmail_status",
    acceptsArgs: true,
    description: "Show Gmail account connection status for all configured accounts",
    handler: async () => {
      const statuses = await getAccountStatuses(oauth, accounts);
      return { text: formatStatusText(statuses) };
    },
  });

  api.registerCommand({
    name: "gmail_auth",
    acceptsArgs: true,
    description: "Start OAuth flow for a Gmail account. Usage: /gmail_auth <account-id>",
    handler: async (ctx) => {
      const accountId = (ctx.args ?? "").trim();
      return handleGmailAuth(oauth, accounts, accountId);
    },
  });

  // Register OAuth callback HTTP route
  api.registerHttpRoute({
    path: "/auth/gmail/callback",
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? "", `http://${req.headers.host}`);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<html><body><h1>Authorization Failed</h1><p>Error: ${error}</p></body></html>`);
          return;
        }

        if (!code || !state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(
            `<html><body><h1>Bad Request</h1><p>Missing code or state parameter</p></body></html>`,
          );
          return;
        }

        const accountId = state;
        const account = accounts.find((a) => a.id === accountId);

        if (!account) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(
            `<html><body><h1>Bad Request</h1><p>Unknown account: ${accountId}</p></body></html>`,
          );
          return;
        }

        const tokens = await exchangeCodeForTokens(oauth, code);

        setToken({
          accountId,
          email: account.email,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiryDate: tokens.expiryDate,
          updatedAt: new Date().toISOString(),
        });

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<html><body>` +
            `<h1>Gmail Authorization Successful</h1>` +
            `<p>Account <strong>${accountId}</strong> (${account.email}) has been connected.</p>` +
            `<p>You can close this window and return to OpenClaw.</p>` +
            `</body></html>`,
        );

        console.log(
          `[gmail-manager] OAuth callback: authorized account "${accountId}" (${account.email})`,
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[gmail-manager] OAuth callback error:", message);
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(`<html><body><h1>Authorization Error</h1><p>${message}</p></body></html>`);
      }
    },
  });

  // Register token refresh background service
  api.registerService({
    id: "gmail-token-refresh",
    start: async () => {
      startTokenRefreshService(oauth);
    },
    stop: async () => {
      stopTokenRefreshService();
    },
  });

  console.log(
    `[gmail-manager] Registered: ${accounts.length} accounts, 9 tools, 2 commands, 1 service`,
  );
}
