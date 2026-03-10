import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import { quickAddEvent } from "../calendar-client.js";
import type { OAuthConfig, AccountConfig } from "../types.js";
import {
  accountNotFoundResult,
  errorResult,
  successResult,
  validateAccount,
  resolveAccountId,
} from "../types.js";

export function createCalendarQuickAddTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  defaultAccount: string,
  aliases: Record<string, string>,
): AnyAgentTool {
  return {
    name: "calendar_quick_add",
    description: `Create an event using natural language. Google parses the text for date, time, and title. Default account: ${defaultAccount}. Examples: 'Lunch tomorrow at noon', 'Dentist next Tuesday at 2pm'.`,
    parameters: Type.Object({
      text: Type.String({
        description: "Natural language event description",
      }),
      account_id: Type.Optional(
        Type.String({ description: `Account ID or alias (default: ${defaultAccount})` }),
      ),
      calendar_id: Type.Optional(Type.String({ description: "Calendar ID (default: primary)" })),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        text: string;
        account_id?: string;
        calendar_id?: string;
      },
    ) => {
      const accountId = resolveAccountId(params.account_id, defaultAccount, aliases);
      if (!validateAccount(accounts, accountId)) {
        return accountNotFoundResult(accountId, accounts);
      }

      try {
        const event = await quickAddEvent(oauthConfig, accountId, params.text, params.calendar_id);
        return successResult({
          success: true,
          account: accountId,
          parsedText: params.text,
          event: {
            id: event.id,
            summary: event.summary,
            start: event.start,
            end: event.end,
            allDay: event.allDay,
            htmlLink: event.htmlLink,
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(message, { account: accountId });
      }
    },
  } as AnyAgentTool;
}
