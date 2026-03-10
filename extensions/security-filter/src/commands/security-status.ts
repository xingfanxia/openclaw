import type { AuditLog } from "../audit-log.js";
import type { Redactor } from "../redactor.js";
import type { SecretDetector } from "../secret-detector.js";

interface CommandContext {
  senderId: string;
  channel: string;
  args: string[];
  commandBody: string;
}

interface CommandResult {
  text: string;
}

export function createSecurityStatusCommand(
  detector: SecretDetector,
  redactor: Redactor,
  auditLog: AuditLog,
): (ctx: CommandContext) => Promise<CommandResult> {
  return async (_ctx: CommandContext): Promise<CommandResult> => {
    const mode = redactor.getMode();
    const patterns = detector.getPatternNames();
    const logPath = auditLog.getLogPath();

    const modeDescriptions: Record<string, string> = {
      strict: "Block entire message if secrets detected",
      normal: "Redact secrets and send modified message",
      permissive: "Log warning only, send unmodified",
    };

    const lines: string[] = [
      "Security Filter Status",
      "=====================",
      "",
      "Mode: " + mode + " - " + (modeDescriptions[mode] ?? "Unknown"),
      "Audit Log: " + logPath,
      "",
      "Active Patterns (" + patterns.length + "):",
    ];

    for (const pattern of patterns) {
      lines.push("  - " + pattern);
    }

    return { text: lines.join("\n") };
  };
}
