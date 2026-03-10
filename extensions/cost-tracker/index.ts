import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { handleCostCommand } from "./src/cost-command.js";

export default function register(api: OpenClawPluginApi): void {
  api.registerCommand({
    name: "cost",
    acceptsArgs: true,
    description:
      "Show token usage and cost breakdown. Usage: /cost [today|week|month|ytd|messages [N]]",
    handler: async (ctx) => {
      const args = (ctx.args ?? "").trim();
      const text = await handleCostCommand(args);
      return { text };
    },
  });

  console.log("[cost-tracker] Registered /cost command");
}
