import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import {
  listLabels,
  findOrCreateLabel,
  listFilters,
  deleteFilter,
  deleteLabel,
} from "../gmail-client.js";
import type { OAuthConfig } from "../oauth2.js";

interface AccountConfig {
  id: string;
  email: string;
  type: string;
}

export function createGmailLabelsTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
): AnyAgentTool {
  return {
    name: "gmail_labels",
    description:
      "Manage Gmail labels/folders and filters. Actions: " +
      "'list' (list labels), 'create' (create label), 'delete_label' (delete a label), " +
      "'list_filters' (list filters with human-readable labels), 'delete_filter' (remove a filter rule by ID).",
    parameters: Type.Object({
      account_id: Type.String({
        description: "Account ID to query",
      }),
      action: Type.Union(
        [
          Type.Literal("list"),
          Type.Literal("create"),
          Type.Literal("delete_label"),
          Type.Literal("list_filters"),
          Type.Literal("delete_filter"),
        ],
        {
          description:
            "Action: list labels, create a label, delete a label, list filters, or delete a filter",
        },
      ),
      label_name: Type.Optional(
        Type.String({
          description:
            "Label name for 'create' action. Supports nested labels with '/' (e.g., 'GitHub/CI')",
        }),
      ),
      label_id: Type.Optional(
        Type.String({
          description: "Label ID for 'delete_label' action. Get from 'list' action.",
        }),
      ),
      filter_id: Type.Optional(
        Type.String({
          description: "Filter ID for 'delete_filter' action. Get from 'list_filters' action.",
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        account_id: string;
        action: "list" | "create" | "delete_label" | "list_filters" | "delete_filter";
        label_name?: string;
        label_id?: string;
        filter_id?: string;
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
        if (params.action === "list") {
          const labels = await listLabels(oauthConfig, params.account_id);
          const userLabels = labels
            .filter((l) => l.type === "user")
            .sort((a, b) => a.name.localeCompare(b.name));
          const systemLabels = labels
            .filter((l) => l.type === "system")
            .sort((a, b) => a.name.localeCompare(b.name));

          const result = {
            account: params.account_id,
            userLabels: userLabels.map((l) => ({ id: l.id, name: l.name })),
            systemLabels: systemLabels.map((l) => ({ id: l.id, name: l.name })),
            totalUser: userLabels.length,
            totalSystem: systemLabels.length,
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        }

        if (params.action === "create") {
          if (!params.label_name) {
            const result = { error: "label_name is required for 'create' action" };
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
              details: result,
            };
          }

          const label = await findOrCreateLabel(oauthConfig, params.account_id, params.label_name);
          const result = {
            success: true,
            account: params.account_id,
            label: { id: label.id, name: label.name },
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        }

        if (params.action === "delete_label") {
          if (!params.label_id) {
            const result = {
              error:
                "label_id is required for 'delete_label' action. Use 'list' action to find label IDs.",
            };
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
              details: result,
            };
          }

          await deleteLabel(oauthConfig, params.account_id, params.label_id);
          const result = {
            success: true,
            account: params.account_id,
            deletedLabelId: params.label_id,
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        }

        if (params.action === "list_filters") {
          const filters = await listFilters(oauthConfig, params.account_id);
          const labels = await listLabels(oauthConfig, params.account_id);
          const labelMap = new Map(labels.map((l) => [l.id, l.name]));

          const enriched = filters.map((f) => ({
            id: f.id,
            criteria: f.criteria,
            actions: {
              addLabels: f.action.addLabelIds?.map((id) => labelMap.get(id) ?? id),
              removeLabels: f.action.removeLabelIds?.map((id) => labelMap.get(id) ?? id),
              forward: f.action.forward,
            },
          }));

          const result = {
            account: params.account_id,
            filters: enriched,
            total: enriched.length,
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        }

        if (params.action === "delete_filter") {
          if (!params.filter_id) {
            const result = {
              error:
                "filter_id is required for 'delete_filter' action. Use 'list_filters' to find filter IDs.",
            };
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
              details: result,
            };
          }

          await deleteFilter(oauthConfig, params.account_id, params.filter_id);
          const result = {
            success: true,
            account: params.account_id,
            deletedFilterId: params.filter_id,
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        }

        const result = { error: `Unknown action: ${params.action}` };
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
