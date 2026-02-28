import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { getComments, addComment } from "../notion-client.js";
import type { NotionConfig } from "../types.js";
import { resolveAccount } from "../types.js";

export function createNotionCommentsTool(config: NotionConfig): AnyAgentTool {
  return {
    name: "notion_comments",
    description:
      'Read or add comments on a Notion page. Use action "read" to list existing comments, or "add" to post a new comment.',
    parameters: Type.Object({
      page_id: Type.String({
        description: "The page ID to read/add comments on",
      }),
      action: Type.Union([Type.Literal("read"), Type.Literal("add")], {
        description: '"read" to list comments, "add" to post a new comment',
      }),
      comment_text: Type.Optional(
        Type.String({
          description: 'The comment text to add (required when action is "add")',
        }),
      ),
      account_id: Type.Optional(
        Type.String({
          description: "Account to use (e.g. 'work', 'personal'). Defaults to work account.",
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        page_id: string;
        action: "read" | "add";
        comment_text?: string;
        account_id?: string;
      },
    ) => {
      const account = resolveAccount(params.account_id, config);
      const token = account.integrationToken;

      if (params.action === "add") {
        if (!params.comment_text) {
          const result = { error: "comment_text is required when action is 'add'" };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        }
        const comment = await addComment(token, params.page_id, params.comment_text);
        const result = {
          action: "add",
          account: account.id,
          comment: {
            id: comment.id,
            createdTime: comment.createdTime,
            text: comment.text,
          },
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      const comments = await getComments(token, params.page_id);
      const result = {
        action: "read",
        account: account.id,
        pageId: params.page_id,
        commentCount: comments.length,
        comments: comments.map((c) => ({
          id: c.id,
          createdTime: c.createdTime,
          createdBy: c.createdBy,
          text: c.text,
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  } as AnyAgentTool;
}
