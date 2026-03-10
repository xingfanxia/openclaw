import type { DetectionResult } from "./secret-detector.js";

export type SecurityMode = "strict" | "normal" | "permissive";

export interface RedactResult {
  action: "blocked" | "redacted" | "warned";
  content: string;
  detections: DetectionResult[];
}

export class Redactor {
  private mode: SecurityMode;

  constructor(mode: SecurityMode = "strict") {
    this.mode = mode;
  }

  getMode(): SecurityMode {
    return this.mode;
  }

  setMode(mode: SecurityMode): void {
    this.mode = mode;
  }

  process(content: string, detections: DetectionResult[]): RedactResult {
    if (detections.length === 0) {
      return { action: "warned", content, detections };
    }

    switch (this.mode) {
      case "strict":
        return {
          action: "blocked",
          content,
          detections,
        };

      case "normal":
        return {
          action: "redacted",
          content: this.redactContent(content, detections),
          detections,
        };

      case "permissive":
        return {
          action: "warned",
          content,
          detections,
        };
    }
  }

  private redactContent(content: string, detections: DetectionResult[]): string {
    const sortedDetections = [...detections].sort((a, b) => b.startIndex - a.startIndex);

    let result = content;
    for (const detection of sortedDetections) {
      const replacement = "[REDACTED:" + detection.patternName + "]";
      result =
        result.slice(0, detection.startIndex) + replacement + result.slice(detection.endIndex);
    }

    return result;
  }
}
