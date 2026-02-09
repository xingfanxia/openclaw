import type { ObsidianConfig } from "../types.js";
import { gitSync } from "../vault-client.js";

export async function handleObsidianSync(
  config: ObsidianConfig,
  args: string,
): Promise<{ text: string }> {
  const action = (args.trim() || "sync") as "pull" | "push" | "sync" | "status";
  const validActions = ["pull", "push", "sync", "status"];

  if (!validActions.includes(action)) {
    return {
      text: `Invalid action: "${action}". Valid actions: ${validActions.join(", ")}`,
    };
  }

  if (!config.gitRemote && !config.vaultPath) {
    return { text: "Git sync not configured. Set 'gitRemote' in plugin config." };
  }

  try {
    const result = await gitSync(config, action);
    const lines: string[] = [];
    lines.push(`=== Obsidian Sync: ${action} ===`);
    lines.push("");
    lines.push(result.result);

    if (result.details) {
      lines.push("");
      lines.push("Details:");
      lines.push(JSON.stringify(result.details, null, 2));
    }

    return { text: lines.join("\n") };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { text: `Sync failed: ${message}` };
  }
}
