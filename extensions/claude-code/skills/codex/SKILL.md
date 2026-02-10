---
name: codex
description: Dispatch coding tasks to OpenAI Codex via the Codex SDK for reading, editing, building, and debugging code.
metadata: { "openclaw": { "emoji": "🔧" } }
---

# Codex (SDK)

Use the `codex` tool to run an OpenAI Codex session that can read files, edit code, run builds, execute shell commands, and complete coding tasks autonomously.

## When to use

| User intent                   | Use codex?                   |
| ----------------------------- | ---------------------------- |
| "Fix the bug in auth.py"      | **Yes** — coding task        |
| "Add a new API endpoint"      | **Yes** — coding task        |
| "Run the tests"               | **Yes** — needs shell access |
| "Create a hello world script" | **Yes** — file creation      |
| "What's the weather?"         | No — not a coding task       |

## Choosing between claude_code and codex

Both tools do similar work. Use the one the user requests. If they don't specify:

| Situation                                   | Recommendation              |
| ------------------------------------------- | --------------------------- |
| User says "use codex" or "use openai"       | Use `codex`                 |
| User says "use claude" or "use claude code" | Use `claude_code`           |
| No preference stated                        | Use `claude_code` (default) |
| Task needs OpenAI-specific models           | Use `codex`                 |

## How to use

### Basic task

```json
{
  "task": "Fix the type error in src/utils/parser.ts",
  "workingDirectory": "/home/node/projects/myapp"
}
```

### With model override

```json
{
  "task": "Refactor the database layer to use connection pooling",
  "workingDirectory": "/home/node/projects/api",
  "model": "codex-mini"
}
```

### Read-only (sandbox)

```json
{
  "task": "Explain the architecture of this project",
  "workingDirectory": "/home/node/projects/myapp",
  "sandboxMode": "read-only"
}
```

## Guidelines

1. **Set the right workingDirectory** — always point to the project root.
2. **Be specific in the task** — include file names, error messages, or expected behavior.
3. **Use sandboxMode read-only** for exploration-only tasks.
4. **Ask clarifying questions** if the user's request is vague.
5. **Report results clearly** — summarize what was done and any issues.

## Response format

The tool returns JSON with:

- `status` — "success" or "timeout"
- `result` — summary of what Codex did
- `durationMs` — how long it took
- `workingDirectory` — where it ran
- `model` — which model was used
- `usage` — token usage (inputTokens, outputTokens, totalTokens)
