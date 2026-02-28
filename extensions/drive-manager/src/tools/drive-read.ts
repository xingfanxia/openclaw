import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { readFileContent } from "../drive-client.js";
import type { OAuthConfig, AccountConfig, DriveConfig } from "../types.js";
import { resolveAccountId } from "../types.js";

export function createDriveReadTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  driveConfig: DriveConfig,
): AnyAgentTool {
  return {
    name: "drive_read",
    description:
      "Read the content of a Google Drive file. Google Docs are exported as plain text, Sheets as CSV, and other text-based files are read directly.",
    parameters: Type.Object({
      file_id: Type.String({
        description: "The ID of the file to read.",
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
        const { content, mimeType, name } = await readFileContent(
          oauthConfig,
          accountId,
          params.file_id,
        );

        const truncated = content.length > 50000;
        const result = {
          fileId: params.file_id,
          name,
          mimeType,
          contentLength: content.length,
          truncated,
          content: truncated
            ? content.slice(0, 50000) + "\n\n... [content truncated at 50000 chars]"
            : content,
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
