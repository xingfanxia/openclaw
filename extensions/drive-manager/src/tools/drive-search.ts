import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { searchFiles } from "../drive-client.js";
import type { OAuthConfig, AccountConfig, DriveConfig } from "../types.js";
import { resolveAccountId } from "../types.js";

export function createDriveSearchTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  driveConfig: DriveConfig,
): AnyAgentTool {
  return {
    name: "drive_search",
    description:
      "Search Google Drive files by name, content, or type. Supports filtering by file type (doc, sheet, slide, folder, pdf, image).",
    parameters: Type.Object({
      query: Type.String({
        description: "Search query (searches file names and content)",
      }),
      account_id: Type.Optional(
        Type.String({
          description: "Account ID or alias. If omitted, searches default account.",
        }),
      ),
      type_filter: Type.Optional(
        Type.String({
          description: "Filter by type: doc, sheet, slide, folder, pdf, image",
        }),
      ),
      max_results: Type.Optional(
        Type.Number({
          description: "Maximum results (default: 20)",
          default: 20,
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        query: string;
        account_id?: string;
        type_filter?: string;
        max_results?: number;
      },
    ) => {
      const accountId = resolveAccountId(params.account_id, driveConfig);
      const maxResults = params.max_results ?? 20;

      const targetAccounts = accountId ? accounts.filter((a) => a.id === accountId) : accounts;

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
      let totalFound = 0;

      for (const account of targetAccounts) {
        try {
          const files = await searchFiles(
            oauthConfig,
            account.id,
            params.query,
            params.type_filter,
            maxResults,
          );
          totalFound += files.length;
          allResults[account.id] = {
            email: account.email,
            resultCount: files.length,
            files: files.map((f) => ({
              id: f.id,
              name: f.name,
              mimeType: f.mimeType,
              modifiedTime: f.modifiedTime,
              webViewLink: f.webViewLink,
              size: f.size,
            })),
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          allResults[account.id] = { email: account.email, error: message };
        }
      }

      const result = {
        query: params.query,
        typeFilter: params.type_filter ?? "all",
        totalFound,
        accounts: allResults,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  } as AnyAgentTool;
}
