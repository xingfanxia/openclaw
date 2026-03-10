import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import { findOrCreateLabel, createFilter, listLabels } from "../gmail-client.js";
import type { OAuthConfig } from "../oauth2.js";

interface AccountConfig {
  id: string;
  email: string;
  type: string;
}

export function createGmailFilterTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
): AnyAgentTool {
  return {
    name: "gmail_filter",
    description:
      "Create a Gmail filter rule that automatically organizes incoming emails. " +
      "Can apply labels (creates label if it doesn't exist, supports nested labels like 'GitHub/CI'), " +
      "skip inbox, mark as read, star, trash, or mark as important. " +
      "At least one criteria field (from, to, subject, query) is required.",
    parameters: Type.Object({
      account_id: Type.String({
        description: "Account ID to create the filter on",
      }),
      from: Type.Optional(Type.String({ description: "Sender email address or pattern to match" })),
      to: Type.Optional(Type.String({ description: "Recipient email address to match" })),
      subject: Type.Optional(Type.String({ description: "Subject line text to match" })),
      query: Type.Optional(
        Type.String({
          description: "Full Gmail search query (e.g., 'has:attachment larger:5M')",
        }),
      ),
      has_attachment: Type.Optional(
        Type.Boolean({ description: "Only match emails with attachments" }),
      ),
      label: Type.Optional(
        Type.String({
          description:
            "Label/folder to apply. Supports nested labels with '/' separator (e.g., 'GitHub/CI'). Created automatically if it doesn't exist.",
        }),
      ),
      skip_inbox: Type.Optional(
        Type.Boolean({
          description: "Archive the email (remove from inbox). Default: false",
        }),
      ),
      mark_read: Type.Optional(
        Type.Boolean({
          description: "Mark the email as read automatically. Default: false",
        }),
      ),
      star: Type.Optional(Type.Boolean({ description: "Star the email. Default: false" })),
      trash: Type.Optional(
        Type.Boolean({
          description: "Send to trash (use gmail_block for blocking senders). Default: false",
        }),
      ),
      important: Type.Optional(
        Type.Boolean({
          description: "Mark as important. Default: false",
        }),
      ),
      never_spam: Type.Optional(
        Type.Boolean({
          description: "Never send to spam. Default: false",
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        account_id: string;
        from?: string;
        to?: string;
        subject?: string;
        query?: string;
        has_attachment?: boolean;
        label?: string;
        skip_inbox?: boolean;
        mark_read?: boolean;
        star?: boolean;
        trash?: boolean;
        important?: boolean;
        never_spam?: boolean;
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

      // Validate at least one criteria
      if (!params.from && !params.to && !params.subject && !params.query) {
        const result = {
          error: "At least one filter criteria is required: from, to, subject, or query",
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      // Validate at least one action
      if (
        !params.label &&
        !params.skip_inbox &&
        !params.mark_read &&
        !params.star &&
        !params.trash &&
        !params.important &&
        !params.never_spam
      ) {
        const result = {
          error:
            "At least one action is required: label, skip_inbox, mark_read, star, trash, important, or never_spam",
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      try {
        const addLabelIds: string[] = [];
        const removeLabelIds: string[] = [];
        let labelCreated = false;
        let labelName: string | undefined;

        // Handle label creation
        if (params.label) {
          const label = await findOrCreateLabel(oauthConfig, params.account_id, params.label);
          addLabelIds.push(label.id);
          labelName = label.name;
          labelCreated = true;
        }

        // Handle actions
        if (params.skip_inbox) {
          removeLabelIds.push("INBOX");
        }
        if (params.mark_read) {
          removeLabelIds.push("UNREAD");
        }
        if (params.star) {
          addLabelIds.push("STARRED");
        }
        if (params.trash) {
          addLabelIds.push("TRASH");
        }
        if (params.important) {
          addLabelIds.push("IMPORTANT");
        }
        if (params.never_spam) {
          removeLabelIds.push("SPAM");
        }

        const criteria = {
          from: params.from,
          to: params.to,
          subject: params.subject,
          query: params.query,
          hasAttachment: params.has_attachment,
        };

        const filterResult = await createFilter(oauthConfig, params.account_id, criteria, {
          addLabelIds: addLabelIds.length > 0 ? addLabelIds : undefined,
          removeLabelIds: removeLabelIds.length > 0 ? removeLabelIds : undefined,
        });

        const actions: string[] = [];
        if (labelName) actions.push(`Apply label "${labelName}"`);
        if (params.skip_inbox) actions.push("Skip inbox (archive)");
        if (params.mark_read) actions.push("Mark as read");
        if (params.star) actions.push("Star");
        if (params.trash) actions.push("Send to trash");
        if (params.important) actions.push("Mark important");
        if (params.never_spam) actions.push("Never send to spam");

        const criteriaDesc: string[] = [];
        if (params.from) criteriaDesc.push(`From: ${params.from}`);
        if (params.to) criteriaDesc.push(`To: ${params.to}`);
        if (params.subject) criteriaDesc.push(`Subject: ${params.subject}`);
        if (params.query) criteriaDesc.push(`Query: ${params.query}`);
        if (params.has_attachment) criteriaDesc.push("Has attachment");

        const result = {
          success: true,
          account: params.account_id,
          filterId: filterResult.filterId,
          criteria: criteriaDesc,
          actions,
          labelCreated: labelCreated ? labelName : undefined,
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
