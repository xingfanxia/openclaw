import { fetchAllFeeds, filterByAge } from "./feed-fetcher.js";
import type { RssDigestConfig } from "./types.js";

export async function handleRssCommand(config: RssDigestConfig, args: string): Promise<string> {
  const parts = args.split(/\s+/).filter(Boolean);
  let maxAge = config.maxAgeHours ?? 24;
  let limit = 30;

  for (const p of parts) {
    const num = parseInt(p, 10);
    if (!Number.isNaN(num)) {
      if (num <= 168)
        maxAge = num; // treat as hours if <= 1 week
      else limit = num;
    }
  }

  const allItems = await fetchAllFeeds(config);
  const recent = filterByAge(allItems, maxAge);
  const items = recent.slice(0, limit);

  if (items.length === 0) {
    return `No new posts in the last ${maxAge}h across ${allItems.length} total cached posts.`;
  }

  const lines: string[] = [];
  lines.push(`\u{1F4F0} RSS Digest (last ${maxAge}h) \u2014 ${items.length} posts\n`);

  // Group by source
  const bySource = new Map<string, typeof items>();
  for (const item of items) {
    const existing = bySource.get(item.source) ?? [];
    existing.push(item);
    bySource.set(item.source, existing);
  }

  // Sort sources by most recent post
  const sortedSources = [...bySource.entries()].sort(
    (a, b) => b[1][0].pubDateMs - a[1][0].pubDateMs,
  );

  for (const [source, sourceItems] of sortedSources) {
    lines.push(`**${source}**`);
    for (const item of sourceItems.slice(0, 3)) {
      const ago = formatAgo(item.pubDateMs);
      lines.push(`  \u2022 [${item.title}](${item.link}) (${ago})`);
    }
    if (sourceItems.length > 3) {
      lines.push(`  ... +${sourceItems.length - 3} more`);
    }
    lines.push("");
  }

  lines.push(`Usage: /rss [hours] [limit]`);
  return lines.join("\n");
}

function formatAgo(ms: number): string {
  const diff = Date.now() - ms;
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
