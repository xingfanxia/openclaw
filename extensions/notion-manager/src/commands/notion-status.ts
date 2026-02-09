import type { NotionConfig } from "../types.js";
import { getWorkspaceInfo, listDatabases } from "../notion-client.js";

export async function getNotionStatus(config: NotionConfig): Promise<string> {
  const lines: string[] = [];
  lines.push("=== Notion Connection Status ===");
  lines.push("");

  if (!config.integrationToken) {
    lines.push("[!!] No integration token configured");
    lines.push("    Action: Set integrationToken in notion-manager plugin config");
    return lines.join("\n");
  }

  try {
    const info = await getWorkspaceInfo(config);
    lines.push(`[OK] Connected to Notion`);
    lines.push(`    Bot: ${info.botName}`);
    lines.push(`    Workspace: ${info.workspaceName}`);
    lines.push("");

    try {
      const databases = await listDatabases(config);
      lines.push(`Accessible databases: ${databases.length}`);
      for (const db of databases.slice(0, 10)) {
        const propCount = Object.keys(db.properties).length;
        lines.push(`  - ${db.title} (${propCount} properties)`);
      }
      if (databases.length > 10) {
        lines.push(`  ... and ${databases.length - 10} more`);
      }
    } catch {
      lines.push("Could not list databases (integration may have limited permissions)");
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    lines.push(`[!!] Connection failed`);
    lines.push(`    Error: ${message}`);
    lines.push("");
    lines.push("Troubleshooting:");
    lines.push("  1. Verify integrationToken is correct");
    lines.push("  2. Ensure the integration has access to your workspace");
    lines.push("  3. Check https://www.notion.so/my-integrations");
  }

  return lines.join("\n");
}
