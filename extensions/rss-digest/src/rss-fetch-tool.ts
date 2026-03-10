import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { fetchAllFeeds, filterByAge, enrichWithContent } from "./feed-fetcher.js";
import type { RssDigestConfig } from "./types.js";

export function createRssFetchTool(config: RssDigestConfig): AnyAgentTool {
  return {
    name: "rss_fetch",
    description:
      "Fetch recent posts from configured RSS/Atom feeds. Returns titles, links, sources, and summaries sorted by date. Set include_content=true to also fetch and return each article's text (for AI summarization).",
    parameters: Type.Object({
      max_age_hours: Type.Optional(
        Type.Number({
          description: "Only return posts newer than this many hours (default: from config or 24)",
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum number of posts to return (default: 50)",
          default: 50,
        }),
      ),
      source_filter: Type.Optional(
        Type.String({
          description: "Only return posts from sources matching this substring (case-insensitive)",
        }),
      ),
      include_content: Type.Optional(
        Type.Boolean({
          description:
            "If true, fetch each article's full page and return extracted text (~1500 chars per article). Slower but enables AI summarization.",
          default: false,
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        max_age_hours?: number;
        limit?: number;
        source_filter?: string;
        include_content?: boolean;
      },
    ) => {
      try {
        const maxAge = params.max_age_hours ?? config.maxAgeHours ?? 24;
        const limit = params.limit ?? 50;

        const allItems = await fetchAllFeeds(config);
        let filtered = filterByAge(allItems, maxAge);

        if (params.source_filter) {
          const q = params.source_filter.toLowerCase();
          filtered = filtered.filter(
            (item) =>
              item.source.toLowerCase().includes(q) || item.sourceUrl.toLowerCase().includes(q),
          );
        }

        let items = filtered.slice(0, limit);

        if (params.include_content) {
          items = await enrichWithContent(items);
        }

        const result = {
          totalFetched: allItems.length,
          matchingRecent: filtered.length,
          returned: items.length,
          maxAgeHours: maxAge,
          items: items.map((item) => ({
            title: item.title,
            link: item.link,
            source: item.source,
            pubDate: item.pubDate,
            summary: item.summary,
            ...(item.content ? { content: item.content } : {}),
          })),
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: message }, null, 2),
            },
          ],
          details: { error: message },
        };
      }
    },
  } as AnyAgentTool;
}
