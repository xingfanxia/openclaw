import { getWorkspaceInfo, listDatabases } from "../notion-client.js";
import type { NotionConfig, NotionAccount } from "../types.js";

async function getAccountStatus(account: NotionAccount): Promise<string[]> {
  const lines: string[] = [];
  const label = account.workspace ? `${account.id} (${account.workspace})` : account.id;

  if (!account.integrationToken) {
    lines.push(`[!!] ${label}: No integration token configured`);
    return lines;
  }

  try {
    const info = await getWorkspaceInfo(account.integrationToken, account.workspace);
    lines.push(`[OK] ${label}`);
    lines.push(`    Bot: ${info.botName}`);
    lines.push(`    Workspace: ${info.workspaceName}`);

    try {
      const databases = await listDatabases(account.integrationToken);
      lines.push(`    Accessible databases: ${databases.length}`);
      for (const db of databases.slice(0, 5)) {
        const propCount = Object.keys(db.properties).length;
        lines.push(`      - ${db.title} (${propCount} properties)`);
      }
      if (databases.length > 5) {
        lines.push(`      ... and ${databases.length - 5} more`);
      }
    } catch {
      lines.push("    Could not list databases (integration may have limited permissions)");
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    lines.push(`[!!] ${label}: Connection failed`);
    lines.push(`    Error: ${message}`);
  }

  return lines;
}

export async function getNotionStatus(config: NotionConfig): Promise<string> {
  const lines: string[] = [];
  lines.push("=== Notion Connection Status ===");
  lines.push("");

  if (config.accounts.length === 0) {
    lines.push("[!!] No accounts configured");
    lines.push("    Action: Add accounts to notion-manager plugin config");
    return lines.join("\n");
  }

  lines.push(`Accounts: ${config.accounts.length}`);
  lines.push(`Default: ${config.defaultAccount}`);
  lines.push("");

  // Check each account in parallel
  const statusPromises = config.accounts.map((account) => getAccountStatus(account));
  const statuses = await Promise.all(statusPromises);

  for (const accountLines of statuses) {
    lines.push(...accountLines);
    lines.push("");
  }

  // Show aliases
  const aliases = Object.entries(config.accountAliases);
  if (aliases.length > 0) {
    lines.push("Aliases:");
    for (const [alias, target] of aliases) {
      lines.push(`  ${alias} -> ${target}`);
    }
  }

  return lines.join("\n");
}
