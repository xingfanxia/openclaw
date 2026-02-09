import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import type { ObsidianConfig } from "../types.js";
import { gitSync } from "../vault-client.js";

export function createObsidianSyncTool(config: ObsidianConfig): AnyAgentTool {
  return {
    name: "obsidian_sync",
    description:
      "Git sync operations for the Obsidian vault. Supports pull (with rebase), push (auto-commits), full sync, and status check.",
    parameters: Type.Object({
      action: Type.Union(
        [Type.Literal("pull"), Type.Literal("push"), Type.Literal("sync"), Type.Literal("status")],
        {
          description:
            "Sync action: 'pull' (git pull --rebase), 'push' (auto-commit + push), 'sync' (pull then push), 'status' (show git status)",
        },
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: { action: "pull" | "push" | "sync" | "status" },
    ) => {
      try {
        if (!config.gitRemote && !config.vaultPath) {
          const result = { error: "No vault path configured" };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        }
        const result = await gitSync(config, params.action);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const result = { error: message, action: params.action };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }
    },
  } as AnyAgentTool;
}
