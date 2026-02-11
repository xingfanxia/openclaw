import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import type { OAuthConfig } from "../oauth2.js";
import {
  modifyMessage,
  batchModifyMessages,
  trashMessage,
  findOrCreateLabel,
  searchEmails,
} from "../gmail-client.js";

interface AccountConfig {
  id: string;
  email: string;
  type: string;
}

export function createGmailManageTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
): AnyAgentTool {
  return {
    name: "gmail_manage",
    description:
      "Manage Gmail messages: mark as read/unread, archive, star, apply labels, or trash. " +
      "Can act on specific message IDs or search for messages matching a query and apply actions to all matches. " +
      "Use for retroactive organization (e.g., 'mark all CI emails as read and apply GitHub/CI label').",
    parameters: Type.Object({
      account_id: Type.String({
        description: "Account ID to manage messages on",
      }),
      message_ids: Type.Optional(
        Type.Array(Type.String(), {
          description: "Specific message IDs to modify. Use gmail_search to find IDs first.",
        }),
      ),
      query: Type.Optional(
        Type.String({
          description:
            "Gmail search query to find messages (e.g., 'from:noreply@github.com subject:CI'). " +
            "All matching messages will have the actions applied. Max 100 messages.",
        }),
      ),
      mark_read: Type.Optional(Type.Boolean({ description: "Mark messages as read" })),
      mark_unread: Type.Optional(Type.Boolean({ description: "Mark messages as unread" })),
      archive: Type.Optional(Type.Boolean({ description: "Archive messages (remove from inbox)" })),
      star: Type.Optional(Type.Boolean({ description: "Star messages" })),
      unstar: Type.Optional(Type.Boolean({ description: "Remove star from messages" })),
      label: Type.Optional(
        Type.String({
          description:
            "Apply this label to messages. Creates the label if it doesn't exist. Supports nested labels (e.g., 'GitHub/CI').",
        }),
      ),
      trash: Type.Optional(Type.Boolean({ description: "Move messages to trash" })),
      important: Type.Optional(Type.Boolean({ description: "Mark as important" })),
      not_important: Type.Optional(Type.Boolean({ description: "Mark as not important" })),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        account_id: string;
        message_ids?: string[];
        query?: string;
        mark_read?: boolean;
        mark_unread?: boolean;
        archive?: boolean;
        star?: boolean;
        unstar?: boolean;
        label?: string;
        trash?: boolean;
        important?: boolean;
        not_important?: boolean;
      },
    ) => {
      const account = accounts.find((a) => a.id === params.account_id);
      if (!account) {
        const result = {
          error: `Account "${params.account_id}" not found. Available: ${accounts.map((a) => a.id).join(", ")}`,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      if (!params.message_ids?.length && !params.query) {
        const result = {
          error: "Either message_ids or query is required to identify which messages to modify",
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      try {
        // Resolve message IDs from query if needed
        let messageIds = params.message_ids ?? [];
        let queryMatched = 0;

        if (params.query && !messageIds.length) {
          const emails = await searchEmails(oauthConfig, params.account_id, params.query, 100);
          messageIds = emails.map((e) => e.id);
          queryMatched = messageIds.length;

          if (messageIds.length === 0) {
            const result = {
              account: params.account_id,
              query: params.query,
              matched: 0,
              message: "No messages matched the query",
            };
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
              details: result,
            };
          }
        }

        // Handle trash separately (not supported by batchModify)
        if (params.trash) {
          for (const id of messageIds) {
            await trashMessage(oauthConfig, params.account_id, id);
          }
          const result = {
            success: true,
            account: params.account_id,
            trashed: messageIds.length,
            query: params.query ?? undefined,
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        }

        // Build label modifications
        const addLabelIds: string[] = [];
        const removeLabelIds: string[] = [];

        if (params.mark_read) removeLabelIds.push("UNREAD");
        if (params.mark_unread) addLabelIds.push("UNREAD");
        if (params.archive) removeLabelIds.push("INBOX");
        if (params.star) addLabelIds.push("STARRED");
        if (params.unstar) removeLabelIds.push("STARRED");
        if (params.important) addLabelIds.push("IMPORTANT");
        if (params.not_important) removeLabelIds.push("IMPORTANT");

        if (params.label) {
          const label = await findOrCreateLabel(oauthConfig, params.account_id, params.label);
          addLabelIds.push(label.id);
        }

        if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
          const result = { error: "No actions specified (mark_read, archive, label, etc.)" };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        }

        // Use batch modify for efficiency
        if (messageIds.length > 1) {
          await batchModifyMessages(
            oauthConfig,
            params.account_id,
            messageIds,
            addLabelIds.length > 0 ? addLabelIds : undefined,
            removeLabelIds.length > 0 ? removeLabelIds : undefined,
          );
        } else {
          await modifyMessage(
            oauthConfig,
            params.account_id,
            messageIds[0],
            addLabelIds.length > 0 ? addLabelIds : undefined,
            removeLabelIds.length > 0 ? removeLabelIds : undefined,
          );
        }

        const actions: string[] = [];
        if (params.mark_read) actions.push("Marked as read");
        if (params.mark_unread) actions.push("Marked as unread");
        if (params.archive) actions.push("Archived");
        if (params.star) actions.push("Starred");
        if (params.unstar) actions.push("Unstarred");
        if (params.label) actions.push(`Applied label "${params.label}"`);
        if (params.important) actions.push("Marked important");
        if (params.not_important) actions.push("Marked not important");

        const result = {
          success: true,
          account: params.account_id,
          messagesModified: messageIds.length,
          query: params.query ?? undefined,
          queryMatched: queryMatched > 0 ? queryMatched : undefined,
          actions,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const result = { error: message, account: params.account_id };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }
    },
  } as AnyAgentTool;
}
