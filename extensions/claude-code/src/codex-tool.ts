import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import type { ProjectRegistry } from "./project-registry.js";

type PluginCfg = {
  workspaceDir?: string;
  timeoutMs?: number;
  codex?: {
    model?: string;
    approvalPolicy?: string;
    sandboxMode?: string;
  };
};

type CodexUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

export function createCodexTool(api: OpenClawPluginApi, registry?: ProjectRegistry): AnyAgentTool {
  return {
    name: "codex",
    description: [
      "Run an OpenAI Codex session to perform coding tasks: read/write files, run builds,",
      "execute commands, refactor code, fix bugs, and more.",
      "Returns a summary of what was done, files changed, and status.",
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
        });

        const startTime = Date.now();
        const result = await thread.run(task, {
          signal: abortController.signal,
        });
        const durationMs = Date.now() - startTime;

        const usage = (result.usage ?? {}) as CodexUsage;

        const summary = {
          status: "success",
          result: result.finalResponse ?? "",
          durationMs,
          workingDirectory: effectiveCwd,
          model: model ?? "default",
          usage: {
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            totalTokens: usage.total_tokens ?? 0,
          },
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
          details: summary,
        };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (abortController.signal.aborted) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    status: "timeout",
                    error: `Task timed out after ${timeoutMs / 1000}s`,
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
