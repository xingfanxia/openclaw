export interface ObsidianConfig {
  vaultPath: string;
  gitRemote?: string;
  gitBranch?: string;
  autoSync?: boolean;
  excludePatterns?: string[];
}

export interface ObsidianNote {
  path: string;
  name: string;
  content: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  links: WikiLink[];
  lastModified: string;
}

export interface WikiLink {
  target: string;
  display?: string;
  raw: string;
}

export interface NoteListEntry {
  path: string;
  name: string;
  lastModified: string;
  size: number;
}

export function getVaultPath(config: ObsidianConfig): string {
  return config.vaultPath.replace(/\/+$/, "");
}

export function getExcludePatterns(config: ObsidianConfig): string[] {
  return config.excludePatterns ?? [".obsidian"];
}

export function getGitBranch(config: ObsidianConfig): string {
  return config.gitBranch ?? "main";
}

export function parseWikiLinks(content: string): WikiLink[] {
  const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  const links: WikiLink[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    links.push({
      target: match[1].trim(),
      display: match[2]?.trim(),
      raw: match[0],
    });
  }
  return links;
}

export function extractTags(content: string, frontmatter: Record<string, unknown>): string[] {
  const tagSet = new Set<string>();

  // Tags from frontmatter
  const fmTags = frontmatter.tags;
  if (Array.isArray(fmTags)) {
    for (const t of fmTags) {
      if (typeof t === "string") tagSet.add(t.replace(/^#/, ""));
    }
  } else if (typeof fmTags === "string") {
    tagSet.add(fmTags.replace(/^#/, ""));
  }

  // Inline tags: #tag (not inside code blocks or links)
  const inlineRegex = /(?:^|\s)#([a-zA-Z0-9_/-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = inlineRegex.exec(content)) !== null) {
    tagSet.add(match[1]);
  }

  return [...tagSet].sort();
}
