import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { createClaudeCodeTool } from "./src/claude-code-tool.js";
import { createCodexTool } from "./src/codex-tool.js";
import { ProjectRegistry } from "./src/project-registry.js";
import { WorktreeManager } from "./src/worktree-manager.js";

type PluginCfg = Record<string, unknown>;

export default function register(api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig ?? {}) as PluginCfg;

  // Initialize project registry
  const registry = new ProjectRegistry((cfg.projects as Record<string, unknown> | undefined) ?? {});

  // Initialize worktree manager
  const worktreeManager = new WorktreeManager(
    (cfg.worktree as Record<string, unknown> | undefined) ?? {},
  );

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
          await ctx.reply(
            [
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
          );
        } else {
          await ctx.reply(`No project found matching "${query}".`);
        }
      } else {
        const entries = registry.list();
        if (entries.length === 0) {
          await ctx.reply("No projects discovered. Run /projects_scan to scan.");
          return;
        }
        const lines = entries.map(
          (e) =>
            `- **${e.id}** → \`${e.path}\` (${e.language ?? "unknown"})${e.description ? ` — ${e.description}` : ""}`,
        );
        await ctx.reply(`**Discovered Projects (${entries.length}):**\n${lines.join("\n")}`);
      }
    },
  });

  // /projects_scan — Rescan workspace for new projects
  api.registerCommand({
    name: "projects_scan",
    acceptsArgs: false,
    description: "Rescan workspace for new projects.",
    handler: async (ctx) => {
      await registry.rescan();
      const count = registry.list().length;
      await ctx.reply(`Scan complete. Found ${count} project(s).`);
    },
  });

  // /worktrees — List active worktrees
  api.registerCommand({
    name: "worktrees",
    acceptsArgs: false,
    description: "List active git worktrees.",
    handler: async (ctx) => {
      const trees = await worktreeManager.list();
      if (trees.length === 0) {
        await ctx.reply("No active worktrees.");
        return;
      }
      const lines = trees.map(
        (t) =>
          `- **${t.branchName}** → \`${t.path}\` (created ${new Date(t.createdAt).toISOString()})`,
      );
      await ctx.reply(`**Active Worktrees (${trees.length}):**\n${lines.join("\n")}`);
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
        await ctx.reply("Usage: /worktrees_merge <branch-name>");
        return;
      }
      try {
        await worktreeManager.merge(branch);
        await ctx.reply(`Merged and cleaned up branch \`${branch}\`.`);
      } catch (err) {
        await ctx.reply(`Failed to merge: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });

  // /worktrees_cleanup — Remove stale worktrees
  api.registerCommand({
    name: "worktrees_cleanup",
    acceptsArgs: false,
    description: "Remove stale worktrees older than the configured threshold.",
    handler: async (ctx) => {
      const removed = await worktreeManager.cleanup();
      await ctx.reply(`Cleaned up ${removed} stale worktree(s).`);
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
        await ctx.reply("Usage: /deploy_preview <project-id>");
        return;
      }

      const entry = registry.resolve(projectArg);
      const deployPath = entry?.path ?? projectArg;

      const token = process.env.VERCEL_TOKEN;
      if (!token) {
        await ctx.reply("VERCEL_TOKEN not set. Add it to your .env file.");
        return;
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
        await ctx.reply(`Preview deployed: ${previewUrl}`);
      } catch (err) {
        await ctx.reply(`Deploy failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
}
