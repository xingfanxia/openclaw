import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createClaudeCodeTool } from "./src/claude-code-tool.js";
import { createCodexTool } from "./src/codex-tool.js";
import { ProjectRegistry } from "./src/project-registry.js";
import { WorktreeManager, type WorktreeConfig } from "./src/worktree-manager.js";

type PluginCfg = Record<string, unknown>;

export default function register(api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig ?? {}) as PluginCfg;

  // Initialize project registry
  const registry = new ProjectRegistry((cfg.projects as Record<string, unknown> | undefined) ?? {});

  // Initialize worktree manager
  const worktreeCfg = (cfg.worktree as Record<string, unknown> | undefined) ?? {};
  const worktreeManager = new WorktreeManager({
    ...worktreeCfg,
    basePath: (worktreeCfg.basePath as string) ?? "/tmp/openclaw-worktrees",
  } as Partial<WorktreeConfig> & { basePath: string });

  // Auto-scan projects on startup (fire and forget)
  const projectsCfg = cfg.projects as Record<string, unknown> | undefined;
  if (projectsCfg?.autoScan !== false) {
    registry.scan().catch(() => {});
  }

  // Run initial worktree cleanup (fire and forget)
  worktreeManager.cleanup().catch(() => {});

  // Register claude_code tool
  api.registerTool(
    (ctx) => {
      if (ctx.sandboxed) {
        return null;
      }
      return createClaudeCodeTool(api, registry, worktreeManager);
    },
    { optional: true },
  );

  // Register codex tool
  api.registerTool(
    (ctx) => {
      if (ctx.sandboxed) {
        return null;
      }
      return createCodexTool(api, registry, ctx);
    },
    { optional: true },
  );

  // === Commands ===

  // /projects [query] — List all projects or search by keyword
  api.registerCommand({
    name: "projects",
    acceptsArgs: true,
    description: "List discovered projects or search by keyword. Usage: /projects [query]",
    handler: async (ctx) => {
      const query = ctx.args?.trim();
      if (query) {
        const entry = registry.resolve(query);
        if (entry) {
          return {
            text: [
              `Found: **${entry.id}** → \`${entry.path}\``,
              entry.description ?? "",
              `Language: ${entry.language ?? "unknown"}`,
              `Keywords: ${entry.keywords.join(", ")}`,
              entry.isGitRepo
                ? `Git: yes (branch: ${entry.defaultBranch ?? "unknown"})`
                : "Git: no",
            ]
              .filter(Boolean)
              .join("\n"),
          };
        } else {
          return { text: `No project found matching "${query}".` };
        }
      } else {
        const entries = registry.list();
        if (entries.length === 0) {
          return { text: "No projects discovered. Run /projects_scan to scan." };
        }
        const lines = entries.map(
          (e) =>
            `- **${e.id}** → \`${e.path}\` (${e.language ?? "unknown"})${e.description ? ` — ${e.description}` : ""}`,
        );
        return { text: `**Discovered Projects (${entries.length}):**\n${lines.join("\n")}` };
      }
    },
  });

  // /projects_scan — Rescan workspace for new projects
  api.registerCommand({
    name: "projects_scan",
    acceptsArgs: false,
    description: "Rescan workspace for new projects.",
    handler: async () => {
      await registry.rescan();
      const count = registry.list().length;
      return { text: `Scan complete. Found ${count} project(s).` };
    },
  });

  // /worktrees — List active worktrees
  api.registerCommand({
    name: "worktrees",
    acceptsArgs: false,
    description: "List active git worktrees.",
    handler: async () => {
      const trees = await worktreeManager.list();
      if (trees.length === 0) {
        return { text: "No active worktrees." };
      }
      const lines = trees.map(
        (t) =>
          `- **${t.branchName}** → \`${t.path}\` (created ${new Date(t.createdAt).toISOString()})`,
      );
      return { text: `**Active Worktrees (${trees.length}):**\n${lines.join("\n")}` };
    },
  });

  // /worktrees_merge <branch> — Merge worktree back to parent branch
  api.registerCommand({
    name: "worktrees_merge",
    acceptsArgs: true,
    description:
      "Merge a worktree branch back to its parent. Usage: /worktrees_merge <branch-name>",
    handler: async (ctx) => {
      const branch = ctx.args?.trim();
      if (!branch) {
        return { text: "Usage: /worktrees_merge <branch-name>" };
      }
      try {
        await worktreeManager.merge(branch);
        return { text: `Merged and cleaned up branch \`${branch}\`.` };
      } catch (err) {
        return { text: `Failed to merge: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  // /worktrees_cleanup — Remove stale worktrees
  api.registerCommand({
    name: "worktrees_cleanup",
    acceptsArgs: false,
    description: "Remove stale worktrees older than the configured threshold.",
    handler: async () => {
      const removed = await worktreeManager.cleanup();
      return { text: `Cleaned up ${removed} stale worktree(s).` };
    },
  });

  // /deploy_preview <project> — Deploy project to Vercel for preview
  api.registerCommand({
    name: "deploy_preview",
    acceptsArgs: true,
    description: "Deploy a project to Vercel for preview. Usage: /deploy_preview <project-id>",
    handler: async (ctx) => {
      const projectArg = ctx.args?.trim();
      if (!projectArg) {
        return { text: "Usage: /deploy_preview <project-id>" };
      }

      const entry = registry.resolve(projectArg);
      const deployPath = entry?.path ?? projectArg;

      const token = process.env.VERCEL_TOKEN;
      if (!token) {
        return { text: "VERCEL_TOKEN not set. Add it to your .env file." };
      }

      try {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);

        const { stdout } = await execFileAsync("vercel", ["--yes", "--token", token], {
          cwd: deployPath,
          timeout: 120_000,
        });

        // Extract preview URL from output
        const urlMatch = stdout.match(/https:\/\/[^\s]+\.vercel\.app/);
        const previewUrl = urlMatch?.[0] ?? stdout.trim();
        return { text: `Preview deployed: ${previewUrl}` };
      } catch (err) {
        return { text: `Deploy failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });
}
