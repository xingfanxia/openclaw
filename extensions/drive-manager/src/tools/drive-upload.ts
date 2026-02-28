import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { uploadFile } from "../drive-client.js";
import type { OAuthConfig, AccountConfig, DriveConfig } from "../types.js";
import { resolveAccountId } from "../types.js";

export function createDriveUploadTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  driveConfig: DriveConfig,
): AnyAgentTool {
  return {
    name: "drive_upload",
    description:
      "Upload text content as a new file to Google Drive. Specify the MIME type for proper handling.",
    parameters: Type.Object({
      name: Type.String({
        description: "Filename for the uploaded content.",
      }),
      content: Type.String({
        description: "The text content to upload.",
      }),
      mime_type: Type.Optional(
        Type.String({
          description:
            "MIME type of the content (default: text/plain). Examples: text/html, application/json, text/csv",
        }),
      ),
      folder_id: Type.Optional(
        Type.String({
          description: "Parent folder ID. If omitted, uploads to root.",
        }),
      ),
      account_id: Type.Optional(
        Type.String({
          description: "Account ID or alias. If omitted, uses default account.",
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        name: string;
        content: string;
        mime_type?: string;
        folder_id?: string;
        account_id?: string;
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
        const file = await uploadFile(
          oauthConfig,
          accountId,
          params.name,
          params.content,
          params.mime_type,
          params.folder_id,
        );

        const result = {
          uploaded: true,
          file: {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            size: file.size,
            webViewLink: file.webViewLink,
            webContentLink: file.webContentLink,
          },
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
