import type { AuditLog } from "../audit-log.js";
import type { Redactor } from "../redactor.js";
import type { SecretDetector } from "../secret-detector.js";

interface MessageSendingEvent {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
}

interface MessageSendingContext {
  channelId: string;
}

interface MessageFilterResult {
  content?: string;
  cancel?: boolean;
}

export function createMessageFilter(
  detector: SecretDetector,
  redactor: Redactor,
  auditLog: AuditLog,
): (event: MessageSendingEvent, ctx: MessageSendingContext) => MessageFilterResult | void {
  return (event: MessageSendingEvent, ctx: MessageSendingContext): MessageFilterResult | void => {
    const detections = detector.detect(event.content);

    if (detections.length === 0) {
      return;
    }

    const result = redactor.process(event.content, detections);
    const patternNames = [...new Set(detections.map((d) => d.patternName))];

    auditLog.log(result.action, redactor.getMode(), patternNames, ctx.channelId, event.content);

    switch (result.action) {
      case "blocked":
        console.warn(
          "[security-filter] Blocked message to",
          event.to,
          "- detected:",
          patternNames.join(", "),
        );
        return { cancel: true };

      case "redacted":
        console.warn(
          "[security-filter] Redacted secrets in message to",
          event.to,
          "- detected:",
          patternNames.join(", "),
        );
        return { content: result.content };

      case "warned":
        console.warn(
          "[security-filter] Warning: secrets detected in message to",
          event.to,
          "- patterns:",
          patternNames.join(", "),
        );
        return;
    }
  };
}
