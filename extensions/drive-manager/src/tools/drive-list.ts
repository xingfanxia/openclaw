import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { listFiles } from "../drive-client.js";
import type { OAuthConfig, AccountConfig, DriveConfig } from "../types.js";
import { resolveAccountId } from "../types.js";

export function createDriveListTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  driveConfig: DriveConfig,
): AnyAgentTool {
  return {
    name: "drive_list",
    description:
      "List files in Google Drive, optionally within a specific folder. Returns file names, types, and modification dates.",
    parameters: Type.Object({
      folder_id: Type.Optional(
        Type.String({
          description: "Folder ID to list contents of. If omitted, lists root-level files.",
        }),
      ),
      account_id: Type.Optional(
        Type.String({
          description: "Account ID or alias. If omitted, uses default account.",
        }),
      ),
      max_results: Type.Optional(
        Type.Number({
          description: "Maximum results (default: 50)",
          default: 50,
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        folder_id?: string;
        account_id?: string;
        max_results?: number;
      },
    ) => {
      const accountId = resolveAccountId(params.account_id, driveConfig);
      if (!accountId) {
        const result = {
          error: "No account specified and no default account configured.",
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      const account = accounts.find((a) => a.id === accountId);
      if (!account) {
        const result = {
          error: `Account "${accountId}" not found. Available: ${accounts.map((a) => a.id).join(", ")}`,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      try {
        const files = await listFiles(
          oauthConfig,
          accountId,
          params.folder_id,
          params.max_results ?? 50,
        );

        const result = {
          account: accountId,
          folderId: params.folder_id ?? "root",
          fileCount: files.length,
          files: files.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            modifiedTime: f.modifiedTime,
            size: f.size,
            webViewLink: f.webViewLink,
          })),
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const result = { error: message };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }
    },
  } as AnyAgentTool;
}
