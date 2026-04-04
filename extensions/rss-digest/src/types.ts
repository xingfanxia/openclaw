export interface RssDigestConfig {
  opmlUrl?: string;
  feeds?: string[];
  cacheTtlMinutes?: number;
  maxAgeHours?: number;
}

export interface FeedItem {
  title: string;
  link: string;
  pubDate: string;
  pubDateMs: number;
  source: string;
  sourceUrl: string;
  summary?: string;
  content?: string;
}

export interface FeedCache {
  fetchedAtMs: number;
  items: FeedItem[];
}
