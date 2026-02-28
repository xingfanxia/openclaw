import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import { unsubscribe } from "../gmail-client.js";
import type { OAuthConfig } from "../oauth2.js";

interface AccountConfig {
  id: string;
  email: string;
  type: string;
}

export function createGmailUnsubscribeTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
): AnyAgentTool {
  return {
    name: "gmail_unsubscribe",
    description:
      "Unsubscribe from a sender using the List-Unsubscribe header. Supports mailto and URL-based unsubscribe methods.",
    parameters: Type.Object({
      account_id: Type.String({
        description: "Account ID that received the email",
      }),
      message_id: Type.String({
        description: "Gmail message ID to unsubscribe from",
      }),
    }),
    execute: async (_toolCallId: string, params: { account_id: string; message_id: string }) => {
      const account = accounts.find((a) => a.id === params.account_id);
      if (!account) {
        const result = {
          error: `Account "${params.account_id}" not found. Available: ${accounts.map((a) => a.id).join(", ")}`,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      try {
        const result = await unsubscribe(oauthConfig, params.account_id, params.message_id);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const result = { error: message, account: params.account_id };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }
    },
  } as AnyAgentTool;
}
