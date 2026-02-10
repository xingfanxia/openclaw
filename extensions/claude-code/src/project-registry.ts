import { execFile } from "node:child_process";
import { readdir, access, readFile, constants } from "node:fs/promises";
import { join, basename } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProjectEntry {
  id: string;
  path: string;
  description?: string;
  language?: string;
  keywords: string[];
  isGitRepo: boolean;
  defaultBranch?: string;
}

export interface ProjectRegistryConfig {
  autoScan?: boolean;
  scanPaths?: string[];
  scanDepth?: number;
  overrides?: Array<{
    id: string;
    path: string;
    description?: string;
    keywords?: string[];
    language?: string;
  }>;
}

export class ProjectRegistry {
  private config: ProjectRegistryConfig;
  private entries: ProjectEntry[] = [];

  constructor(config: ProjectRegistryConfig) {
    this.config = config;
  }

  async scan(): Promise<ProjectEntry[]> {
    const discovered: ProjectEntry[] = [];
    const scanPaths = this.config.scanPaths ?? [];
    const scanDepth = this.config.scanDepth ?? 2;

    for (const scanPath of scanPaths) {
      try {
        const entries = await this.scanDirectory(scanPath, scanDepth);
        discovered.push(...entries);
      } catch {
        // Skip directories that cannot be read
      }
    }

    // Merge with overrides — overrides take precedence by id
    const overrides = this.config.overrides ?? [];
    const overrideMap = new Map(
      overrides.map((o) => [
        o.id,
        {
          id: o.id,
          path: o.path,
          description: o.description,
          language: o.language,
          keywords: o.keywords ?? generateKeywords(o.id, o.language),
          isGitRepo: false,
        } satisfies ProjectEntry,
      ]),
    );

    const merged: ProjectEntry[] = [];
    const seen = new Set<string>();

    // Overrides first
    for (const [id, entry] of overrideMap) {
      merged.push(entry);
      seen.add(id);
    }

    // Then discovered entries not already overridden
    for (const entry of discovered) {
      if (!seen.has(entry.id)) {
        merged.push(entry);
        seen.add(entry.id);
      }
    }

    this.entries = merged;
    return this.entries;
  }

  resolve(query: string): ProjectEntry | null {
    const q = query.toLowerCase();
    const queryWords = q.split(/[\s\-_\/]+/).filter(Boolean);

    // 1. Exact match on id
    const exact = this.entries.find((e) => e.id.toLowerCase() === q);
    if (exact) return exact;

    // 2. Substring match (query contains id or id contains query)
    const substringMatches = this.entries.filter(
      (e) => q.includes(e.id.toLowerCase()) || e.id.toLowerCase().includes(q),
    );
    if (substringMatches.length === 1) return substringMatches[0];
    if (substringMatches.length > 1) {
      // Tiebreak: shorter id wins
      return substringMatches.sort((a, b) => a.id.length - b.id.length)[0];
    }

    // 3. Keyword scoring
    const scored = this.entries
      .map((entry) => {
        const score = queryWords.filter((w) =>
          entry.keywords.some((k) => k.includes(w) || w.includes(k)),
        ).length;
        return { entry, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) =>
        b.score !== a.score ? b.score - a.score : a.entry.id.length - b.entry.id.length,
      );

    return scored.length > 0 ? scored[0].entry : null;
  }

  list(): ProjectEntry[] {
    return [...this.entries];
  }

  async rescan(): Promise<ProjectEntry[]> {
    this.entries = [];
    return this.scan();
  }

  private async scanDirectory(dirPath: string, depth: number): Promise<ProjectEntry[]> {
    if (depth <= 0) return [];

    const results: ProjectEntry[] = [];

    let dirEntries;
    try {
      dirEntries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const dirent of dirEntries) {
      if (!dirent.isDirectory() || dirent.name.startsWith(".")) continue;

      const fullPath = join(dirPath, dirent.name);
      const isGitRepo = await checkIsGitRepo(fullPath);

      if (isGitRepo) {
        const entry = await buildProjectEntry(fullPath);
        results.push(entry);
      } else if (depth > 1) {
        const nested = await this.scanDirectory(fullPath, depth - 1);
        results.push(...nested);
      }
    }

    return results;
  }
}

function generateKeywords(id: string, language?: string): string[] {
  const words = id
    .toLowerCase()
    .split(/[\-_\/]+/)
    .filter(Boolean);
  if (language) {
    words.push(language.toLowerCase());
  }
  return [...new Set(words)];
}

async function checkIsGitRepo(dirPath: string): Promise<boolean> {
  try {
    await access(join(dirPath, ".git"), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function getDefaultBranch(dirPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
      { cwd: dirPath },
    );
    const ref = stdout.trim();
    // Returns something like "origin/main" — strip prefix
    return ref.replace(/^origin\//, "");
  } catch {
    // Fallback: check if main or master exists
    try {
      await execFileAsync("git", ["rev-parse", "--verify", "main"], {
        cwd: dirPath,
      });
      return "main";
    } catch {
      try {
        await execFileAsync("git", ["rev-parse", "--verify", "master"], {
          cwd: dirPath,
        });
        return "master";
      } catch {
        return undefined;
      }
    }
  }
}

async function detectLanguage(dirPath: string): Promise<string | undefined> {
  // Check package.json
  try {
    const pkg = JSON.parse(await readFile(join(dirPath, "package.json"), "utf-8"));
    if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
      return "typescript";
    }
    return "javascript";
  } catch {
    // Not a JS project
  }

  // Check pyproject.toml or setup.py
  try {
    await access(join(dirPath, "pyproject.toml"), constants.F_OK);
    return "python";
  } catch {
    // Not python
  }
  try {
    await access(join(dirPath, "setup.py"), constants.F_OK);
    return "python";
  } catch {
    // Not python
  }

  // Check go.mod
  try {
    await access(join(dirPath, "go.mod"), constants.F_OK);
    return "go";
  } catch {
    // Not go
  }

  // Check Cargo.toml
  try {
    await access(join(dirPath, "Cargo.toml"), constants.F_OK);
    return "rust";
  } catch {
    // Not rust
  }

  return undefined;
}

async function getDescription(dirPath: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(await readFile(join(dirPath, "package.json"), "utf-8"));
    return pkg.description;
  } catch {
    // No package.json or no description
  }

  try {
    const toml = await readFile(join(dirPath, "pyproject.toml"), "utf-8");
    const match = toml.match(/description\s*=\s*"([^"]+)"/);
    return match?.[1];
  } catch {
    // No pyproject.toml
  }

  return undefined;
}

async function buildProjectEntry(dirPath: string): Promise<ProjectEntry> {
  const id = basename(dirPath);
  const [language, description, defaultBranch] = await Promise.all([
    detectLanguage(dirPath),
    getDescription(dirPath),
    getDefaultBranch(dirPath),
  ]);

  return {
    id,
    path: dirPath,
    description,
    language,
    keywords: generateKeywords(id, language),
    isGitRepo: true,
    defaultBranch,
  };
}
