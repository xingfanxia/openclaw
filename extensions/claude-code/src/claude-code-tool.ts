import * as fs from "fs";
import * as path from "path";
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import { resolveClaudeConfig } from "./config-sharing.js";
import type { ProjectRegistry } from "./project-registry.js";
import type { WorktreeManager, WorktreeInfo } from "./worktree-manager.js";

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

type PluginCfg = {
  workspaceDir?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  permissionMode?: string;
  model?: string;
  timeoutMs?: number;
  claudeConfigPath?: string;
  worktree?: {
    mode?: string;
    basePath?: string;
    cleanupAfterHours?: number;
    branchPrefix?: string;
  };
};

type SDKMessage = {
  type: string;
  subtype?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  is_error?: boolean;
  errors?: string[];
  usage?: Record<string, unknown>;
  modelUsage?: Record<string, unknown>;
};

/**
 * Extract text content from an SDK message's content field.
 */
function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (block: unknown) =>
          typeof block === "object" &&
          block !== null &&
          (block as Record<string, unknown>).type === "text",
      )
      .map((block: unknown) => (block as Record<string, unknown>).text ?? "")
      .join("\n");
  }
  return "";
}

export function createClaudeCodeTool(
  api: OpenClawPluginApi,
  registry?: ProjectRegistry,
  worktreeManager?: WorktreeManager,
): AnyAgentTool {
  return {
    name: "claude_code",
    description: [
      "Run a Claude Code session to perform coding tasks: read/write files, run builds,",
      "execute commands, refactor code, fix bugs, create GitHub repos/PRs,",
      "deploy to Vercel for preview, and more.",
      "Supports project routing (project param) and worktree isolation (useWorktree param).",
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
      project: Type.Optional(
        Type.String({
          description:
            "Project ID or name (e.g., 'kyc-backend', 'KYC'). Auto-resolves to working directory.",
        }),
      ),
      useWorktree: Type.Optional(
        Type.Boolean({
          description: "Create isolated git worktree for this task. Default depends on config.",
        }),
      ),
      allowedTools: Type.Optional(
        Type.Array(Type.String(), {
          description: "Restrict available tools. Defaults to Read, Write, Edit, Bash, Glob, Grep.",
        }),
      ),
      maxTurns: Type.Optional(
        Type.Number({
          description: "Maximum conversation turns. Defaults to plugin config or 20.",
        }),
      ),
      model: Type.Optional(
        Type.String({
          description: "Model override (e.g. claude-sonnet-4-5-20250929).",
        }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const task = typeof params.task === "string" ? params.task.trim() : "";
      if (!task) {
        throw new Error("task is required");
      }

      const cfg = (api.pluginConfig ?? {}) as PluginCfg;

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

      // Config sharing
      const claudeConfig = await resolveClaudeConfig(cfg.claudeConfigPath ?? "/home/node/.claude");
      const envOverride = claudeConfig?.env ?? {};

      // Worktree sandbox
      let worktreeInfo: WorktreeInfo | undefined;
      const useWt =
        typeof params.useWorktree === "boolean"
          ? params.useWorktree
          : (worktreeManager?.shouldUseWorktree(undefined, true) ?? false);

      if (useWt && worktreeManager) {
        try {
          worktreeInfo = await worktreeManager.create(effectiveCwd);
          effectiveCwd = worktreeInfo.path;
        } catch {
          // Worktree creation failed — proceed without isolation
        }
      }

      const maxTurns =
        (typeof params.maxTurns === "number" && params.maxTurns > 0
          ? params.maxTurns
          : undefined) ??
        cfg.maxTurns ??
        20;

      const maxBudgetUsd = cfg.maxBudgetUsd ?? 2.0;
      const timeoutMs = cfg.timeoutMs ?? 300_000; // 5 minutes

      const model =
        (typeof params.model === "string" && params.model.trim()) || cfg.model || undefined;

      const allowedTools = Array.isArray(params.allowedTools)
        ? (params.allowedTools as string[])
        : undefined;

      const permissionMode = (cfg.permissionMode ?? "bypassPermissions") as
        | "default"
        | "acceptEdits"
        | "bypassPermissions";

      // Dynamic import — the SDK may not be installed in all environments
      let queryFn: typeof import("@anthropic-ai/claude-agent-sdk").query;
      try {
        const sdk = await import("@anthropic-ai/claude-agent-sdk");
        queryFn = sdk.query;
      } catch {
        throw new Error(
          "Claude Agent SDK not available. Install with: npm install @anthropic-ai/claude-agent-sdk",
        );
      }

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), timeoutMs);
      const startTime = Date.now();

      const assistantTexts: string[] = [];
      let resultMsg: SDKMessage | undefined;

      try {
        const stream = queryFn({
          prompt: task,
          options: {
            cwd: effectiveCwd,
            maxTurns,
            maxBudgetUsd,
            model,
            abortController,
            permissionMode,
            allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
            systemPrompt: { type: "preset", preset: "claude_code" },
            tools: allowedTools ? allowedTools : { type: "preset", preset: "claude_code" },
            env: { ...process.env, ...envOverride },
          },
        });

        for await (const message of stream) {
          const msg = message as SDKMessage;
          if (msg.type === "assistant" && msg.message?.content) {
            const text = extractText(msg.message.content);
            if (text) {
              assistantTexts.push(text);
            }
          }
          if (msg.type === "result") {
            resultMsg = msg;
          }
        }
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const errMsg = err instanceof Error ? err.message : String(err);

        // Log failures
        appendSessionLog({
          timestamp: new Date().toISOString(),
          tool: "claude_code",
          taskPreview: task.slice(0, 200),
          status: abortController.signal.aborted ? "timeout" : "error",
          error: errMsg,
          durationMs,
          workingDirectory: effectiveCwd,
          assistantTextCount: assistantTexts.length,
          lastAssistantText: assistantTexts.slice(-1).map((t) => t.slice(0, 300)),
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
                    partialOutput: assistantTexts.slice(-3).join("\n\n"),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        throw new Error(`Claude Code session failed: ${errMsg}`);
      } finally {
        clearTimeout(timeout);
      }

      // Build response
      const isError = resultMsg?.is_error ?? false;
      const status = isError ? (resultMsg?.subtype ?? "error") : (resultMsg?.subtype ?? "success");

      const summary: Record<string, unknown> = {
        status,
        result: resultMsg?.result ?? assistantTexts.slice(-2).join("\n\n"),
        turns: resultMsg?.num_turns ?? 0,
        costUsd: resultMsg?.total_cost_usd ?? 0,
        durationMs: resultMsg?.duration_ms ?? 0,
        workingDirectory: effectiveCwd,
        ...(isError && resultMsg?.errors ? { errors: resultMsg.errors } : {}),
      };

      // Add worktree summary if applicable
      if (worktreeInfo && worktreeManager) {
        try {
          const wtSummary = await worktreeManager.getSummary(worktreeInfo);
          summary.worktree = wtSummary;
        } catch {
          summary.worktree = {
            branchName: worktreeInfo.branchName,
            path: worktreeInfo.path,
          };
        }
      }

      // Persistent log — full detail for debugging
      appendSessionLog({
        timestamp: new Date().toISOString(),
        tool: "claude_code",
        taskPreview: task.slice(0, 200),
        status: summary.status,
        result: (summary.result as string)?.slice?.(0, 500) ?? "",
        turns: summary.turns,
        costUsd: summary.costUsd,
        durationMs: summary.durationMs,
        workingDirectory: summary.workingDirectory,
        ...(summary.errors ? { errors: summary.errors } : {}),
        ...(summary.worktree ? { worktree: summary.worktree } : {}),
        assistantTextCount: assistantTexts.length,
        lastAssistantText: assistantTexts.slice(-1).map((t) => t.slice(0, 300)),
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
        details: summary,
      };
    },
  };
}
