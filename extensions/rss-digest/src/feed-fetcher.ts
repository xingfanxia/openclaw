import type { FeedItem, FeedCache, RssDigestConfig } from "./types.js";

const cache = new Map<string, FeedCache>();

function defaultCacheTtl(config: RssDigestConfig): number {
  return (config.cacheTtlMinutes ?? 60) * 60 * 1000;
}

function parsePubDate(raw: string): number {
  if (!raw) return 0;
  const ms = Date.parse(raw.trim());
  return Number.isNaN(ms) ? 0 : ms;
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3).trimEnd() + "...";
}

function getTagContent(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? stripCdata(m[1]).trim() : "";
}

function getAttr(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*?${attr}=["']([^"']*)["']`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

function parseRssItems(xml: string, sourceUrl: string): FeedItem[] {
  const items: FeedItem[] = [];
  const channelMatch = xml.match(/<channel[\s>]([\s\S]*)<\/channel>/i);
  if (!channelMatch) return items;
  const channel = channelMatch[1];

  const sourceName = stripHtml(getTagContent(channel, "title")) || sourceUrl;
  const itemBlocks = channel.split(/<item[\s>]/i).slice(1);

  for (const block of itemBlocks) {
    const itemXml = block.split(/<\/item>/i)[0] ?? "";
    const title = stripHtml(getTagContent(itemXml, "title"));
    const link = getTagContent(itemXml, "link").trim() || getTagContent(itemXml, "guid").trim();
    const pubDateStr = getTagContent(itemXml, "pubDate") || getTagContent(itemXml, "dc:date");
    const pubDateMs = parsePubDate(pubDateStr);
    const description = getTagContent(itemXml, "description");

    if (!title || !link) continue;

    items.push({
      title,
      link,
      pubDate: pubDateMs ? new Date(pubDateMs).toISOString() : "",
      pubDateMs,
      source: sourceName,
      sourceUrl,
      summary: description ? truncate(stripHtml(description), 200) : undefined,
    });
  }

  return items;
}

function parseAtomItems(xml: string, sourceUrl: string): FeedItem[] {
  const items: FeedItem[] = [];
  const feedMatch = xml.match(/<feed[\s>]([\s\S]*)<\/feed>/i);
  if (!feedMatch) return items;
  const feed = feedMatch[1];

  const sourceName = stripHtml(getTagContent(feed, "title")) || sourceUrl;
  const entryBlocks = feed.split(/<entry[\s>]/i).slice(1);

  for (const block of entryBlocks) {
    const entryXml = block.split(/<\/entry>/i)[0] ?? "";
    const title = stripHtml(getTagContent(entryXml, "title"));

    let link = getAttr(entryXml, "link[^>]*rel=[\"']alternate", "href");
    if (!link) link = getAttr(entryXml, "link", "href");
    if (!link) link = getTagContent(entryXml, "link");

    const pubDateStr =
      getTagContent(entryXml, "published") ||
      getTagContent(entryXml, "updated") ||
      getTagContent(entryXml, "dc:date");
    const pubDateMs = parsePubDate(pubDateStr);

    const summary = getTagContent(entryXml, "summary") || getTagContent(entryXml, "content");

    if (!title || !link) continue;

    items.push({
      title,
      link,
      pubDate: pubDateMs ? new Date(pubDateMs).toISOString() : "",
      pubDateMs,
      source: sourceName,
      sourceUrl,
      summary: summary ? truncate(stripHtml(summary), 200) : undefined,
    });
  }

  return items;
}

function parseFeedXml(xml: string, sourceUrl: string): FeedItem[] {
  const rssItems = parseRssItems(xml, sourceUrl);
  if (rssItems.length > 0) return rssItems;
  return parseAtomItems(xml, sourceUrl);
}

async function fetchSingleFeed(url: string, timeoutMs = 10000): Promise<FeedItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "OpenClaw-RSS/1.0" },
      redirect: "follow",
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseFeedXml(xml, url);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function parseOpml(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "OpenClaw-RSS/1.0" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const feeds: string[] = [];
    const re = /xmlUrl=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      feeds.push(m[1]);
    }
    return feeds;
  } catch {
    return [];
  }
}

export async function fetchAllFeeds(config: RssDigestConfig): Promise<FeedItem[]> {
  const ttl = defaultCacheTtl(config);
  const cacheKey = "all";
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAtMs < ttl) {
    return cached.items;
  }

  let feedUrls = config.feeds ?? [];
  if (config.opmlUrl) {
    const opmlFeeds = await parseOpml(config.opmlUrl);
    feedUrls = [...new Set([...feedUrls, ...opmlFeeds])];
  }

  if (feedUrls.length === 0) return [];

  const batchSize = 15;
  const allItems: FeedItem[] = [];

  for (let i = 0; i < feedUrls.length; i += batchSize) {
    const batch = feedUrls.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map((url) => fetchSingleFeed(url)));
    for (const r of results) {
      if (r.status === "fulfilled") allItems.push(...r.value);
    }
  }

  allItems.sort((a, b) => b.pubDateMs - a.pubDateMs);

  cache.set(cacheKey, { fetchedAtMs: Date.now(), items: allItems });
  return allItems;
}

export function filterByAge(items: FeedItem[], maxAgeHours: number): FeedItem[] {
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  return items.filter((item) => item.pubDateMs >= cutoff);
}

function extractArticleText(html: string): string {
  // Remove script, style, nav, header, footer, aside tags entirely
  let clean = html
    .replace(/<(script|style|nav|header|footer|aside|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Try to extract <article> or <main> content first
  const articleMatch = clean.match(/<(?:article|main)[^>]*>([\s\S]*?)<\/(?:article|main)>/i);
  if (articleMatch) clean = articleMatch[1];

  // Strip remaining HTML tags and decode entities
  return stripHtml(clean);
}

async function fetchArticleText(url: string, maxChars: number, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "OpenClaw-RSS/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) return "";
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("xml")) return "";
    const html = await res.text();
    const text = extractArticleText(html);
    return truncate(text, maxChars);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichWithContent(
  items: FeedItem[],
  maxCharsPerArticle = 1500,
): Promise<FeedItem[]> {
  const batchSize = 10;
  const enriched: FeedItem[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        const content = await fetchArticleText(item.link, maxCharsPerArticle);
        return { ...item, content: content || undefined };
      }),
    );
    for (const r of results) {
      enriched.push(r.status === "fulfilled" ? r.value : items[i]!);
    }
  }

  return enriched;
}
