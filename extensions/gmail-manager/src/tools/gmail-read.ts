import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import { readEmail } from "../gmail-client.js";
import type { OAuthConfig } from "../oauth2.js";

interface AccountConfig {
  id: string;
  email: string;
  type: string;
}

export function createGmailReadTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
): AnyAgentTool {
  return {
    name: "gmail_read",
    description:
      "Read the full content of a specific email by message ID. Returns the complete body text, " +
      "headers, and attachment info. Use gmail_search or gmail_check first to get message IDs.",
    parameters: Type.Object({
      account_id: Type.String({
        description: "Account ID the email belongs to",
      }),
      message_id: Type.String({
        description: "Gmail message ID (from gmail_search or gmail_check results)",
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
        const email = await readEmail(oauthConfig, params.account_id, params.message_id);
        const result = {
          id: email.id,
          threadId: email.threadId,
          from: email.from,
          to: email.to,
          cc: email.cc || undefined,
          subject: email.subject,
          date: email.date,
          labels: email.labels,
          body: email.body || "(no plain text body)",
          attachments: email.attachments.length > 0 ? email.attachments : undefined,
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
