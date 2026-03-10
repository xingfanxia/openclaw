import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { formatUserTime, resolveUserTimeFormat, resolveUserTimezone } from "../date-time.js";
import type { AnyAgentTool } from "./common.js";

const DEFAULT_TIMEZONE = "America/Los_Angeles";

export function createCurrentTimeTool(opts?: { config?: OpenClawConfig }): AnyAgentTool {
  return {
    label: "Current Time",
    name: "current_time",
    description:
      "Get the current date, time, day of week, and timezone. Use whenever you need to know what time it is, calculate relative dates, or answer time-sensitive questions.",
    parameters: Type.Object({}),
    execute: async () => {
      const cfg = opts?.config ?? loadConfig();
      const configuredTz = cfg.agents?.defaults?.userTimezone;
      const userTimezone = resolveUserTimezone(configuredTz || DEFAULT_TIMEZONE);
      const userTimeFormat = resolveUserTimeFormat(cfg.agents?.defaults?.timeFormat);
      const now = new Date();
      const formatted = formatUserTime(now, userTimezone, userTimeFormat);

      return {
        content: [
          {
            type: "text",
            text: formatted
              ? `🕒 ${formatted} (${userTimezone})`
              : `🕒 ${now.toISOString()} (${userTimezone})`,
          },
        ],
        details: {
          ok: true,
          timezone: userTimezone,
          iso: now.toISOString(),
          formatted,
        },
      };
    },
  } as AnyAgentTool;
}
