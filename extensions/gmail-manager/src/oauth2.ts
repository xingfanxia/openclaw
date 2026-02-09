import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.file",
];

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function createOAuth2Client(config: OAuthConfig) {
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

export function generateAuthUrl(config: OAuthConfig, accountId: string): string {
  const client = createOAuth2Client(config);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: accountId,
  });
}

export async function exchangeCodeForTokens(
  config: OAuthConfig,
  code: string,
): Promise<{ accessToken: string; refreshToken: string; expiryDate: number }> {
  const client = createOAuth2Client(config);
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh token received. Ensure prompt=consent and access_type=offline are set.",
    );
  }

  return {
    accessToken: tokens.access_token ?? "",
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date ?? Date.now() + 3600 * 1000,
  };
}

export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string,
): Promise<{ accessToken: string; expiryDate: number }> {
  const client = createOAuth2Client(config);
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();

  return {
    accessToken: credentials.access_token ?? "",
    expiryDate: credentials.expiry_date ?? Date.now() + 3600 * 1000,
  };
}
