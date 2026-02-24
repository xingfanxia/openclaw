export type UsageLike = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
  // Common alternates across providers/SDKs.
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  // Some agents/logs emit alternate naming.
  totalTokens?: number;
  total_tokens?: number;
  cache_read?: number;
  cache_write?: number;
};

export type NormalizedUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
};

const asFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number") {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return value;
};

export function hasNonzeroUsage(usage?: NormalizedUsage | null): usage is NormalizedUsage {
  if (!usage) {
    return false;
  }
  return [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.total].some(
    (v) => typeof v === "number" && Number.isFinite(v) && v > 0,
  );
}

export function normalizeUsage(raw?: UsageLike | null): NormalizedUsage | undefined {
  if (!raw) {
    return undefined;
  }

  const input = asFiniteNumber(
    raw.input ?? raw.inputTokens ?? raw.input_tokens ?? raw.promptTokens ?? raw.prompt_tokens,
  );
  const output = asFiniteNumber(
    raw.output ??
      raw.outputTokens ??
      raw.output_tokens ??
      raw.completionTokens ??
      raw.completion_tokens,
  );
  const cacheRead = asFiniteNumber(raw.cacheRead ?? raw.cache_read ?? raw.cache_read_input_tokens);
  const cacheWrite = asFiniteNumber(
    raw.cacheWrite ?? raw.cache_write ?? raw.cache_creation_input_tokens,
  );
  const total = asFiniteNumber(raw.total ?? raw.totalTokens ?? raw.total_tokens);

  if (
    input === undefined &&
    output === undefined &&
    cacheRead === undefined &&
    cacheWrite === undefined &&
    total === undefined
  ) {
    return undefined;
  }

  // Normalize Gemini-style usage where `input` = total prompt tokens (inclusive of cached)
  // and `cacheRead` is a subset of `input`. Detected when total ≈ input + output (within 5%),
  // meaning cached tokens are NOT added separately to total (unlike Anthropic convention).
  // After normalization, `input` = non-cached tokens only, consistent with Anthropic convention.
  let normalizedInput = input;
  if (
    input !== undefined &&
    input > 0 &&
    cacheRead !== undefined &&
    cacheRead > 0 &&
    cacheRead < input &&
    total !== undefined &&
    total > 0
  ) {
    const inputPlusOutput = input + (output ?? 0);
    const diff = Math.abs(total - inputPlusOutput);
    if (diff / total < 0.05) {
      // total ≈ input + output → Gemini-style (input includes cached tokens)
      normalizedInput = input - cacheRead;
    }
  }

  return {
    input: normalizedInput,
    output,
    cacheRead,
    cacheWrite,
    total,
  };
}

export function derivePromptTokens(usage?: {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): number | undefined {
  if (!usage) {
    return undefined;
  }
  const input = usage.input ?? 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const sum = input + cacheRead + cacheWrite;
  return sum > 0 ? sum : undefined;
}

export function deriveSessionTotalTokens(params: {
  usage?: {
    input?: number;
    total?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextTokens?: number;
  promptTokens?: number;
}): number | undefined {
  const promptOverride = params.promptTokens;
  const hasPromptOverride =
    typeof promptOverride === "number" && Number.isFinite(promptOverride) && promptOverride > 0;
  const usage = params.usage;
  if (!usage && !hasPromptOverride) {
    return undefined;
  }
  const input = usage?.input ?? 0;
  const promptTokens = hasPromptOverride
    ? promptOverride
    : derivePromptTokens({
        input: usage?.input,
        cacheRead: usage?.cacheRead,
        cacheWrite: usage?.cacheWrite,
      });
  let total = promptTokens ?? usage?.total ?? input;
  if (!(total > 0)) {
    return undefined;
  }

  // NOTE: Do NOT clamp total to contextTokens here. The stored totalTokens
  // should reflect the actual token count (or best estimate). Clamping causes
  // /status to display contextTokens/contextTokens (100%) when the accumulated
  // input exceeds the context window, hiding the real usage. The display layer
  // (formatTokens in status.ts) already caps the percentage at 999%.
  return total;
}
