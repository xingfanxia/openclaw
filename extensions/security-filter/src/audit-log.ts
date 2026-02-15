import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SecurityMode } from "./redactor.js";

export interface AuditEntry {
  timestamp: string;
  event: "blocked" | "redacted" | "warned";
  mode: SecurityMode;
  patterns: string[];
  channel: string;
  truncatedContent: string;
}

export class AuditLog {
  private logPath: string;
  private initialized: boolean = false;

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  private ensureDirectory(): void {
    if (!this.initialized) {
      try {
        mkdirSync(dirname(this.logPath), { recursive: true });
      } catch {
        // directory may already exist
      }
      this.initialized = true;
    }
  }

  write(entry: AuditEntry): void {
    this.ensureDirectory();

    const line = JSON.stringify(entry) + "\n";
    try {
      appendFileSync(this.logPath, line, "utf-8");
    } catch (err) {
      console.error("[security-filter] Failed to write audit log:", err);
    }
  }

  log(
    event: "blocked" | "redacted" | "warned",
    mode: SecurityMode,
    patterns: string[],
    channel: string,
    content: string,
  ): void {
    const truncatedContent = this.truncateContent(content, patterns);

    this.write({
      timestamp: new Date().toISOString(),
      event,
      mode,
      patterns,
      channel,
      truncatedContent,
    });
  }

  private truncateContent(content: string, patterns: string[]): string {
    if (content.length <= 50) {
      return content.replace(/[a-zA-Z0-9_-]{8,}/g, (match) => {
        return match.slice(0, 3) + "***";
      });
    }

    const hint = patterns.length > 0 ? patterns[0] : "secret";
    const prefix = content.slice(0, 10).replace(/[a-zA-Z0-9_-]{4,}/g, (m) => m.slice(0, 3) + "***");
    return prefix + "... [" + hint + " detected]";
  }

  getLogPath(): string {
    return this.logPath;
  }
}
