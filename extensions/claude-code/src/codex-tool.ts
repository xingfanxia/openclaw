import { Type } from "@sinclair/typebox";
import * as fs from "fs";
import * as path from "path";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import type { ProjectRegistry } from "./project-registry.js";

type PluginCfg = {
  workspaceDir?: string;
  timeoutMs?: number;
  codex?: {
    model?: string;
    reasoningEffort?: string;
    approvalPolicy?: string;
    sandboxMode?: string;
  };
};

type CodexUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

type CodexItem = {
  id?: string;
  type: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  status?: string;
  changes?: Array<{ path: string; kind: string }>;
  text?: string;
  message?: string;
  query?: string;
  items?: Array<{ text: string; completed: boolean }>;
};

const LOG_DIR = "/tmp/openclaw";
const LOG_FILE = path.join(LOG_DIR, "coding-sessions.jsonl");

function appendSessionLog(entry: Record<string, unknown>): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // Logging should never break the tool
  }
}

function extractItemsSummary(items: CodexItem[]): {
  commands: Array<{ command: string; exitCode?: number; outputPreview: string }>;
  filesChanged: Array<{ path: string; kind: string }>;
  errors: string[];
  agentMessages: string[];
  reasoning: string[];
} {
  const commands: Array<{ command: string; exitCode?: number; outputPreview: string }> = [];
  const filesChanged: Array<{ path: string; kind: string }> = [];
  const errors: string[] = [];
  const agentMessages: string[] = [];
  const reasoning: string[] = [];

  for (const item of items) {
    switch (item.type) {
      case "command_execution":
        commands.push({
          command: item.command ?? "",
          exitCode: item.exit_code,
          outputPreview: (item.aggregated_output ?? "").slice(0, 500),
        });
        break;
      case "file_change":
        if (item.changes) {
          for (const change of item.changes) {
            filesChanged.push({ path: change.path, kind: change.kind });
          }
        }
        break;
      case "error":
        errors.push(item.message ?? item.text ?? "unknown error");
        break;
      case "agent_message":
        agentMessages.push(item.text ?? "");
        break;
      case "reasoning":
        reasoning.push(item.text ?? "");
        break;
    }
  }

  return { commands, filesChanged, errors, agentMessages, reasoning };
}

export function createCodexTool(api: OpenClawPluginApi, registry?: ProjectRegistry): AnyAgentTool {
  return {
    name: "codex",
    description: [
      "Run an OpenAI Codex session to perform coding tasks: read/write files, run builds,",
      "execute commands, refactor code, fix bugs, and more.",
      "Returns a detailed summary including files changed, commands run, and status.",
    ].join(" "),
    parameters: Type.Object({
      task: Type.String({
        description: "Clear description of the coding task to perform.",
      }),
      workingDirectory: Type.Optional(
        Type.String({
          description: "Working directory for the session. Defaults to plugin config.",
        }),
      ),
      model: Type.Optional(
        Type.String({
          description: "Model override (e.g. gpt-5.2-codex, codex-mini).",
        }),
      ),
      reasoningEffort: Type.Optional(
        Type.String({
          description:
            "Reasoning effort: minimal, low, medium, high, or xhigh. Defaults to config value.",
        }),
      ),
      sandboxMode: Type.Optional(
        Type.String({
          description: "Sandbox mode: read-only, workspace-write, or danger-full-access.",
        }),
      ),
      project: Type.Optional(
        Type.String({
          description:
            "Project ID or name (e.g., 'kyc-backend', 'KYC'). Auto-resolves to working directory.",
        }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const task = typeof params.task === "string" ? params.task.trim() : "";
      if (!task) {
        throw new Error("task is required");
      }

      const cfg = (api.pluginConfig ?? {}) as PluginCfg;
      const codexCfg = cfg.codex ?? {};

      const cwd =
        (typeof params.workingDirectory === "string" && params.workingDirectory.trim()) ||
        cfg.workspaceDir ||
        process.cwd();

      // Project resolution
      let effectiveCwd = cwd;
      if (typeof params.project === "string" && params.project.trim() && registry) {
        const entry = registry.resolve(params.project.trim());
        if (entry) {
          effectiveCwd = entry.path;
        }
      }

      const timeoutMs = cfg.timeoutMs ?? 300_000; // 5 minutes

      const model =
        (typeof params.model === "string" && params.model.trim()) || codexCfg.model || undefined;

      const sandboxMode =
        (typeof params.sandboxMode === "string" && params.sandboxMode.trim()) ||
        codexCfg.sandboxMode ||
        "danger-full-access";

      const reasoningEffort =
        (typeof params.reasoningEffort === "string" && params.reasoningEffort.trim()) ||
        codexCfg.reasoningEffort ||
        undefined;

      const approvalPolicy = codexCfg.approvalPolicy ?? "never";

      // Dynamic import — the SDK may not be installed in all environments
      let CodexClass: typeof import("@openai/codex-sdk").Codex;
      try {
        const sdk = await import("@openai/codex-sdk");
        CodexClass = sdk.Codex;
      } catch {
        throw new Error("Codex SDK not available. Install with: npm install @openai/codex-sdk");
      }

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), timeoutMs);
      const startTime = Date.now();

      try {
        const codex = new CodexClass({
          ...(model ? { config: { model } } : {}),
        });

        const thread = codex.startThread({
          workingDirectory: effectiveCwd,
          skipGitRepoCheck: true,
          approvalPolicy: approvalPolicy as "never" | "on-request" | "on-failure" | "untrusted",
          sandboxMode: sandboxMode as "read-only" | "workspace-write" | "danger-full-access",
          ...(model ? { model } : {}),
          ...(reasoningEffort
            ? {
                modelReasoningEffort: reasoningEffort as
                  | "minimal"
                  | "low"
                  | "medium"
                  | "high"
                  | "xhigh",
              }
            : {}),
        });

        const result = await thread.run(task, {
          signal: abortController.signal,
        });
        const durationMs = Date.now() - startTime;

        const usage = (result.usage ?? {}) as CodexUsage;
        const items = ((result as Record<string, unknown>).items ?? []) as CodexItem[];
        const itemsSummary = extractItemsSummary(items);

        const hasErrors =
          itemsSummary.errors.length > 0 ||
          itemsSummary.commands.some((c) => c.exitCode !== undefined && c.exitCode !== 0);

        const summary = {
          status: hasErrors ? "completed_with_errors" : "success",
          result: result.finalResponse ?? "",
          durationMs,
          workingDirectory: effectiveCwd,
          model: model ?? "default",
          reasoningEffort: reasoningEffort ?? "default",
          usage: {
            inputTokens: usage.input_tokens ?? 0,
            cachedInputTokens: usage.cached_input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
          },
          filesChanged: itemsSummary.filesChanged,
          commandsRun: itemsSummary.commands.length,
          failedCommands: itemsSummary.commands.filter(
            (c) => c.exitCode !== undefined && c.exitCode !== 0,
          ).length,
          errors: itemsSummary.errors,
        };

        // Persistent log — full detail for debugging
        appendSessionLog({
          timestamp: new Date().toISOString(),
          tool: "codex",
          taskPreview: task.slice(0, 200),
          ...summary,
          commands: itemsSummary.commands,
          agentMessages: itemsSummary.agentMessages.slice(-5),
          reasoning: itemsSummary.reasoning.slice(-3).map((r) => r.slice(0, 300)),
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
          details: summary,
        };
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const errMsg = err instanceof Error ? err.message : String(err);

        // Log failures too
        appendSessionLog({
          timestamp: new Date().toISOString(),
          tool: "codex",
          taskPreview: task.slice(0, 200),
          status: abortController.signal.aborted ? "timeout" : "error",
          error: errMsg,
          durationMs,
          workingDirectory: effectiveCwd,
          model: model ?? "default",
        });

        if (abortController.signal.aborted) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    status: "timeout",
                    error: `Task timed out after ${timeoutMs / 1000}s`,
                    durationMs,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        throw new Error(`Codex session failed: ${errMsg}`);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
