import { access, constants } from "node:fs/promises";
import { join } from "node:path";

export interface ClaudeConfigResult {
  env: Record<string, string | undefined>;
}

/**
 * Resolve Claude configuration from a mounted ~/.claude directory.
 * Returns env overrides if the config directory exists and has CLAUDE.md,
 * or null for graceful degradation when the volume isn't mounted.
 */
export async function resolveClaudeConfig(
  claudeHomePath: string,
): Promise<ClaudeConfigResult | null> {
  try {
    await access(claudeHomePath, constants.R_OK);
  } catch {
    return null;
  }

  // Check for CLAUDE.md as a signal that this is a valid config dir
  try {
    await access(join(claudeHomePath, "CLAUDE.md"), constants.R_OK);
  } catch {
    // Directory exists but no CLAUDE.md — still usable if it has rules/ etc.
  }

  // The SDK reads config from $HOME/.claude/
  // We need the parent of claudeHomePath to be HOME
  const homeDir = join(claudeHomePath, "..");

  return {
    env: {
      HOME: homeDir,
      // Preserve existing ANTHROPIC_API_KEY if set
      ...(process.env.ANTHROPIC_API_KEY
        ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
        : {}),
    },
  };
}
