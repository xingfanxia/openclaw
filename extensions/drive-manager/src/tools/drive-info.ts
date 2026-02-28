import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { getFileInfo } from "../drive-client.js";
import type { OAuthConfig, AccountConfig, DriveConfig } from "../types.js";
import { resolveAccountId } from "../types.js";

export function createDriveInfoTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  driveConfig: DriveConfig,
): AnyAgentTool {
  return {
    name: "drive_info",
    description: "Get detailed metadata, permissions, and revision count for a Google Drive file.",
    parameters: Type.Object({
      file_id: Type.String({
        description: "The ID of the file to get info for.",
      }),
      account_id: Type.Optional(
        Type.String({
          description: "Account ID or alias. If omitted, uses default account.",
        }),
      ),
    }),
    execute: async (_toolCallId: string, params: { file_id: string; account_id?: string }) => {
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
        const info = await getFileInfo(oauthConfig, accountId, params.file_id);

        const result = {
          file: {
            id: info.file.id,
            name: info.file.name,
            mimeType: info.file.mimeType,
            size: info.file.size,
            createdTime: info.file.createdTime,
            modifiedTime: info.file.modifiedTime,
            webViewLink: info.file.webViewLink,
            webContentLink: info.file.webContentLink,
            shared: info.file.shared,
            trashed: info.file.trashed,
            owners: info.file.owners,
          },
          permissions: info.permissions,
          revisionCount: info.revisionCount,
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
