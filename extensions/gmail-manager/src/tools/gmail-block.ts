import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import { blockSender } from "../gmail-client.js";
import type { OAuthConfig } from "../oauth2.js";

interface AccountConfig {
  id: string;
  email: string;
  type: string;
}

export function createGmailBlockTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
): AnyAgentTool {
  return {
    name: "gmail_block",
    description:
      "Block a sender by creating a Gmail filter that moves their emails to trash. The filter is applied to future messages.",
    parameters: Type.Object({
      account_id: Type.String({
        description: "Account ID to create the block filter on",
      }),
      sender_email: Type.String({
        description: "Email address of the sender to block",
      }),
    }),
    execute: async (_toolCallId: string, params: { account_id: string; sender_email: string }) => {
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
        const filterResult = await blockSender(oauthConfig, params.account_id, params.sender_email);
        const result = {
          success: true,
          account: params.account_id,
          blockedSender: params.sender_email,
          filterId: filterResult.filterId,
          action: "Future emails from this sender will be sent to trash",
        };
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
