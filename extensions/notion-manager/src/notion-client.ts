import { Client } from "@notionhq/client";
import type {
  NotionConfig,
  NotionPage,
  NotionDatabase,
  NotionBlock,
  NotionComment,
} from "./types.js";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 400;

let client: Client | null = null;

export function getClient(config: NotionConfig): Client {
  if (!client) {
    if (!config.integrationToken) {
      throw new Error(
        "Notion integration token not configured. Set integrationToken in plugin config.",
      );
    }
    client = new Client({ auth: config.integrationToken });
  }
  return client;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const status = (err as { status?: number }).status;
      if (status === 429 || status === 502 || status === 503) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// --- Block to text conversion ---

function extractRichText(richText: Array<{ plain_text: string }>): string {
  return richText.map((t) => t.plain_text).join("");
}

function blockToText(block: Record<string, unknown>): string {
  const type = block.type as string;
  const data = block[type] as Record<string, unknown> | undefined;
  if (!data) return "";

  const richText = data.rich_text as Array<{ plain_text: string }> | undefined;
  const text = richText ? extractRichText(richText) : "";

  switch (type) {
    case "paragraph":
      return text;
    case "heading_1":
      return `# ${text}`;
    case "heading_2":
      return `## ${text}`;
    case "heading_3":
      return `### ${text}`;
    case "bulleted_list_item":
      return `- ${text}`;
    case "numbered_list_item":
      return `1. ${text}`;
    case "to_do": {
      const checked = (data.checked as boolean) ? "x" : " ";
      return `- [${checked}] ${text}`;
    }
    case "toggle":
      return `> ${text}`;
    case "quote":
      return `> ${text}`;
    case "code": {
      const lang = (data.language as string) || "";
      return "```" + lang + "\n" + text + "\n```";
    }
    case "divider":
      return "---";
    case "callout":
      return `> ${text}`;
    case "image": {
      const imgData = data as Record<string, unknown>;
      const fileData = (imgData.file ?? imgData.external) as { url: string } | undefined;
      return fileData ? `![image](${fileData.url})` : "[image]";
    }
    case "bookmark": {
      const url = (data as { url?: string }).url ?? "";
      return `[bookmark](${url})`;
    }
    case "child_page":
      return `[child page: ${(data as { title?: string }).title ?? "untitled"}]`;
    case "child_database":
      return `[child database: ${(data as { title?: string }).title ?? "untitled"}]`;
    default:
      return text || `[${type}]`;
  }
}

// --- Text/markdown to Notion blocks ---

interface RichTextItem {
  type: "text";
  text: { content: string };
}

function makeRichText(text: string): RichTextItem[] {
  return [{ type: "text", text: { content: text } }];
}

interface NotionBlockInput {
  object: "block";
  type: string;
  [key: string]: unknown;
}

export function textToBlocks(content: string): NotionBlockInput[] {
  const lines = content.split("\n");
  const blocks: NotionBlockInput[] = [];
  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("```") && !inCodeBlock) {
      inCodeBlock = true;
      codeLanguage = line.slice(3).trim() || "plain text";
      codeLines = [];
      continue;
    }
    if (line.startsWith("```") && inCodeBlock) {
      inCodeBlock = false;
      blocks.push({
        object: "block",
        type: "code",
        code: {
          rich_text: makeRichText(codeLines.join("\n")),
          language: codeLanguage,
        },
      });
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line === "---" || line === "***") {
      blocks.push({ object: "block", type: "divider", divider: {} });
    } else if (line.startsWith("### ")) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: { rich_text: makeRichText(line.slice(4)) },
      });
    } else if (line.startsWith("## ")) {
      blocks.push({
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: makeRichText(line.slice(3)) },
      });
    } else if (line.startsWith("# ")) {
      blocks.push({
        object: "block",
        type: "heading_1",
        heading_1: { rich_text: makeRichText(line.slice(2)) },
      });
    } else if (/^- \[[ x]\] /.test(line)) {
      const checked = line[3] === "x";
      const text = line.slice(6);
      blocks.push({
        object: "block",
        type: "to_do",
        to_do: { rich_text: makeRichText(text), checked },
      });
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: makeRichText(line.slice(2)) },
      });
    } else if (/^\d+\.\s/.test(line)) {
      const text = line.replace(/^\d+\.\s/, "");
      blocks.push({
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: makeRichText(text) },
      });
    } else if (line.startsWith("> ")) {
      blocks.push({
        object: "block",
        type: "quote",
        quote: { rich_text: makeRichText(line.slice(2)) },
      });
    } else {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: makeRichText(line) },
      });
    }
  }

  // Handle unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    blocks.push({
      object: "block",
      type: "code",
      code: {
        rich_text: makeRichText(codeLines.join("\n")),
        language: codeLanguage,
      },
    });
  }

  return blocks;
}

// --- Page reading with recursive children ---

export async function readPageBlocks(
  config: NotionConfig,
  pageId: string,
  depth: number = 0,
  maxDepth: number = 3,
): Promise<string[]> {
  const notion = getClient(config);
  const lines: string[] = [];
  let cursor: string | undefined;

  do {
    const response = await withRetry(() =>
      notion.blocks.children.list({
        block_id: pageId,
        start_cursor: cursor,
        page_size: 100,
      }),
    );

    for (const block of response.results) {
      const b = block as Record<string, unknown>;
      const text = blockToText(b);
      const indent = "  ".repeat(depth);
      if (text) {
        lines.push(indent + text);
      }
      if ((b.has_children as boolean) && depth < maxDepth) {
        const childLines = await readPageBlocks(config, b.id as string, depth + 1, maxDepth);
        lines.push(...childLines);
      }
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return lines;
}

// --- Search ---

export async function searchNotion(
  config: NotionConfig,
  query: string,
  filterType?: "page" | "database",
): Promise<Array<NotionPage | NotionDatabase>> {
  const notion = getClient(config);
  const params: Record<string, unknown> = {
    query,
    page_size: 20,
  };
  if (filterType) {
    params.filter = { value: filterType, property: "object" };
  }

  const response = await withRetry(() =>
    notion.search(params as Parameters<typeof notion.search>[0]),
  );
  return response.results.map((r) => parseSearchResult(r as Record<string, unknown>));
}

function extractTitle(properties: Record<string, unknown>): string {
  for (const val of Object.values(properties)) {
    const prop = val as Record<string, unknown>;
    if (prop.type === "title") {
      const titleArr = prop.title as Array<{ plain_text: string }> | undefined;
      if (titleArr && titleArr.length > 0) {
        return extractRichText(titleArr);
      }
    }
  }
  return "Untitled";
}

function parseSearchResult(result: Record<string, unknown>): NotionPage | NotionDatabase {
  const object = result.object as string;
  const props = (result.properties ?? {}) as Record<string, unknown>;

  if (object === "database") {
    const titleArr = result.title as Array<{ plain_text: string }> | undefined;
    const dbProps: Record<string, { type: string; name: string }> = {};
    for (const [key, val] of Object.entries(props)) {
      const p = val as Record<string, unknown>;
      dbProps[key] = { type: p.type as string, name: p.name as string };
    }
    return {
      id: result.id as string,
      title: titleArr ? extractRichText(titleArr) : "Untitled",
      url: result.url as string,
      createdTime: result.created_time as string,
      lastEditedTime: result.last_edited_time as string,
      properties: dbProps,
    } as NotionDatabase;
  }

  const parent = result.parent as Record<string, unknown>;
  let parentType: NotionPage["parentType"] = "workspace";
  let parentId: string | null = null;
  if (parent.database_id) {
    parentType = "database_id";
    parentId = parent.database_id as string;
  } else if (parent.page_id) {
    parentType = "page_id";
    parentId = parent.page_id as string;
  }

  return {
    id: result.id as string,
    title: extractTitle(props),
    url: result.url as string,
    createdTime: result.created_time as string,
    lastEditedTime: result.last_edited_time as string,
    archived: result.archived as boolean,
    parentType,
    parentId,
    properties: props,
  } as NotionPage;
}

// --- Create page ---

export async function createPage(
  config: NotionConfig,
  parentId: string,
  title: string,
  content?: string,
  properties?: Record<string, unknown>,
  parentType?: "database_id" | "page_id",
): Promise<NotionPage> {
  const notion = getClient(config);

  const parent: Record<string, string> =
    parentType === "page_id" ? { page_id: parentId } : { database_id: parentId };

  const titleProperty =
    parentType === "page_id" ? { title: [{ text: { content: title } }] } : undefined;

  const pageProperties: Record<string, unknown> = properties ? { ...properties } : {};

  if (parentType === "page_id" || !parentType) {
    // For page parents, set title as child_page title via properties
    if (!properties) {
      pageProperties.title = [{ text: { content: title } }];
    }
  } else {
    // For database parents, set the title property
    if (
      !properties ||
      !Object.values(properties).some((v) => (v as Record<string, unknown>).title)
    ) {
      pageProperties.Name = { title: [{ text: { content: title } }] };
    }
  }

  const children = content ? textToBlocks(content) : [];

  const response = await withRetry(() =>
    notion.pages.create({
      parent: parent as { database_id: string } | { page_id: string },
      properties: pageProperties as Parameters<typeof notion.pages.create>[0]["properties"],
      children: children as Parameters<typeof notion.pages.create>[0]["children"],
    }),
  );

  const r = response as unknown as Record<string, unknown>;
  const props = (r.properties ?? {}) as Record<string, unknown>;
  const rParent = r.parent as Record<string, unknown>;

  return {
    id: r.id as string,
    title,
    url: r.url as string,
    createdTime: r.created_time as string,
    lastEditedTime: r.last_edited_time as string,
    archived: false,
    parentType: rParent.database_id ? "database_id" : "page_id",
    parentId: (rParent.database_id ?? rParent.page_id ?? null) as string | null,
    properties: props,
  };
}

// --- Update page ---

export async function updatePage(
  config: NotionConfig,
  pageId: string,
  properties?: Record<string, unknown>,
  archived?: boolean,
): Promise<NotionPage> {
  const notion = getClient(config);
  const params: Record<string, unknown> = { page_id: pageId };
  if (properties) params.properties = properties;
  if (archived !== undefined) params.archived = archived;

  const response = await withRetry(() =>
    notion.pages.update(params as Parameters<typeof notion.pages.update>[0]),
  );

  const r = response as unknown as Record<string, unknown>;
  const props = (r.properties ?? {}) as Record<string, unknown>;
  const rParent = r.parent as Record<string, unknown>;

  return {
    id: r.id as string,
    title: extractTitle(props),
    url: r.url as string,
    createdTime: r.created_time as string,
    lastEditedTime: r.last_edited_time as string,
    archived: r.archived as boolean,
    parentType: rParent.database_id ? "database_id" : rParent.page_id ? "page_id" : "workspace",
    parentId: (rParent.database_id ?? rParent.page_id ?? null) as string | null,
    properties: props,
  };
}

// --- List databases ---

export async function listDatabases(config: NotionConfig): Promise<NotionDatabase[]> {
  return (await searchNotion(config, "", "database")) as NotionDatabase[];
}

// --- Query database ---

export async function queryDatabase(
  config: NotionConfig,
  databaseId: string,
  filter?: Record<string, unknown>,
  sorts?: Array<Record<string, unknown>>,
  maxResults: number = 50,
): Promise<NotionPage[]> {
  const notion = getClient(config);
  const params: Record<string, unknown> = {
    database_id: databaseId,
    page_size: Math.min(maxResults, 100),
  };
  if (filter) params.filter = filter;
  if (sorts) params.sorts = sorts;

  const response = await withRetry(() =>
    notion.databases.query(params as Parameters<typeof notion.databases.query>[0]),
  );

  return response.results.map((r) => {
    const result = r as unknown as Record<string, unknown>;
    const props = (result.properties ?? {}) as Record<string, unknown>;
    const parent = result.parent as Record<string, unknown>;
    return {
      id: result.id as string,
      title: extractTitle(props),
      url: result.url as string,
      createdTime: result.created_time as string,
      lastEditedTime: result.last_edited_time as string,
      archived: result.archived as boolean,
      parentType: parent.database_id ? "database_id" : parent.page_id ? "page_id" : "workspace",
      parentId: (parent.database_id ?? parent.page_id ?? null) as string | null,
      properties: props,
    } as NotionPage;
  });
}

// --- Comments ---

export async function getComments(config: NotionConfig, pageId: string): Promise<NotionComment[]> {
  const notion = getClient(config);
  const response = await withRetry(() => notion.comments.list({ block_id: pageId }));

  return response.results.map((c) => {
    const comment = c as Record<string, unknown>;
    const richText = (comment.rich_text as Array<{ plain_text: string }>) ?? [];
    const createdBy = comment.created_by as Record<string, unknown>;
    return {
      id: comment.id as string,
      createdTime: comment.created_time as string,
      createdBy: (createdBy.id ?? "unknown") as string,
      text: extractRichText(richText),
    };
  });
}

export async function addComment(
  config: NotionConfig,
  pageId: string,
  text: string,
): Promise<NotionComment> {
  const notion = getClient(config);
  const response = await withRetry(() =>
    notion.comments.create({
      parent: { page_id: pageId },
      rich_text: [{ type: "text", text: { content: text } }],
    }),
  );

  const r = response as unknown as Record<string, unknown>;
  const richText = (r.rich_text as Array<{ plain_text: string }>) ?? [];
  const createdBy = r.created_by as Record<string, unknown>;
  return {
    id: r.id as string,
    createdTime: r.created_time as string,
    createdBy: (createdBy.id ?? "unknown") as string,
    text: extractRichText(richText),
  };
}

// --- Append blocks ---

export async function appendBlocks(
  config: NotionConfig,
  pageId: string,
  content: string,
): Promise<{ blocksAdded: number }> {
  const notion = getClient(config);
  const blocks = textToBlocks(content);

  // Notion API limits to 100 blocks per request
  const chunks: NotionBlockInput[][] = [];
  for (let i = 0; i < blocks.length; i += 100) {
    chunks.push(blocks.slice(i, i + 100));
  }

  let totalAdded = 0;
  for (const chunk of chunks) {
    await withRetry(() =>
      notion.blocks.children.append({
        block_id: pageId,
        children: chunk as Parameters<typeof notion.blocks.children.append>[0]["children"],
      }),
    );
    totalAdded += chunk.length;
  }

  return { blocksAdded: totalAdded };
}

// --- Get workspace info (for status command) ---

export async function getWorkspaceInfo(
  config: NotionConfig,
): Promise<{ botName: string; workspaceName: string; workspaceId: string }> {
  const notion = getClient(config);
  const me = await withRetry(() => notion.users.me({}));
  const bot = me as unknown as Record<string, unknown>;
  const botInfo = bot.bot as Record<string, unknown> | undefined;
  const workspace = botInfo?.workspace_name as string | undefined;

  return {
    botName: (bot.name ?? "Unknown") as string,
    workspaceName: workspace ?? config.defaultWorkspace ?? "Unknown",
    workspaceId: ((botInfo?.owner as Record<string, unknown>)?.workspace as string) ?? "unknown",
  };
}
