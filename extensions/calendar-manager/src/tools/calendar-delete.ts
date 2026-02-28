import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import { deleteEvent } from "../calendar-client.js";
import type { OAuthConfig, AccountConfig } from "../types.js";
import {
  accountNotFoundResult,
  errorResult,
  successResult,
  validateAccount,
  resolveAccountId,
} from "../types.js";

export function createCalendarDeleteTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  defaultAccount: string,
  aliases: Record<string, string>,
): AnyAgentTool {
  return {
    name: "calendar_delete",
    description: `Delete a calendar event. Default account: ${defaultAccount}.`,
    parameters: Type.Object({
      event_id: Type.String({
        description: "Event ID to delete",
      }),
      account_id: Type.Optional(
        Type.String({ description: `Account ID or alias (default: ${defaultAccount})` }),
      ),
      calendar_id: Type.Optional(Type.String({ description: "Calendar ID (default: primary)" })),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        event_id: string;
        account_id?: string;
        calendar_id?: string;
      },
    ) => {
      const accountId = resolveAccountId(params.account_id, defaultAccount, aliases);
      if (!validateAccount(accounts, accountId)) {
        return accountNotFoundResult(accountId, accounts);
      }

      try {
        await deleteEvent(oauthConfig, accountId, params.event_id, params.calendar_id);
        return successResult({
          success: true,
          account: accountId,
          deleted: params.event_id,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(message, { account: accountId });
      }
    },
  } as AnyAgentTool;
}
