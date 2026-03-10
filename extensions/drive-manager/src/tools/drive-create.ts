import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { createFile } from "../drive-client.js";
import type { OAuthConfig, AccountConfig, DriveConfig } from "../types.js";
import { resolveAccountId } from "../types.js";

export function createDriveCreateTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  driveConfig: DriveConfig,
): AnyAgentTool {
  return {
    name: "drive_create",
    description:
      "Create a new Google Drive file (Doc, Sheet, Slide, or folder). Optionally provide initial content for Docs (plain text) or Sheets (CSV).",
    parameters: Type.Object({
      name: Type.String({
        description: "Name for the new file or folder.",
      }),
      type: Type.String({
        description: "Type of file to create: doc, sheet, slide, folder",
      }),
      content: Type.Optional(
        Type.String({
          description: "Initial content (plain text for docs, CSV for sheets). Optional.",
        }),
      ),
      folder_id: Type.Optional(
        Type.String({
          description: "Parent folder ID. If omitted, creates in root.",
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
        type: string;
        content?: string;
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
        const file = await createFile(
          oauthConfig,
          accountId,
          params.name,
          params.type,
          params.content,
          params.folder_id,
        );

        const result = {
          created: true,
          file: {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
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
