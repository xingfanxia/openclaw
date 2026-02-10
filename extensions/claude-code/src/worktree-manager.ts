import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdir, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WorktreeConfig {
  mode: "off" | "auto" | "opt-in";
  basePath: string;
  cleanupAfterHours: number;
  branchPrefix: string;
}

export interface WorktreeInfo {
  branchName: string;
  path: string;
  projectPath: string;
  createdAt: Date;
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
  private config: WorktreeConfig;

  constructor(config: Partial<WorktreeConfig> & { basePath: string }) {
    this.config = {
      mode: config.mode ?? "auto",
      basePath: config.basePath,
      cleanupAfterHours: config.cleanupAfterHours ?? 168, // 7 days
      branchPrefix: config.branchPrefix ?? "session/",
    };
  }

  async create(projectPath: string): Promise<WorktreeInfo> {
    const now = new Date();
    const hex = randomBytes(3).toString("hex");
    const timestamp = formatTimestamp(now);
    const branchName = `${this.config.branchPrefix}${timestamp}-${hex}`;
    const projectName = basename(projectPath);
    const worktreePath = join(this.config.basePath, `${projectName}-${hex}`);

    // Ensure base path exists
    await mkdir(this.config.basePath, { recursive: true });

    // Create worktree
    await execFileAsync("git", ["worktree", "add", worktreePath, "-b", branchName], {
      cwd: projectPath,
    });

    return {
      branchName,
      path: worktreePath,
      projectPath,
      createdAt: now,
    };
  }

  async getSummary(info: WorktreeInfo): Promise<WorktreeSummary> {
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    let files: string[] = [];

    try {
      const { stdout: statOutput } = await execFileAsync("git", ["diff", "HEAD", "--stat"], {
        cwd: info.path,
      });

      // Parse the summary line like "3 files changed, 10 insertions(+), 2 deletions(-)"
      const summaryMatch = statOutput.match(
        /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
      );
      if (summaryMatch) {
        filesChanged = parseInt(summaryMatch[1], 10) || 0;
        insertions = parseInt(summaryMatch[2], 10) || 0;
        deletions = parseInt(summaryMatch[3], 10) || 0;
      }
    } catch {
      // No changes or git error
    }

    try {
      const { stdout: nameOutput } = await execFileAsync("git", ["diff", "HEAD", "--name-only"], {
        cwd: info.path,
      });
      files = nameOutput.trim().split("\n").filter(Boolean);
    } catch {
      // No changes or git error
    }

    return {
      branchName: info.branchName,
      path: info.path,
      filesChanged,
      insertions,
      deletions,
      files,
    };
  }

  async list(): Promise<WorktreeInfo[]> {
    const results: WorktreeInfo[] = [];

    let entries;
    try {
      entries = await readdir(this.config.basePath, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const worktreePath = join(this.config.basePath, entry.name);

      // Verify it's a valid git worktree
      try {
        const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
          cwd: worktreePath,
        });
        if (!stdout.trim()) continue;

        // Get the branch name
        const { stdout: branchOutput } = await execFileAsync(
          "git",
          ["rev-parse", "--abbrev-ref", "HEAD"],
          { cwd: worktreePath },
        );

        results.push({
          branchName: branchOutput.trim(),
          path: worktreePath,
          projectPath: "", // Cannot reliably determine from worktree alone
          createdAt: parseBranchTimestamp(branchOutput.trim(), this.config.branchPrefix),
        });
      } catch {
        // Not a valid worktree, skip
      }
    }

    return results;
  }

  async cleanup(maxAgeHours?: number): Promise<number> {
    const threshold = maxAgeHours ?? this.config.cleanupAfterHours;
    const cutoff = new Date(Date.now() - threshold * 60 * 60 * 1000);
    const worktrees = await this.list();
    let removed = 0;

    for (const wt of worktrees) {
      if (wt.createdAt < cutoff) {
        try {
          await this.remove(wt.path);
          removed++;
        } catch {
          // Skip worktrees that can't be removed
        }
      }
    }

    return removed;
  }

  async merge(branchName: string, targetBranch?: string): Promise<void> {
    const target = targetBranch ?? "main";
    const worktrees = await this.list();
    const wt = worktrees.find((w) => w.branchName === branchName);

    if (!wt) {
      throw new Error(`Worktree with branch ${branchName} not found`);
    }

    // Find the parent repo by going up from basePath
    // We need to merge from a non-worktree directory
    const { stdout: toplevel } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: wt.path,
    });

    // Get the main repo path (worktree's commondir)
    const { stdout: commonDir } = await execFileAsync("git", ["rev-parse", "--git-common-dir"], {
      cwd: wt.path,
    });
    const mainRepoGitDir = commonDir.trim();
    // The repo root is the parent of .git
    const mainRepoPath = join(mainRepoGitDir, "..");

    await execFileAsync("git", ["checkout", target], { cwd: mainRepoPath });
    await execFileAsync("git", ["merge", branchName], { cwd: mainRepoPath });

    // Remove the worktree
    await execFileAsync("git", ["worktree", "remove", wt.path], {
      cwd: mainRepoPath,
    });

    // Delete the branch
    await execFileAsync("git", ["branch", "-d", branchName], {
      cwd: mainRepoPath,
    });
  }

  async remove(worktreePath: string): Promise<void> {
    // Find the main repo
    const { stdout: commonDir } = await execFileAsync("git", ["rev-parse", "--git-common-dir"], {
      cwd: worktreePath,
    });
    const mainRepoPath = join(commonDir.trim(), "..");

    // Get branch name before removing
    const { stdout: branchOutput } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: worktreePath },
    );
    const branchName = branchOutput.trim();

    await execFileAsync("git", ["worktree", "remove", worktreePath, "--force"], {
      cwd: mainRepoPath,
    });

    // Try to delete the branch too
    try {
      await execFileAsync("git", ["branch", "-D", branchName], {
        cwd: mainRepoPath,
      });
    } catch {
      // Branch may already be deleted or protected
    }
  }

  shouldUseWorktree(useWorktreeParam: boolean | undefined, isGitRepo: boolean): boolean {
    // Explicit parameter overrides config
    if (useWorktreeParam !== undefined) return useWorktreeParam && isGitRepo;

    switch (this.config.mode) {
      case "off":
        return false;
      case "auto":
        return isGitRepo;
      case "opt-in":
        return false; // Only use when explicitly requested
      default:
        return false;
    }
  }
}

function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}${mo}${d}-${h}${mi}${s}`;
}

function parseBranchTimestamp(branchName: string, prefix: string): Date {
  // Branch format: {prefix}{YYYYMMDD}-{HHMMSS}-{hex}
  const withoutPrefix = branchName.startsWith(prefix)
    ? branchName.slice(prefix.length)
    : branchName;

  const match = withoutPrefix.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (!match) return new Date(0);

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    parseInt(hour, 10),
    parseInt(minute, 10),
    parseInt(second, 10),
  );
}
