/**
 * Vertex AI Anthropic provider for Claude models on GCP.
 *
 * Uses @anthropic-ai/vertex-sdk for authentication (gcloud ADC) and
 * registers a custom "vertex-anthropic" API type via pi-ai's registry.
 */
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import {
  createAssistantMessageEventStream,
  calculateCost,
  registerApiProvider,
  type Model,
  type StreamFunction,
  type StreamOptions,
} from "@mariozechner/pi-ai";
import { parseStreamingJson } from "@mariozechner/pi-ai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VertexAnthropicEffort = "low" | "medium" | "high" | "max";

export interface VertexAnthropicOptions extends StreamOptions {
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;
  effort?: VertexAnthropicEffort;
  interleavedThinking?: boolean;
  toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
  cacheRetention?: "short" | "long" | "none";
}

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

interface VertexClaudeModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

const VERTEX_CLAUDE_MODELS: VertexClaudeModel[] = [
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6 (Vertex)",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 200_000,
    maxTokens: 128_000,
  },
  {
    id: "claude-opus-4-5@20251101",
    name: "Claude Opus 4.5 (Vertex)",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 200_000,
    maxTokens: 64_000,
  },
  {
    id: "claude-sonnet-4-5@20250929",
    name: "Claude Sonnet 4.5 (Vertex)",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200_000,
    maxTokens: 64_000,
  },
  {
    id: "claude-sonnet-4@20250514",
    name: "Claude Sonnet 4 (Vertex)",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200_000,
    maxTokens: 64_000,
  },
  {
    id: "claude-haiku-4-5@20251001",
    name: "Claude Haiku 4.5 (Vertex)",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    contextWindow: 200_000,
    maxTokens: 16_000,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveProject(): string {
  const p =
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    process.env.ANTHROPIC_VERTEX_PROJECT_ID;
  if (!p) {
    throw new Error("Vertex AI requires a project ID. Set GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT.");
  }
  return p;
}

function resolveLocation(): string {
  return process.env.GOOGLE_CLOUD_LOCATION ?? process.env.CLOUD_ML_REGION ?? "us-east5";
}

function supportsAdaptiveThinking(modelId: string): boolean {
  return modelId.includes("opus-4-6") || modelId.includes("opus-4.6");
}

function mapStopReason(reason: string): string {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "maxTokens";
    case "stop_sequence":
      return "stop";
    case "tool_use":
      return "toolUse";
    default:
      return "stop";
  }
}

function mapEffort(level: string | undefined): VertexAnthropicEffort {
  switch (level) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
      return "max";
    default:
      return "high";
  }
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

export const streamVertexAnthropic: StreamFunction<"vertex-anthropic", VertexAnthropicOptions> = (
  model,
  context,
  options,
) => {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output: any = {
      role: "assistant",
      content: [],
      api: "vertex-anthropic",
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    try {
      const project = resolveProject();
      const location = resolveLocation();

      const client = new AnthropicVertex({
        projectId: project,
        region: location,
      });

      // Build params --------------------------------------------------------

      // Convert pi-ai messages to Anthropic SDK format, filtering empty content
      const anthropicMessages: any[] = [];
      for (let i = 0; i < context.messages.length; i++) {
        const msg = context.messages[i] as any;

        if (msg.role === "user") {
          if (typeof msg.content === "string") {
            if (msg.content.trim().length === 0) {
              continue;
            }
            anthropicMessages.push({ role: "user" as const, content: msg.content });
          } else {
            // Multi-part content (text + images)
            const parts = (Array.isArray(msg.content) ? msg.content : [msg.content])
              .map((part: any) => {
                if (part.type === "text") {
                  return { type: "text" as const, text: part.text };
                }
                if (part.type === "image") {
                  return {
                    type: "image" as const,
                    source: {
                      type: "base64" as const,
                      media_type: part.mimeType ?? "image/png",
                      data: part.data,
                    },
                  };
                }
                return { type: "text" as const, text: String(part.text ?? "") };
              })
              .filter((p: any) => {
                if (p.type === "text") {
                  return p.text.trim().length > 0;
                }
                return true;
              });
            if (parts.length === 0) {
              continue;
            }
            anthropicMessages.push({ role: "user" as const, content: parts });
          }
        } else if (msg.role === "assistant") {
          const blocks = (msg.content ?? [])
            .map((block: any) => {
              if (block.type === "text") {
                if (!block.text || block.text.trim().length === 0) {
                  return null;
                }
                return { type: "text" as const, text: block.text };
              }
              if (block.type === "thinking") {
                if (!block.thinking || block.thinking.trim().length === 0) {
                  return null;
                }
                // Convert aborted thinking (no signature) to text
                if (!block.thinkingSignature || block.thinkingSignature.trim().length === 0) {
                  return { type: "text" as const, text: block.thinking };
                }
                return {
                  type: "thinking" as const,
                  thinking: block.thinking,
                  signature: block.thinkingSignature,
                };
              }
              if (block.type === "toolCall") {
                return {
                  type: "tool_use" as const,
                  id: block.id,
                  name: block.name,
                  input: block.arguments ?? {},
                };
              }
              return null;
            })
            .filter(Boolean);
          if (blocks.length === 0) {
            continue;
          }
          anthropicMessages.push({ role: "assistant" as const, content: blocks });
        } else if (msg.role === "toolResult") {
          // Collect consecutive toolResult messages into one user message
          const toolResults: any[] = [];
          toolResults.push({
            type: "tool_result" as const,
            tool_use_id: msg.toolCallId,
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
            is_error: msg.isError ?? false,
          });
          // Look ahead for consecutive toolResults
          while (
            i + 1 < context.messages.length &&
            (context.messages[i + 1] as any).role === "toolResult"
          ) {
            i++;
            const next = context.messages[i] as any;
            toolResults.push({
              type: "tool_result" as const,
              tool_use_id: next.toolCallId,
              content:
                typeof next.content === "string" ? next.content : JSON.stringify(next.content),
              is_error: next.isError ?? false,
            });
          }
          anthropicMessages.push({ role: "user" as const, content: toolResults });
        }
        // Skip unknown roles
      }

      const params: any = {
        model: model.id,
        messages: anthropicMessages,
        max_tokens: options?.maxTokens || Math.floor(model.maxTokens / 3),
        stream: true,
      };

      if (context.systemPrompt) {
        params.system = context.systemPrompt;
      }

      // Thinking config
      if (options?.thinkingEnabled) {
        if (supportsAdaptiveThinking(model.id)) {
          params.thinking = { type: "adaptive" };
          params.output_config = { effort: options?.effort ?? "high" };
        } else if (options?.thinkingBudgetTokens) {
          params.thinking = {
            type: "enabled",
            budget_tokens: options.thinkingBudgetTokens,
          };
        }
      }

      // Tools
      if (context.tools?.length) {
        params.tools = context.tools.map((t: any) => ({
          name: t.name,
          description: t.description,
          input_schema: {
            type: "object",
            properties: (t.parameters || t.inputSchema || t.input_schema || {}).properties || {},
            required: (t.parameters || t.inputSchema || t.input_schema || {}).required || [],
          },
        }));
        if (options?.toolChoice) {
          if (typeof options.toolChoice === "string") {
            params.tool_choice = { type: options.toolChoice };
          } else {
            params.tool_choice = options.toolChoice;
          }
        }
      }

      // Cache control
      if (options?.cacheRetention !== "none" && params.system) {
        const systemContent =
          typeof params.system === "string"
            ? [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }]
            : params.system;
        params.system = systemContent;
      }

      options?.onPayload?.(params);

      // Stream --------------------------------------------------------------
      const anthropicStream = client.messages.stream(
        { ...params, stream: true },
        { signal: options?.signal },
      );

      stream.push({ type: "start", partial: output });
      const blocks = output.content;

      for await (const event of anthropicStream) {
        if (event.type === "message_start") {
          output.usage.input = event.message.usage.input_tokens || 0;
          output.usage.output = event.message.usage.output_tokens || 0;
          output.usage.cacheRead = (event.message.usage as any).cache_read_input_tokens || 0;
          output.usage.cacheWrite = (event.message.usage as any).cache_creation_input_tokens || 0;
          output.usage.totalTokens =
            output.usage.input +
            output.usage.output +
            output.usage.cacheRead +
            output.usage.cacheWrite;
          calculateCost(model, output.usage);
        } else if (event.type === "content_block_start") {
          if (event.content_block.type === "text") {
            const block = { type: "text", text: "", index: event.index };
            blocks.push(block);
            stream.push({
              type: "text_start",
              contentIndex: blocks.length - 1,
              partial: output,
            });
          } else if (event.content_block.type === "thinking") {
            const block = {
              type: "thinking",
              thinking: "",
              thinkingSignature: "",
              index: event.index,
            };
            blocks.push(block);
            stream.push({
              type: "thinking_start",
              contentIndex: blocks.length - 1,
              partial: output,
            });
          } else if (event.content_block.type === "tool_use") {
            const block = {
              type: "toolCall",
              id: event.content_block.id,
              name: event.content_block.name,
              arguments: event.content_block.input ?? {},
              partialJson: "",
              index: event.index,
            };
            blocks.push(block);
            stream.push({
              type: "toolcall_start",
              contentIndex: blocks.length - 1,
              partial: output,
            });
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            const idx = blocks.findIndex((b: any) => b.index === event.index);
            const block = blocks[idx];
            if (block?.type === "text") {
              block.text += event.delta.text;
              stream.push({
                type: "text_delta",
                contentIndex: idx,
                delta: event.delta.text,
                partial: output,
              });
            }
          } else if (event.delta.type === "thinking_delta") {
            const idx = blocks.findIndex((b: any) => b.index === event.index);
            const block = blocks[idx];
            if (block?.type === "thinking") {
              block.thinking += (event.delta as any).thinking;
              stream.push({
                type: "thinking_delta",
                contentIndex: idx,
                delta: (event.delta as any).thinking,
                partial: output,
              });
            }
          } else if (event.delta.type === "input_json_delta") {
            const idx = blocks.findIndex((b: any) => b.index === event.index);
            const block = blocks[idx];
            if (block?.type === "toolCall") {
              block.partialJson += event.delta.partial_json;
              block.arguments = parseStreamingJson(block.partialJson);
              stream.push({
                type: "toolcall_delta",
                contentIndex: idx,
                delta: event.delta.partial_json,
                partial: output,
              });
            }
          } else if ((event.delta as any).type === "signature_delta") {
            const idx = blocks.findIndex((b: any) => b.index === event.index);
            const block = blocks[idx];
            if (block?.type === "thinking") {
              block.thinkingSignature =
                (block.thinkingSignature || "") + (event.delta as any).signature;
            }
          }
        } else if (event.type === "content_block_stop") {
          const idx = blocks.findIndex((b: any) => b.index === event.index);
          const block = blocks[idx];
          if (block) {
            delete block.index;
            if (block.type === "text") {
              stream.push({
                type: "text_end",
                contentIndex: idx,
                content: block.text,
                partial: output,
              });
            } else if (block.type === "thinking") {
              stream.push({
                type: "thinking_end",
                contentIndex: idx,
                content: block.thinking,
                partial: output,
              });
            } else if (block.type === "toolCall") {
              block.arguments = parseStreamingJson(block.partialJson);
              delete block.partialJson;
              stream.push({
                type: "toolcall_end",
                contentIndex: idx,
                toolCall: block,
                partial: output,
              });
            }
          }
        } else if (event.type === "message_delta") {
          if ((event.delta as any).stop_reason) {
            output.stopReason = mapStopReason((event.delta as any).stop_reason);
          }
          const usage = (event as any).usage ?? {};
          if (usage.input_tokens != null) {
            output.usage.input = usage.input_tokens;
          }
          if (usage.output_tokens != null) {
            output.usage.output = usage.output_tokens;
          }
          if (usage.cache_read_input_tokens != null) {
            output.usage.cacheRead = usage.cache_read_input_tokens;
          }
          if (usage.cache_creation_input_tokens != null) {
            output.usage.cacheWrite = usage.cache_creation_input_tokens;
          }
          output.usage.totalTokens =
            output.usage.input +
            output.usage.output +
            output.usage.cacheRead +
            output.usage.cacheWrite;
          calculateCost(model, output.usage);
        }
      }

      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }
      if (output.stopReason === "aborted" || output.stopReason === "error") {
        throw new Error("An unknown error occurred");
      }

      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      for (const block of output.content) {
        delete (block as any).index;
      }
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
};

// Simple streaming wrapper with reasoning level mapping
export const streamSimpleVertexAnthropic: StreamFunction<
  "vertex-anthropic",
  StreamOptions & { reasoning?: string; thinkingBudgets?: Record<string, number> }
> = (model, context, options) => {
  if (!options?.reasoning) {
    return streamVertexAnthropic(model, context, {
      ...options,
      thinkingEnabled: false,
    });
  }

  if (supportsAdaptiveThinking(model.id)) {
    return streamVertexAnthropic(model, context, {
      ...options,
      thinkingEnabled: true,
      effort: mapEffort(options.reasoning),
    });
  }

  // Older models: budget-based thinking
  const budgets: Record<string, number> = {
    minimal: 1024,
    low: 4096,
    medium: 16384,
    high: 32768,
  };
  const budget =
    (options as any).thinkingBudgets?.[options.reasoning] ?? budgets[options.reasoning] ?? 16384;

  return streamVertexAnthropic(model, context, {
    ...options,
    thinkingEnabled: true,
    thinkingBudgetTokens: budget,
    maxTokens: Math.max((options?.maxTokens ?? model.maxTokens) - budget, 4096),
  });
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the vertex-anthropic API provider with pi-ai's streaming registry.
 * Call this during OpenClaw startup.
 */
export function registerVertexAnthropicApi(): void {
  registerApiProvider(
    {
      api: "vertex-anthropic" as any,
      stream: streamVertexAnthropic as any,
      streamSimple: streamSimpleVertexAnthropic as any,
    },
    "vertex-anthropic",
  );
}

/**
 * Build a models-config provider entry for auto-discovery.
 */
export function buildVertexAnthropicProvider(): {
  baseUrl: string;
  api: string;
  auth: string;
  models: Array<{
    id: string;
    name: string;
    reasoning: boolean;
    input: string[];
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
  }>;
} {
  const location = resolveLocation();
  const project = resolveProject();
  return {
    baseUrl: `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/anthropic`,
    api: "vertex-anthropic",
    auth: "gcloud-adc",
    models: VERTEX_CLAUDE_MODELS,
  };
}

/**
 * Check if Vertex AI Anthropic credentials are available.
 */
export function isVertexAnthropicAvailable(): boolean {
  return Boolean(
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    process.env.ANTHROPIC_VERTEX_PROJECT_ID,
  );
}
