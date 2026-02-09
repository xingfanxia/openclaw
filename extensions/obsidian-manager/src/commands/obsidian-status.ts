import type { ObsidianConfig } from "../types.js";
import { getVaultStats, gitSync } from "../vault-client.js";

export async function getVaultStatus(config: ObsidianConfig): Promise<string> {
  const lines: string[] = [];
  lines.push("=== Obsidian Vault Status ===");
  lines.push("");

  try {
    const stats = getVaultStats(config);
    lines.push(`Vault path: ${stats.vaultPath}`);
    lines.push(`Notes: ${stats.noteCount}`);
    lines.push(`Folders: ${stats.folderCount}`);
    lines.push(`Total size: ${(stats.totalSize / 1024).toFixed(1)} KB`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    lines.push(`Vault error: ${message}`);
  }

  lines.push("");

  if (config.gitRemote) {
    lines.push(`Git remote: ${config.gitRemote}`);
    lines.push(`Git branch: ${config.gitBranch ?? "main"}`);
    try {
      const status = await gitSync(config, "status");
      lines.push(`Git status: ${status.result}`);
      if (status.details && typeof status.details === "object") {
        const d = status.details as Record<string, unknown>;
        if (d.ahead) lines.push(`  Ahead: ${d.ahead}`);
        if (d.behind) lines.push(`  Behind: ${d.behind}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      lines.push(`Git error: ${message}`);
    }
  } else {
    lines.push("Git sync: Not configured (no gitRemote set)");
  }

  lines.push("");
  lines.push(`Auto-sync: ${config.autoSync ? "Enabled" : "Disabled"}`);
  lines.push(`Exclude patterns: ${(config.excludePatterns ?? [".obsidian"]).join(", ")}`);

  return lines.join("\n");
}
