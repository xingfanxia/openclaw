import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import { sendEmail } from "../gmail-client.js";
import type { OAuthConfig } from "../oauth2.js";

interface AccountConfig {
  id: string;
  email: string;
  type: string;
}

export function createGmailSendTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
): AnyAgentTool {
  return {
    name: "gmail_send",
    description:
      "Send an email from a specific Gmail account. Supports to, cc, bcc, and replying to existing messages.",
    parameters: Type.Object({
      account_id: Type.String({
        description: "Account ID to send from",
      }),
      to: Type.String({
        description: "Recipient email address",
      }),
      subject: Type.String({
        description: "Email subject line",
      }),
      body: Type.String({
        description: "Email body (plain text)",
      }),
      cc: Type.Optional(
        Type.String({
          description: "CC recipients (comma-separated)",
        }),
      ),
      bcc: Type.Optional(
        Type.String({
          description: "BCC recipients (comma-separated)",
        }),
      ),
      reply_to_message_id: Type.Optional(
        Type.String({
          description: "Message ID to reply to (for threading)",
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        account_id: string;
        to: string;
        subject: string;
        body: string;
        cc?: string;
        bcc?: string;
        reply_to_message_id?: string;
      },
    ) => {
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
        const sendResult = await sendEmail(oauthConfig, params.account_id, {
          to: params.to,
          subject: params.subject,
          body: params.body,
          cc: params.cc,
          bcc: params.bcc,
          replyToMessageId: params.reply_to_message_id,
        });

        const result = {
          messageId: sendResult.messageId,
          threadId: sendResult.threadId,
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
