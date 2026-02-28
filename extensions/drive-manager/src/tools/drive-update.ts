import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { updateFile } from "../drive-client.js";
import type { OAuthConfig, AccountConfig, DriveConfig } from "../types.js";
import { resolveAccountId } from "../types.js";

export function createDriveUpdateTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  driveConfig: DriveConfig,
): AnyAgentTool {
  return {
    name: "drive_update",
    description:
      "Update an existing Google Drive file's content or metadata (name). For Google Docs, provide plain text; for Sheets, provide CSV.",
    parameters: Type.Object({
      file_id: Type.String({
        description: "The ID of the file to update.",
      }),
      content: Type.Optional(
        Type.String({
          description: "New content for the file.",
        }),
      ),
      name: Type.Optional(
        Type.String({
          description: "New name for the file.",
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
        file_id: string;
        content?: string;
        name?: string;
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

      if (!params.content && !params.name) {
        const result = {
          error: "At least one of 'content' or 'name' must be provided.",
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      try {
        const file = await updateFile(
          oauthConfig,
          accountId,
          params.file_id,
          params.content,
          params.name,
        );

        const result = {
          updated: true,
          file: {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            modifiedTime: file.modifiedTime,
            webViewLink: file.webViewLink,
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
