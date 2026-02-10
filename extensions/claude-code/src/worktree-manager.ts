import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdir, mkdir, stat, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WorktreeConfig {
  mode?: "off" | "auto" | "opt-in";
  basePath?: string;
  cleanupAfterHours?: number;
  branchPrefix?: string;
}

export interface WorktreeInfo {
  branchName: string;
  path: string;
  projectPath: string;
  createdAt: number;
}

export interface WorktreeSummary {
  branchName: string;
  path: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: string[];
}

export class WorktreeManager {
  private config: Required<WorktreeConfig>;

  constructor(config: Partial<WorktreeConfig> = {}) {
    this.config = {
      mode: (config.mode as "off" | "auto" | "opt-in") ?? "opt-in",
      basePath: config.basePath ?? "/home/node/projects/.worktrees",
      cleanupAfterHours: config.cleanupAfterHours ?? 24,
      branchPrefix: config.branchPrefix ?? "openclaw/",
    };
  }

  /**
   * Decide whether to use a worktree based on config mode and explicit parameter.
   */
  shouldUseWorktree(explicitParam: boolean | undefined, isGitRepo: boolean): boolean {
    // Explicit param always wins
    if (typeof explicitParam === "boolean") return explicitParam && isGitRepo;

    // Config mode
    switch (this.config.mode) {
      case "off":
        return false;
      case "auto":
        return isGitRepo;
      case "opt-in":
      default:
        return false;
    }
  }

  /**
   * Create a new worktree for a project.
   */
  async create(projectPath: string): Promise<WorktreeInfo> {
    const hexId = randomBytes(3).toString("hex");
    const now = new Date();
    const timestamp = [
      now.getFullYear().toString(),
      (now.getMonth() + 1).toString().padStart(2, "0"),
      now.getDate().toString().padStart(2, "0"),
      "-",
      now.getHours().toString().padStart(2, "0"),
      now.getMinutes().toString().padStart(2, "0"),
      now.getSeconds().toString().padStart(2, "0"),
    ].join("");

    const branchName = `${this.config.branchPrefix}${timestamp}-${hexId}`;
    const projectName = basename(projectPath);
    const worktreePath = join(this.config.basePath, `${projectName}-${hexId}`);

    // Ensure base path exists
    await mkdir(this.config.basePath, { recursive: true });

    // Create worktree
    await execFileAsync("git", ["worktree", "add", worktreePath, "-b", branchName], {
      cwd: projectPath,
      timeout: 30_000,
    });

    return {
      branchName,
      path: worktreePath,
      projectPath,
      createdAt: Date.now(),
    };
  }

  /**
   * Get a summary of changes in a worktree.
   */
  async getSummary(info: WorktreeInfo): Promise<WorktreeSummary> {
    // Get list of changed files
    let files: string[] = [];
    try {
      const { stdout } = await execFileAsync("git", ["diff", "HEAD", "--name-only"], {
        cwd: info.path,
        timeout: 10_000,
      });
      files = stdout.trim().split("\n").filter(Boolean);
    } catch {
      // No changes or git error
    }

    // Get stat summary
    let insertions = 0;
    let deletions = 0;
    try {
      const { stdout } = await execFileAsync("git", ["diff", "HEAD", "--stat"], {
        cwd: info.path,
        timeout: 10_000,
      });
      // Parse the summary line: " N files changed, M insertions(+), K deletions(-)"
      const summaryMatch = stdout.match(/(\d+) insertions?\(\+\).*?(\d+) deletions?\(-\)/);
      if (summaryMatch) {
        insertions = parseInt(summaryMatch[1], 10);
        deletions = parseInt(summaryMatch[2], 10);
      } else {
        // Try insertions only or deletions only
        const insMatch = stdout.match(/(\d+) insertions?\(\+\)/);
        if (insMatch) insertions = parseInt(insMatch[1], 10);
        const delMatch = stdout.match(/(\d+) deletions?\(-\)/);
        if (delMatch) deletions = parseInt(delMatch[1], 10);
      }
    } catch {
      // No stat info
    }

    // Also check for committed changes on the branch (not just uncommitted)
    if (files.length === 0) {
      try {
        const { stdout } = await execFileAsync(
          "git",
          ["log", "--oneline", "--name-only", "HEAD@{upstream}..HEAD"],
          { cwd: info.path, timeout: 10_000 },
        );
        const logFiles = stdout
          .trim()
          .split("\n")
          .filter((line) => line && !line.match(/^[a-f0-9]+ /))
          .filter(Boolean);
        if (logFiles.length > 0) files = [...new Set(logFiles)];
      } catch {
        // No upstream or other error — try diffing against parent branch
        try {
          const branchBase = info.branchName.replace(this.config.branchPrefix, "");
          // Find merge base with common ancestors
          const { stdout: diffOutput } = await execFileAsync(
            "git",
            ["diff", "--name-only", "HEAD~1..HEAD"],
            { cwd: info.path, timeout: 10_000 },
          );
          files = diffOutput.trim().split("\n").filter(Boolean);
        } catch {
          // Give up on finding committed files
        }
      }
    }

    return {
      branchName: info.branchName,
      path: info.path,
      filesChanged: files.length,
      insertions,
      deletions,
      files,
    };
  }

  /**
   * List active worktrees in the base path.
   */
  async list(): Promise<WorktreeInfo[]> {
    let items: string[];
    try {
      items = await readdir(this.config.basePath);
    } catch {
      return [];
    }

    const results: WorktreeInfo[] = [];
    for (const item of items) {
      const fullPath = join(this.config.basePath, item);
      try {
        const s = await stat(fullPath);
        if (!s.isDirectory()) continue;

        // Try to get branch name
        const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd: fullPath,
          timeout: 5000,
        });
        const branchName = stdout.trim();

        results.push({
          branchName,
          path: fullPath,
          projectPath: "", // Unknown from listing alone
          createdAt: s.mtimeMs,
        });
      } catch {
        continue;
      }
    }

    return results;
  }

  /**
   * Remove stale worktrees older than the configured threshold.
   * Returns the number of worktrees removed.
   */
  async cleanup(maxAgeHours?: number): Promise<number> {
    const threshold = (maxAgeHours ?? this.config.cleanupAfterHours) * 60 * 60 * 1000;
    const now = Date.now();
    const trees = await this.list();
    let removed = 0;

    for (const tree of trees) {
      if (now - tree.createdAt > threshold) {
        try {
          await this.remove(tree.path);
          removed++;
        } catch {
          // Skip if removal fails
        }
      }
    }

    return removed;
  }

  /**
   * Merge a worktree branch back to the parent branch, then clean up.
   */
  async merge(branchName: string, targetBranch?: string): Promise<void> {
    // Find the worktree with this branch
    const trees = await this.list();
    const tree = trees.find((t) => t.branchName === branchName);

    if (!tree) {
      throw new Error(`No worktree found for branch "${branchName}"`);
    }

    // Find the parent repo — it's the main worktree
    let parentPath: string;
    try {
      const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], {
        cwd: tree.path,
        timeout: 10_000,
      });
      // First worktree entry is the main one
      const mainMatch = stdout.match(/^worktree (.+)$/m);
      parentPath = mainMatch?.[1] ?? "";
      if (!parentPath) throw new Error("Could not find main worktree");
    } catch (err) {
      throw new Error(
        `Failed to find parent repo: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Determine target branch
    const target = targetBranch ?? (await this.getDefaultBranch(parentPath));

    // Checkout target branch and merge
    await execFileAsync("git", ["checkout", target], {
      cwd: parentPath,
      timeout: 10_000,
    });

    await execFileAsync("git", ["merge", branchName, "--no-edit"], {
      cwd: parentPath,
      timeout: 30_000,
    });

    // Remove worktree
    await this.remove(tree.path);

    // Delete branch
    try {
      await execFileAsync("git", ["branch", "-d", branchName], {
        cwd: parentPath,
        timeout: 10_000,
      });
    } catch {
      // Branch may already be gone
    }
  }

  /**
   * Remove a specific worktree.
   */
  async remove(worktreePath: string): Promise<void> {
    try {
      // Try git worktree remove first
      await execFileAsync("git", ["worktree", "remove", worktreePath, "--force"], {
        timeout: 15_000,
      });
    } catch {
      // Fallback: just remove the directory
      try {
        await rm(worktreePath, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    }
  }

  /** Get the default branch of a repository. */
  private async getDefaultBranch(repoPath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", ["symbolic-ref", "--short", "HEAD"], {
        cwd: repoPath,
        timeout: 5000,
      });
      return stdout.trim() || "main";
    } catch {
      return "main";
    }
  }
}
