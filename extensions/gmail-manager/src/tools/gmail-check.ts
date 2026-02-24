import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import type { OAuthConfig } from "../oauth2.js";
import { classifyEmails, generateDigest, formatDigestAsText } from "../email-classifier.js";
import { listUnread } from "../gmail-client.js";

interface AccountConfig {
  id: string;
  email: string;
  type: string;
}

export function createGmailCheckTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
): AnyAgentTool {
  return {
    name: "gmail_check",
    description:
      "Check unread emails across all Gmail accounts or a specific account. Returns classified emails with a digest summary.",
    parameters: Type.Object({
      account_id: Type.Optional(
        Type.String({
          description: "Specific account ID to check. If omitted, checks all accounts.",
        }),
      ),
      max_results: Type.Optional(
        Type.Number({
          description: "Maximum emails to fetch per account (default: 20)",
          default: 20,
        }),
      ),
    }),
    execute: async (_toolCallId: string, params: { account_id?: string; max_results?: number }) => {
      const maxResults = params.max_results ?? 20;
      const targetAccounts = params.account_id
        ? accounts.filter((a) => a.id === params.account_id)
        : accounts;

      if (targetAccounts.length === 0) {
        const result = {
          error: `Account "${params.account_id}" not found. Available: ${accounts.map((a) => a.id).join(", ")}`,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      const allResults: Record<string, unknown> = {};
      const allClassified: ReturnType<typeof classifyEmails> = [];

      for (const account of targetAccounts) {
        try {
          const emails = await listUnread(oauthConfig, account.id, maxResults);
          const classified = classifyEmails(emails);
          allClassified.push(...classified);
          allResults[account.id] = {
            email: account.email,
            unreadCount: emails.length,
            classified: classified.map((e) => ({
              subject: e.subject,
              from: e.from,
              category: e.category,
              confidence: e.confidence,
              date: e.date,
            })),
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          allResults[account.id] = {
            email: account.email,
            error: message,
          };
        }
      }

      const digest = generateDigest(allClassified);
      const result = {
        accounts: allResults,
        digest: formatDigestAsText(digest),
        summary: {
          totalUnread: allClassified.length,
          byCategory: Object.fromEntries(
            [
              "important",
              "actionable",
              "newsletter",
              "marketing",
              "spam",
              "social",
              "transactional",
            ].map((cat) => [cat, allClassified.filter((e) => e.category === cat).length]),
          ),
        },
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  } as AnyAgentTool;
}
