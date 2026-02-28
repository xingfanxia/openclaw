import * as fs from "node:fs";
import * as path from "node:path";
import matter from "gray-matter";
import simpleGit from "simple-git";
import type { ObsidianConfig, ObsidianNote, NoteListEntry } from "./types.js";
import {
  getVaultPath,
  getExcludePatterns,
  getGitBranch,
  parseWikiLinks,
  extractTags,
} from "./types.js";

function isExcluded(filePath: string, patterns: string[]): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return patterns.some((pattern) => {
    const p = pattern.replace(/^\/+|\/+$/g, "");
    return normalized.startsWith(p + "/") || normalized === p;
  });
}

function walkDir(dir: string, base: string, patterns: string[]): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const relPath = path.relative(base, path.join(dir, entry.name)).replace(/\\/g, "/");
    if (isExcluded(relPath, patterns)) continue;
    if (entry.isDirectory()) {
      results.push(...walkDir(path.join(dir, entry.name), base, patterns));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(relPath);
    }
  }
  return results;
}

export function listNotes(
  config: ObsidianConfig,
  folder?: string,
  recursive: boolean = true,
  maxResults: number = 100,
): NoteListEntry[] {
  const vaultRoot = getVaultPath(config);
  const patterns = getExcludePatterns(config);
  const searchDir = folder ? path.join(vaultRoot, folder) : vaultRoot;

  let files: string[];
  if (recursive) {
    files = walkDir(searchDir, vaultRoot, patterns);
  } else {
    try {
      const entries = fs.readdirSync(searchDir, { withFileTypes: true });
      files = entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => path.relative(vaultRoot, path.join(searchDir, e.name)).replace(/\\/g, "/"))
        .filter((f) => !isExcluded(f, patterns));
    } catch {
      return [];
    }
  }

  const results: NoteListEntry[] = [];
  for (const relPath of files) {
    if (results.length >= maxResults) break;
    const fullPath = path.join(vaultRoot, relPath);
    try {
      const stat = fs.statSync(fullPath);
      results.push({
        path: relPath,
        name: path.basename(relPath, ".md"),
        lastModified: stat.mtime.toISOString(),
        size: stat.size,
      });
    } catch {
      // skip inaccessible files
    }
  }

  return results.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
}

export function readNote(config: ObsidianConfig, notePath: string): ObsidianNote {
  const vaultRoot = getVaultPath(config);
  const fullPath = path.join(vaultRoot, notePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Note not found: ${notePath}`);
  }

  const raw = fs.readFileSync(fullPath, "utf-8");
  const stat = fs.statSync(fullPath);
  const parsed = matter(raw);
  const frontmatter = (parsed.data ?? {}) as Record<string, unknown>;
  const content = parsed.content;
  const tags = extractTags(content, frontmatter);
  const links = parseWikiLinks(content);

  return {
    path: notePath,
    name: path.basename(notePath, ".md"),
    content,
    frontmatter,
    tags,
    links,
    lastModified: stat.mtime.toISOString(),
  };
}

export function writeNote(
  config: ObsidianConfig,
  notePath: string,
  content: string,
  frontmatter?: Record<string, unknown>,
): { path: string; created: boolean } {
  const vaultRoot = getVaultPath(config);
  const fullPath = path.join(vaultRoot, notePath);
  const existed = fs.existsSync(fullPath);

  // Ensure parent directory exists
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let fileContent: string;
  if (frontmatter && Object.keys(frontmatter).length > 0) {
    fileContent = matter.stringify(content, frontmatter);
  } else {
    fileContent = content;
  }

  fs.writeFileSync(fullPath, fileContent, "utf-8");
  return { path: notePath, created: !existed };
}

export function updateNote(
  config: ObsidianConfig,
  notePath: string,
  content?: string,
  frontmatter?: Record<string, unknown>,
): ObsidianNote {
  const existing = readNote(config, notePath);

  const newContent = content ?? existing.content;
  const newFrontmatter = frontmatter
    ? { ...existing.frontmatter, ...frontmatter }
    : existing.frontmatter;

  writeNote(config, notePath, newContent, newFrontmatter);
  return readNote(config, notePath);
}

export function searchNotes(
  config: ObsidianConfig,
  query: string,
  folder?: string,
  tags?: string[],
  maxResults: number = 20,
): Array<{ path: string; name: string; matches: string[]; score: number }> {
  const allNotes = listNotes(config, folder, true, 10000);
  const queryLower = query.toLowerCase();
  const results: Array<{ path: string; name: string; matches: string[]; score: number }> = [];

  for (const entry of allNotes) {
    try {
      const note = readNote(config, entry.path);

      // If tags filter is specified, check if note has at least one matching tag
      if (tags && tags.length > 0) {
        const hasMatchingTag = tags.some((t) => note.tags.includes(t.replace(/^#/, "")));
        if (!hasMatchingTag) continue;
      }

      let score = 0;
      const matches: string[] = [];

      // Check filename match
      if (note.name.toLowerCase().includes(queryLower)) {
        score += 10;
        matches.push(`Filename: ${note.name}`);
      }

      // Check content matches
      const lines = note.content.split("\n");
      for (const line of lines) {
        if (line.toLowerCase().includes(queryLower)) {
          score += 1;
          if (matches.length < 3) {
            matches.push(line.trim().slice(0, 200));
          }
        }
      }

      // Check frontmatter
      const fmStr = JSON.stringify(note.frontmatter).toLowerCase();
      if (fmStr.includes(queryLower)) {
        score += 5;
        matches.push("Frontmatter match");
      }

      if (score > 0) {
        results.push({ path: note.path, name: note.name, matches, score });
      }
    } catch {
      // skip unreadable notes
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

export function findBacklinks(
  config: ObsidianConfig,
  notePath: string,
): Array<{ path: string; name: string; context: string }> {
  const targetName = path.basename(notePath, ".md");
  const allNotes = listNotes(config, undefined, true, 10000);
  const backlinks: Array<{ path: string; name: string; context: string }> = [];

  for (const entry of allNotes) {
    if (entry.path === notePath) continue;
    try {
      const note = readNote(config, entry.path);
      for (const link of note.links) {
        if (link.target === targetName || link.target === notePath) {
          // Find the line containing this link for context
          const lines = note.content.split("\n");
          const contextLine = lines.find((l) => l.includes(link.raw)) ?? "";
          backlinks.push({
            path: note.path,
            name: note.name,
            context: contextLine.trim().slice(0, 200),
          });
          break; // one backlink per note
        }
      }
    } catch {
      // skip
    }
  }

  return backlinks;
}

export function getAllTags(config: ObsidianConfig): Record<string, number> {
  const allNotes = listNotes(config, undefined, true, 10000);
  const tagCounts: Record<string, number> = {};

  for (const entry of allNotes) {
    try {
      const note = readNote(config, entry.path);
      for (const tag of note.tags) {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
    } catch {
      // skip
    }
  }

  return tagCounts;
}

export function findNotesByTag(
  config: ObsidianConfig,
  tag: string,
): Array<{ path: string; name: string }> {
  const normalizedTag = tag.replace(/^#/, "");
  const allNotes = listNotes(config, undefined, true, 10000);
  const results: Array<{ path: string; name: string }> = [];

  for (const entry of allNotes) {
    try {
      const note = readNote(config, entry.path);
      if (note.tags.includes(normalizedTag)) {
        results.push({ path: note.path, name: note.name });
      }
    } catch {
      // skip
    }
  }

  return results;
}

export async function gitSync(
  config: ObsidianConfig,
  action: "pull" | "push" | "sync" | "status",
): Promise<{ action: string; result: string; details?: unknown }> {
  const vaultRoot = getVaultPath(config);
  const branch = getGitBranch(config);
  const git = simpleGit(vaultRoot);

  switch (action) {
    case "status": {
      const status = await git.status();
      return {
        action: "status",
        result: status.isClean() ? "Clean — no uncommitted changes" : "Uncommitted changes present",
        details: {
          branch: status.current,
          ahead: status.ahead,
          behind: status.behind,
          modified: status.modified,
          created: status.created,
          deleted: status.deleted,
          notAdded: status.not_added,
        },
      };
    }
    case "pull": {
      const pullResult = await git.pull("origin", branch, ["--rebase"]);
      return {
        action: "pull",
        result: `Pulled ${pullResult.summary.changes} changes, ${pullResult.summary.insertions} insertions, ${pullResult.summary.deletions} deletions`,
        details: pullResult,
      };
    }
    case "push": {
      await git.add(".");
      const status = await git.status();
      if (!status.isClean()) {
        await git.commit(`vault sync: ${new Date().toISOString()}`);
      }
      await git.push("origin", branch);
      return {
        action: "push",
        result: "Pushed to remote successfully",
      };
    }
    case "sync": {
      // Pull first, then push
      const pullResult = await git.pull("origin", branch, ["--rebase"]);
      await git.add(".");
      const status = await git.status();
      if (!status.isClean()) {
        await git.commit(`vault sync: ${new Date().toISOString()}`);
      }
      await git.push("origin", branch);
      return {
        action: "sync",
        result: `Synced — pulled ${pullResult.summary.changes} changes, pushed local changes`,
        details: { pull: pullResult.summary },
      };
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

export function getVaultStats(config: ObsidianConfig): {
  noteCount: number;
  folderCount: number;
  totalSize: number;
  vaultPath: string;
} {
  const vaultRoot = getVaultPath(config);
  const patterns = getExcludePatterns(config);
  const notes = walkDir(vaultRoot, vaultRoot, patterns);

  const folders = new Set<string>();
  let totalSize = 0;

  for (const relPath of notes) {
    const dir = path.dirname(relPath);
    if (dir !== ".") folders.add(dir);
    try {
      const stat = fs.statSync(path.join(vaultRoot, relPath));
      totalSize += stat.size;
    } catch {
      // skip
    }
  }

  return {
    noteCount: notes.length,
    folderCount: folders.size,
    totalSize,
    vaultPath: vaultRoot,
  };
}
