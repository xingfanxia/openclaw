export interface NotionConfig {
  integrationToken: string;
  defaultWorkspace?: string;
}

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  createdTime: string;
  lastEditedTime: string;
  archived: boolean;
  parentType: "database_id" | "page_id" | "workspace";
  parentId: string | null;
  properties: Record<string, unknown>;
}

export interface NotionDatabase {
  id: string;
  title: string;
  url: string;
  createdTime: string;
  lastEditedTime: string;
  properties: Record<string, { type: string; name: string }>;
}

export interface NotionBlock {
  id: string;
  type: string;
  hasChildren: boolean;
  content: string;
  children?: NotionBlock[];
}

export interface NotionComment {
  id: string;
  createdTime: string;
  createdBy: string;
  text: string;
}
