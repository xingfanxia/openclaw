import type { PluginCommandContext } from "openclaw/plugin-sdk/core";
import type { AuditLog } from "../audit-log.js";
import type { Redactor, SecurityMode } from "../redactor.js";

const VALID_MODES: ReadonlyArray<SecurityMode> = ["strict", "normal", "permissive"];

export function createSecurityModeCommand(
  redactor: Redactor,
  auditLog: AuditLog,
): (ctx: PluginCommandContext) => Promise<{ text: string }> {
  return async (ctx: PluginCommandContext): Promise<{ text: string }> => {
    const requestedMode = (ctx.args ?? "").trim().split(/\s+/)[0];

    if (!requestedMode) {
      const currentMode = redactor.getMode();
      return {
        text:
          "Current security mode: " +
          currentMode +
          "\n\nUsage: /security_mode <strict|normal|permissive>\n\n" +
          "Modes:\n" +
          "  strict     - Block entire message if secrets detected (default)\n" +
          "  normal     - Redact secrets with [REDACTED:Pattern Name]\n" +
          "  permissive - Log warning only, send unmodified",
      };
    }

    if (!VALID_MODES.includes(requestedMode as SecurityMode)) {
      return {
        text: "Invalid mode: " + requestedMode + ". Valid modes: " + VALID_MODES.join(", "),
      };
    }

    const previousMode = redactor.getMode();
    const newMode = requestedMode as SecurityMode;
    redactor.setMode(newMode);

    auditLog.log(
      "warned",
      newMode,
      [],
      ctx.channel,
      "Mode changed from " + previousMode + " to " + newMode + " by " + ctx.senderId,
    );

    return {
      text: "Security mode changed: " + previousMode + " -> " + newMode,
    };
  };
}
