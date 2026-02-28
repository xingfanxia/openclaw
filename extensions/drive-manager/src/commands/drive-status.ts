import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getStorageQuota } from "../drive-client.js";
import type { OAuthConfig, AccountConfig } from "../types.js";

const TOKEN_FILE = path.join(os.homedir(), ".openclaw", "gmail-tokens.json");

interface StoredToken {
  accountId: string;
  expiryDate: number;
}

function getToken(accountId: string): StoredToken | undefined {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = fs.readFileSync(TOKEN_FILE, "utf-8");
      const store = JSON.parse(data) as Record<string, StoredToken>;
      return store[accountId];
    }
  } catch {
    // ignore
  }
  return undefined;
}

function isTokenExpired(token: StoredToken): boolean {
  return Date.now() >= token.expiryDate - 5 * 60 * 1000;
}

function formatBytes(bytes: string): string {
  const b = parseInt(bytes, 10);
  if (isNaN(b)) return bytes;
  if (b === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(2) + " " + units[i];
}

export interface DriveAccountStatus {
  id: string;
  email: string;
  type: string;
  connected: boolean;
  tokenExpired: boolean;
  storageLimit?: string;
  storageUsage?: string;
  storageInDrive?: string;
  storageInTrash?: string;
  error?: string;
}

export async function getDriveStatuses(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
): Promise<DriveAccountStatus[]> {
  const statuses: DriveAccountStatus[] = [];

  for (const account of accounts) {
    const token = getToken(account.id);

    if (!token) {
      statuses.push({
        id: account.id,
        email: account.email,
        type: account.type,
        connected: false,
        tokenExpired: false,
        error: "Not authenticated. Use /gmail_auth " + account.id,
      });
      continue;
    }

    const expired = isTokenExpired(token);

    try {
      const quota = await getStorageQuota(oauthConfig, account.id);
      statuses.push({
        id: account.id,
        email: account.email,
        type: account.type,
        connected: true,
        tokenExpired: expired,
        storageLimit: quota.limit === "unlimited" ? "unlimited" : formatBytes(quota.limit),
        storageUsage: formatBytes(quota.usage),
        storageInDrive: formatBytes(quota.usageInDrive),
        storageInTrash: formatBytes(quota.usageInTrash),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      statuses.push({
        id: account.id,
        email: account.email,
        type: account.type,
        connected: true,
        tokenExpired: expired,
        error: message,
      });
    }
  }

  return statuses;
}

export function formatDriveStatusText(statuses: DriveAccountStatus[]): string {
  const lines: string[] = [];
  lines.push("=== Google Drive Status ===");
  lines.push("");

  for (const status of statuses) {
    const icon = status.connected && !status.error ? "[OK]" : "[!!]";
    lines.push(`${icon} ${status.id} (${status.email}) — ${status.type}`);

    if (!status.connected) {
      lines.push(`    Status: Not connected`);
      lines.push(`    Action: ${status.error}`);
    } else if (status.error) {
      lines.push(`    Status: Error — ${status.error}`);
    } else {
      lines.push(`    Status: Connected`);
      lines.push(`    Storage: ${status.storageUsage} / ${status.storageLimit}`);
      lines.push(`    In Drive: ${status.storageInDrive} | In Trash: ${status.storageInTrash}`);
      if (status.tokenExpired) {
        lines.push(`    Warning: Token expired, will refresh on next use`);
      }
    }
    lines.push("");
  }

  const connected = statuses.filter((s) => s.connected && !s.error).length;
  lines.push(`Connected: ${connected}/${statuses.length} accounts`);

  return lines.join("\n");
}
