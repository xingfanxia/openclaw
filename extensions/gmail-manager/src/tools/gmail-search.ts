import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import { classifyEmails } from "../email-classifier.js";
import { searchEmails } from "../gmail-client.js";
import type { OAuthConfig } from "../oauth2.js";

interface AccountConfig {
  id: string;
  email: string;
  type: string;
}

export function createGmailSearchTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
): AnyAgentTool {
  return {
    name: "gmail_search",
    description:
      "Search emails across all Gmail accounts or a specific account using Gmail search syntax (e.g., from:user@example.com, subject:meeting, has:attachment, after:2024/01/01).",
    parameters: Type.Object({
      query: Type.String({
        description:
          "Gmail search query (e.g., from:boss@company.com subject:urgent after:2024/01/01)",
      }),
      account_id: Type.Optional(
        Type.String({
          description: "Specific account ID to search. If omitted, searches all accounts.",
        }),
      ),
      max_results: Type.Optional(
        Type.Number({
          description: "Maximum results per account (default: 20)",
          default: 20,
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        query: string;
        account_id?: string;
        max_results?: number;
      },
    ) => {
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
      for (const account of targetAccounts) {
        try {
          const emails = await searchEmails(oauthConfig, account.id, params.query, maxResults);
          const classified = classifyEmails(emails);
          allResults[account.id] = {
            results: classified.map((e) => ({
              id: e.id,
              subject: e.subject,
              from: e.from,
              date: e.date,
              snippet: e.snippet,
              category: e.category,
              labels: e.labels,
            })),
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          allResults[account.id] = { error: message };
        }
      }

      const result = { accounts: allResults };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  } as AnyAgentTool;
}
