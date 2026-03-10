import type { OAuthConfig } from "../oauth2.js";
import { generateAuthUrl } from "../oauth2.js";
import { getToken } from "../token-store.js";

interface AccountConfig {
  id: string;
  email: string;
  type: string;
}

export function handleGmailAuth(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  accountId: string,
): { text: string } {
  const account = accounts.find((a) => a.id === accountId);

  if (!accountId) {
    return {
      text: [
        "Usage: /gmail_auth <account-id>",
        "",
        "Available accounts:",
        ...accounts.map((a) => {
          const token = getToken(a.id);
          const status = token ? "connected" : "not connected";
          return `  ${a.id} (${a.email}) — ${status}`;
        }),
      ].join("\n"),
    };
  }

  if (!account) {
    return {
      text: `Account "${accountId}" not found. Available: ${accounts.map((a) => a.id).join(", ")}`,
    };
  }

  const existingToken = getToken(accountId);
  const authUrl = generateAuthUrl(oauthConfig, accountId);

  const lines: string[] = [];
  if (existingToken) {
    lines.push(`Account "${accountId}" (${account.email}) is already connected.`);
    lines.push("Re-authorizing will replace the existing token.");
    lines.push("");
  } else {
    lines.push(`Authorizing account "${accountId}" (${account.email})...`);
    lines.push("");
  }

  lines.push("Click the link below to authorize Gmail access:");
  lines.push("");
  lines.push(authUrl);
  lines.push("");
  lines.push(
    "After authorizing, Google will redirect to the callback URL and the token will be saved automatically.",
  );

  return { text: lines.join("\n") };
}
