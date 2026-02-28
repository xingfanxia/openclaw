import * as fs from "fs";
import { randomUUID } from "node:crypto";
import * as path from "path";
import { Type } from "@sinclair/typebox";
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
    timeoutMs?: number;
    backgroundTimeoutMs?: number;
    maxTimeoutMs?: number;
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

type CodexSummary = {
  status: "success" | "completed_with_errors" | "timeout" | "cancelled";
  result?: string;
  durationMs: number;
  workingDirectory: string;
  model: string;
  reasoningEffort: string;
  usage?: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  };
  filesChanged?: Array<{ path: string; kind: string }>;
  commandsRun?: number;
  failedCommands?: number;
  errors?: string[];
  error?: string;
};

type CodexJob = {
  id: string;
  status:
    | "accepted"
    | "running"
    | "success"
    | "completed_with_errors"
    | "timeout"
    | "cancelled"
    | "error";
  taskPreview: string;
  workingDirectory: string;
  model: string;
  reasoningEffort: string;
  timeoutMs: number;
  createdAt: number;
  startedAt?: number;
  updatedAt: number;
  sessionKey?: string;
  summary?: CodexSummary;
  error?: string;
};

type CodexAbortState = {
  controller: AbortController;
  reason?: "cancelled" | "timeout";
};

type CodexToolContext = {
  sessionKey?: string;
};

const LOG_DIR = "/tmp/openclaw";
const LOG_FILE = path.join(LOG_DIR, "coding-sessions.jsonl");
const CODEX_JOB_HISTORY_LIMIT = 200;
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_BACKGROUND_TIMEOUT_MS = 900_000;
const DEFAULT_MAX_TIMEOUT_MS = 3_600_000;
const DEFAULT_STALLED_AFTER_MS = 180_000;
const CODEX_JOBS = new Map<string, CodexJob>();
const CODEX_JOB_ABORT_STATES = new Map<string, CodexAbortState>();

function getJobStallState(job: { status: string; updatedAt: number }, now: number) {
  const stalledForMs = Math.max(0, now - job.updatedAt);
  const isActive = job.status === "accepted" || job.status === "running";
  return {
    stalledForMs,
    stalledAfterMs: DEFAULT_STALLED_AFTER_MS,
    isLikelyStalled: isActive && stalledForMs > DEFAULT_STALLED_AFTER_MS,
  };
}

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

function pruneCodexJobs() {
  if (CODEX_JOBS.size <= CODEX_JOB_HISTORY_LIMIT) {
    return;
  }
  for (const [jobId, job] of CODEX_JOBS) {
    if (CODEX_JOBS.size <= CODEX_JOB_HISTORY_LIMIT) {
      break;
    }
    if (job.status === "running" || job.status === "accepted") {
      continue;
    }
    CODEX_JOBS.delete(jobId);
  }
  while (CODEX_JOBS.size > CODEX_JOB_HISTORY_LIMIT) {
    const oldest = CODEX_JOBS.keys().next().value as string | undefined;
    if (!oldest) {
      break;
    }
    CODEX_JOBS.delete(oldest);
  }
}

function normalizeTimeoutMs(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return undefined;
  }
  return Math.max(1_000, Math.floor(raw));
}

function resolveTimeoutMs(params: { requested?: number; fallback?: number; max?: number }): number {
  const fallback = normalizeTimeoutMs(params.fallback) ?? DEFAULT_TIMEOUT_MS;
  const requested = normalizeTimeoutMs(params.requested);
  const cappedMax = normalizeTimeoutMs(params.max) ?? DEFAULT_MAX_TIMEOUT_MS;
  const base = requested ?? fallback;
  return Math.max(1_000, Math.min(cappedMax, base));
}

function buildTerminalEventText(job: CodexJob): string {
  const id = job.id.slice(0, 8);
  const status = job.status;
  const preview = job.taskPreview.trim();
  const summary = job.summary;
  const detail = (() => {
    if (status === "success") {
      const changed = summary?.filesChanged?.length ?? 0;
      return changed > 0 ? `files=${changed}` : "completed";
    }
    const err = (job.error ?? summary?.error ?? summary?.errors?.[0] ?? "").trim();
    return err ? `error=${err.slice(0, 180)}` : "needs follow-up";
  })();
  const head = `Codex background job ${id} ${status}.`;
  const body = preview ? ` task="${preview.slice(0, 120)}"` : "";
  return `${head}${body} ${detail}`;
}

function emitTerminalJobEvent(api: OpenClawPluginApi, job: CodexJob): void {
  const sessionKey = job.sessionKey?.trim();
  if (!sessionKey) {
    return;
  }
  try {
    api.runtime.system.enqueueSystemEvent(buildTerminalEventText(job), {
      sessionKey,
      contextKey: `codex:${job.id}`,
    });
    api.runtime.system.requestHeartbeatNow({
      // Reuse exec-event wake path so heartbeat can reliably relay completion/failure details.
      reason: "exec-event",
      coalesceMs: 0,
    });
  } catch {
    // Best effort only.
  }
}

async function runCodexTask(params: {
  task: string;
  effectiveCwd: string;
  model?: string;
  sandboxMode: string;
  reasoningEffort?: string;
  approvalPolicy: string;
  timeoutMs: number;
  abortState?: CodexAbortState;
  onHeartbeat?: () => void;
  heartbeatMs?: number;
}): Promise<{
  toolResult: {
    content: Array<{ type: "text"; text: string }>;
    details?: CodexSummary;
  };
  summary: CodexSummary;
}> {
  // Dynamic import — the SDK may not be installed in all environments
  let CodexClass: typeof import("@openai/codex-sdk").Codex;
  try {
    const sdk = await import("@openai/codex-sdk");
    CodexClass = sdk.Codex;
  } catch {
    throw new Error("Codex SDK not available. Install with: npm install @openai/codex-sdk");
  }

  const abortState = params.abortState;
  const abortController = abortState?.controller ?? new AbortController();
  const timeout = setTimeout(() => {
    if (abortState) {
      abortState.reason = "timeout";
    }
    abortController.abort();
  }, params.timeoutMs);
  const heartbeatMs = Math.max(1_000, params.heartbeatMs ?? 15_000);
  const heartbeat = setInterval(() => {
    params.onHeartbeat?.();
  }, heartbeatMs);
  const startTime = Date.now();
  const modelLabel = params.model ?? "default";
  const effortLabel = params.reasoningEffort ?? "default";

  try {
    const codex = new CodexClass({
      ...(params.model ? { config: { model: params.model } } : {}),
    });

    const thread = codex.startThread({
      workingDirectory: params.effectiveCwd,
      skipGitRepoCheck: true,
      approvalPolicy: params.approvalPolicy as "never" | "on-request" | "on-failure" | "untrusted",
      sandboxMode: params.sandboxMode as "read-only" | "workspace-write" | "danger-full-access",
      ...(params.model ? { model: params.model } : {}),
      ...(params.reasoningEffort
        ? {
            modelReasoningEffort: params.reasoningEffort as
              | "minimal"
              | "low"
              | "medium"
              | "high"
              | "xhigh",
          }
        : {}),
    });

    const result = await thread.run(params.task, {
      signal: abortController.signal,
    });
    const durationMs = Date.now() - startTime;

    const usage = (result.usage ?? {}) as CodexUsage;
    const items = ((result as Record<string, unknown>).items ?? []) as CodexItem[];
    const itemsSummary = extractItemsSummary(items);

    const hasErrors =
      itemsSummary.errors.length > 0 ||
      itemsSummary.commands.some((c) => c.exitCode !== undefined && c.exitCode !== 0);

    const summary: CodexSummary = {
      status: hasErrors ? "completed_with_errors" : "success",
      result: result.finalResponse ?? "",
      durationMs,
      workingDirectory: params.effectiveCwd,
      model: modelLabel,
      reasoningEffort: effortLabel,
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
      taskPreview: params.task.slice(0, 200),
      ...summary,
      commands: itemsSummary.commands,
      agentMessages: itemsSummary.agentMessages.slice(-5),
      reasoning: itemsSummary.reasoning.slice(-3).map((r) => r.slice(0, 300)),
    });

    return {
      toolResult: {
        content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
        details: summary,
      },
      summary,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : String(err);
    const wasAborted = abortController.signal.aborted;
    const wasCancelled = wasAborted && abortState?.reason === "cancelled";
    const timedOut = wasAborted && !wasCancelled;

    const summary: CodexSummary = wasCancelled
      ? {
          status: "cancelled",
          error: "Task cancelled by user.",
          durationMs,
          workingDirectory: params.effectiveCwd,
          model: modelLabel,
          reasoningEffort: effortLabel,
        }
      : timedOut
        ? {
            status: "timeout",
            error: `Task timed out after ${params.timeoutMs / 1000}s`,
            durationMs,
            workingDirectory: params.effectiveCwd,
            model: modelLabel,
            reasoningEffort: effortLabel,
          }
        : {
            status: "completed_with_errors",
            error: errMsg,
            durationMs,
            workingDirectory: params.effectiveCwd,
            model: modelLabel,
            reasoningEffort: effortLabel,
          };

    appendSessionLog({
      timestamp: new Date().toISOString(),
      tool: "codex",
      taskPreview: params.task.slice(0, 200),
      status: wasCancelled ? "cancelled" : timedOut ? "timeout" : "error",
      error: errMsg,
      durationMs,
      workingDirectory: params.effectiveCwd,
      model: modelLabel,
    });

    if (wasAborted) {
      return {
        toolResult: {
          content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
          details: summary,
        },
        summary,
      };
    }
    throw new Error(`Codex session failed: ${errMsg}`);
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
  }
}

export function createCodexTool(
  api: OpenClawPluginApi,
  registry?: ProjectRegistry,
  toolCtx?: CodexToolContext,
): AnyAgentTool {
  return {
    name: "codex",
    description: [
      "Run an OpenAI Codex session to perform coding tasks: read/write files, run builds,",
      "execute commands, refactor code, fix bugs, and more.",
      "Supports async dispatch with background jobs (action: run/status/list/cancel).",
    ].join(" "),
    parameters: Type.Object({
      action: Type.Optional(
        Type.String({
          description:
            "Action: 'run' (default), 'status' (check one job), 'list' (recent jobs), or 'cancel' (stop one job).",
        }),
      ),
      jobId: Type.Optional(
        Type.String({
          description: "Job ID for action='status' or action='cancel'.",
        }),
      ),
      background: Type.Optional(
        Type.Boolean({
          description:
            "When true with action='run', dispatches asynchronously and returns a jobId immediately.",
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          minimum: 1,
          maximum: 50,
          description: "Max jobs returned for action='list' (default: 20).",
        }),
      ),
      timeoutMs: Type.Optional(
        Type.Number({
          minimum: 1000,
          description:
            "Override timeout for this run in milliseconds. Clamped by plugin max timeout.",
        }),
      ),
      task: Type.Optional(
        Type.String({
          description:
            "Clear description of the coding task to perform (required for action='run').",
        }),
      ),
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
      const action =
        typeof params.action === "string" && params.action.trim()
          ? params.action.trim().toLowerCase()
          : "run";
      if (action === "status") {
        const jobId = typeof params.jobId === "string" ? params.jobId.trim() : "";
        if (!jobId) {
          throw new Error("jobId is required for action='status'");
        }
        const job = CODEX_JOBS.get(jobId);
        if (!job) {
          const payload = { status: "not_found", jobId };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
            details: payload,
          };
        }
        const now = Date.now();
        const stall = getJobStallState(job, now);
        const payload = {
          id: job.id,
          status: job.status,
          taskPreview: job.taskPreview,
          workingDirectory: job.workingDirectory,
          model: job.model,
          reasoningEffort: job.reasoningEffort,
          timeoutMs: job.timeoutMs,
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          updatedAt: job.updatedAt,
          elapsedMs: Math.max(0, now - (job.startedAt ?? job.createdAt)),
          ...stall,
          summary: job.summary,
          error: job.error,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          details: payload,
        };
      }
      if (action === "cancel") {
        const jobId = typeof params.jobId === "string" ? params.jobId.trim() : "";
        if (!jobId) {
          throw new Error("jobId is required for action='cancel'");
        }
        const job = CODEX_JOBS.get(jobId);
        if (!job) {
          const payload = { status: "not_found", jobId };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
            details: payload,
          };
        }
        if (job.status !== "accepted" && job.status !== "running") {
          const payload = {
            status: "noop",
            jobId,
            message: `Job already finished with status '${job.status}'.`,
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
            details: payload,
          };
        }
        const abortState = CODEX_JOB_ABORT_STATES.get(jobId);
        if (abortState && !abortState.controller.signal.aborted) {
          abortState.reason = "cancelled";
          abortState.controller.abort();
        }
        job.status = "cancelled";
        job.error = "Task cancelled by user.";
        job.updatedAt = Date.now();
        CODEX_JOBS.set(jobId, job);
        pruneCodexJobs();
        const payload = {
          status: "cancelled",
          jobId,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          details: payload,
        };
      }
      if (action === "list") {
        const rawLimit =
          typeof params.limit === "number" && Number.isFinite(params.limit) ? params.limit : 20;
        const limit = Math.max(1, Math.min(50, Math.floor(rawLimit)));
        const jobs = Array.from(CODEX_JOBS.values())
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, limit)
          .map((job) => {
            const now = Date.now();
            const stall = getJobStallState(job, now);
            return {
              id: job.id,
              status: job.status,
              taskPreview: job.taskPreview,
              workingDirectory: job.workingDirectory,
              model: job.model,
              reasoningEffort: job.reasoningEffort,
              timeoutMs: job.timeoutMs,
              createdAt: job.createdAt,
              startedAt: job.startedAt,
              updatedAt: job.updatedAt,
              elapsedMs: Math.max(0, now - (job.startedAt ?? job.createdAt)),
              ...stall,
            };
          });
        const payload = { count: jobs.length, jobs };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          details: payload,
        };
      }
      if (action !== "run") {
        throw new Error("Invalid action. Use 'run', 'status', 'list', or 'cancel'.");
      }

      const task = typeof params.task === "string" ? params.task.trim() : "";
      if (!task) {
        throw new Error("task is required for action='run'");
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
      const background = params.background === true;
      const requestedTimeoutMs = normalizeTimeoutMs(params.timeoutMs);
      const timeoutMs = resolveTimeoutMs({
        requested: requestedTimeoutMs,
        fallback: background
          ? (codexCfg.backgroundTimeoutMs ??
            codexCfg.timeoutMs ??
            cfg.timeoutMs ??
            DEFAULT_BACKGROUND_TIMEOUT_MS)
          : (codexCfg.timeoutMs ?? cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        max: codexCfg.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS,
      });

      if (background) {
        const now = Date.now();
        const jobId = randomUUID();
        const abortState: CodexAbortState = { controller: new AbortController() };
        const job: CodexJob = {
          id: jobId,
          status: "accepted",
          taskPreview: task.slice(0, 200),
          workingDirectory: effectiveCwd,
          model: model ?? "default",
          reasoningEffort: reasoningEffort ?? "default",
          timeoutMs,
          createdAt: now,
          updatedAt: now,
          sessionKey: toolCtx?.sessionKey,
        };
        CODEX_JOBS.set(jobId, job);
        CODEX_JOB_ABORT_STATES.set(jobId, abortState);
        pruneCodexJobs();

        const accepted = CODEX_JOBS.get(jobId);
        if (accepted) {
          accepted.status = "running";
          accepted.startedAt = Date.now();
          accepted.updatedAt = Date.now();
          CODEX_JOBS.set(jobId, accepted);
        }

        // Fire-and-forget background run; callers can poll via action=status/list.
        void runCodexTask({
          task,
          effectiveCwd,
          model,
          sandboxMode,
          reasoningEffort,
          approvalPolicy,
          timeoutMs,
          abortState,
          onHeartbeat: () => {
            const current = CODEX_JOBS.get(jobId);
            if (!current || current.status !== "running") {
              return;
            }
            current.updatedAt = Date.now();
            CODEX_JOBS.set(jobId, current);
          },
        })
          .then(({ summary }) => {
            const current = CODEX_JOBS.get(jobId);
            if (!current) {
              CODEX_JOB_ABORT_STATES.delete(jobId);
              return;
            }
            current.status =
              current.status === "cancelled" && summary.status !== "cancelled"
                ? "cancelled"
                : summary.status;
            current.summary = summary;
            current.updatedAt = Date.now();
            CODEX_JOBS.set(jobId, current);
            CODEX_JOB_ABORT_STATES.delete(jobId);
            emitTerminalJobEvent(api, current);
            pruneCodexJobs();
          })
          .catch((err) => {
            const current = CODEX_JOBS.get(jobId);
            if (!current) {
              CODEX_JOB_ABORT_STATES.delete(jobId);
              return;
            }
            const message = err instanceof Error ? err.message : String(err);
            current.status = "error";
            current.error = message;
            current.updatedAt = Date.now();
            CODEX_JOBS.set(jobId, current);
            CODEX_JOB_ABORT_STATES.delete(jobId);
            emitTerminalJobEvent(api, current);
            pruneCodexJobs();
          });

        const payload = {
          status: "accepted",
          jobId,
          taskPreview: task.slice(0, 200),
          workingDirectory: effectiveCwd,
          model: model ?? "default",
          reasoningEffort: reasoningEffort ?? "default",
          timeoutMs,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          details: payload,
        };
      }

      const { toolResult } = await runCodexTask({
        task,
        effectiveCwd,
        model,
        sandboxMode,
        reasoningEffort,
        approvalPolicy,
        timeoutMs,
      });
      return toolResult;
    },
  };
}
