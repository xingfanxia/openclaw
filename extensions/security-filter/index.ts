import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { SecretDetector } from "./src/secret-detector.js";
import { Redactor } from "./src/redactor.js";
import type { SecurityMode } from "./src/redactor.js";
import { AuditLog } from "./src/audit-log.js";
import { createMessageFilter } from "./src/hooks/message-filter.js";
import { createToolFilter } from "./src/hooks/tool-filter.js";
import { createSecurityStatusCommand } from "./src/commands/security-status.js";
import { createSecurityModeCommand } from "./src/commands/security-mode.js";

export default function register(api: OpenClawPluginApi): void {
  const config = api.getConfig?.() ?? {};

  const mode: SecurityMode =
    (config.mode as SecurityMode) ?? "strict";
  const logPath: string =
    (config.logPath as string) ?? "./security-audit.jsonl";
  const allowlist: string[] =
    (config.allowlist as string[]) ?? [];
  const customPatterns: Array<{ name: string; regex: string; flags?: string }> =
    (config.customPatterns as Array<{ name: string; regex: string; flags?: string }>) ?? [];

  const detector = new SecretDetector(allowlist, customPatterns);
  const redactor = new Redactor(mode);
  const auditLog = new AuditLog(logPath);

  const messageFilter = createMessageFilter(detector, redactor, auditLog);
  api.on("message_sending", messageFilter, { priority: 1000 });

  const toolFilter = createToolFilter(detector, redactor, auditLog);
  api.on("before_tool_call", toolFilter, { priority: 1000 });

  api.registerCommand({
    name: "security-status",
    description: "Show current security filter status, mode, and active patterns",
    handler: createSecurityStatusCommand(detector, redactor, auditLog),
  });

  api.registerCommand({
    name: "security-mode",
    description: "Change security mode: /security-mode <strict|normal|permissive>",
    handler: createSecurityModeCommand(redactor, auditLog),
  });

  console.log(
    "[security-filter] Registered - mode:",
    mode,
    "| patterns:",
    detector.getPatternNames().length,
    "| log:",
    logPath,
  );
}
