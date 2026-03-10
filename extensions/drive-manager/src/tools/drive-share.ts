import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { shareFile } from "../drive-client.js";
import type { OAuthConfig, AccountConfig, DriveConfig } from "../types.js";
import { resolveAccountId } from "../types.js";

export function createDriveShareTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  driveConfig: DriveConfig,
): AnyAgentTool {
  return {
    name: "drive_share",
    description:
      "Share a Google Drive file with a user by email. Roles: reader, commenter, writer, owner.",
    parameters: Type.Object({
      file_id: Type.String({
        description: "The ID of the file to share.",
      }),
      email: Type.String({
        description: "Email address of the person to share with.",
      }),
      role: Type.String({
        description: "Permission role: reader, commenter, writer, or owner.",
      }),
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
        email: string;
        role: string;
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

      const validRoles = ["reader", "commenter", "writer", "owner"];
      if (!validRoles.includes(params.role)) {
        const result = {
          error: `Invalid role "${params.role}". Must be one of: ${validRoles.join(", ")}`,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      try {
        const permission = await shareFile(
          oauthConfig,
          accountId,
          params.file_id,
          params.email,
          params.role,
        );

        const result = {
          shared: true,
          permission: {
            id: permission.id,
            type: permission.type,
            role: permission.role,
            emailAddress: permission.emailAddress,
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
