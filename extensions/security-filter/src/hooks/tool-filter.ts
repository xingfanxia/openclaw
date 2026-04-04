import type { AuditLog } from "../audit-log.js";
import type { Redactor } from "../redactor.js";
import type { SecretDetector } from "../secret-detector.js";

interface BeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
}

interface ToolCallContext {
  agentId?: string;
}

interface ToolFilterResult {
  block?: boolean;
  blockReason?: string;
}

const MONITORED_TOOLS = new Set(["claude_code", "codex"]);

export function createToolFilter(
  detector: SecretDetector,
  redactor: Redactor,
  auditLog: AuditLog,
): (event: BeforeToolCallEvent, ctx: ToolCallContext) => ToolFilterResult | void {
  return (event: BeforeToolCallEvent, ctx: ToolCallContext): ToolFilterResult | void => {
    if (!MONITORED_TOOLS.has(event.toolName)) {
      return;
    }

    const paramsText = JSON.stringify(event.params);
    const detections = detector.detect(paramsText);

    if (detections.length === 0) {
      return;
    }

    const patternNames = [...new Set(detections.map((d) => d.patternName))];
    const result = redactor.process(paramsText, detections);

    const channel = ctx.agentId ?? "tool:" + event.toolName;
    auditLog.log(result.action, redactor.getMode(), patternNames, channel, paramsText);

    switch (result.action) {
      case "blocked":
        console.warn(
          "[security-filter] Blocked tool call",
          event.toolName,
          "- detected:",
          patternNames.join(", "),
        );
        return {
          block: true,
          blockReason:
            "Security filter: secrets detected (" +
            patternNames.join(", ") +
            "). Mode: strict - call blocked.",
        };

      case "redacted":
        console.warn(
          "[security-filter] Warning: secrets in tool call",
          event.toolName,
          "- detected:",
          patternNames.join(", "),
          "(redaction not supported for tool params, blocking instead)",
        );
        return {
          block: true,
          blockReason:
            "Security filter: secrets detected (" +
            patternNames.join(", ") +
            "). Mode: normal - tool call blocked (redaction not supported for tool params).",
        };

      case "warned":
        console.warn(
          "[security-filter] Warning: secrets detected in tool call",
          event.toolName,
          "- patterns:",
          patternNames.join(", "),
        );
        return;
    }
  };
}
