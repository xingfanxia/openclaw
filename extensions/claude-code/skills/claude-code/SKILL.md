---
name: claude-code
description: Dispatch coding tasks to Claude Code via the Agent SDK for reading, editing, building, debugging code, creating PRs, and deploying previews.
metadata: { "openclaw": { "emoji": "🛠️" } }
---

# Claude Code (Agent SDK)

Use the `claude_code` tool to run a real Claude Code session that can read files, edit code, run builds, execute shell commands, create GitHub repos/PRs, deploy Vercel previews, and complete coding tasks autonomously.

**Note:** The `codex` tool is also available for OpenAI Codex tasks. Use whichever the user requests, defaulting to `claude_code`.

## When to use

| User intent                        | Use claude_code?                  |
| ---------------------------------- | --------------------------------- |
| "Fix the bug in auth.py"           | **Yes** — coding task             |
| "Add a new API endpoint for users" | **Yes** — coding task             |
| "Run the tests"                    | **Yes** — needs shell access      |
| "Refactor the database module"     | **Yes** — multi-file code changes |
| "Create a hello world script"      | **Yes** — file creation           |
| "Create a PR for this change"      | **Yes** — GitHub integration      |
| "Deploy a preview of the frontend" | **Yes** — Vercel deploy           |
| "Fix the KYC bug"                  | **Yes** — use project: "kyc"      |
| "What's the weather?"              | No — not a coding task            |
| "Send a message to Alice"          | No — use message tool             |

## How to use

### Basic task

```json
{
  "task": "Fix the type error in src/utils/parser.ts — the function parseConfig returns string but should return Config",
  "workingDirectory": "/home/node/projects/myapp"
}
```

### Project routing (auto-resolve directory)

Instead of specifying `workingDirectory`, use `project` to auto-resolve:

```json
{
  "task": "Fix the authentication bug in the verification flow",
  "project": "kyc"
}
```

The project parameter accepts IDs, names, or keywords. Examples:

- `"kyc"` → resolves to KYC backend
- `"backend"` → resolves to main backend
- `"panpanmao"` → resolves to PanPanMao monorepo

### Worktree isolation

Use `useWorktree: true` to run the task in an isolated git worktree. Changes are made on a separate branch and reported back with a diff summary.

```json
{
  "task": "Refactor the database layer to use connection pooling",
  "project": "backend",
  "useWorktree": true
}
```

### With constraints

```json
{
  "task": "Add input validation to all API endpoints using zod",
  "project": "backend",
  "maxTurns": 30
}
```

### Read-only exploration

```json
{
  "task": "Explain the architecture of this project — what are the main modules and how do they connect?",
  "project": "panpanmao",
  "allowedTools": ["Read", "Glob", "Grep"]
}
```

### Create a GitHub PR

```json
{
  "task": "Fix the login timeout issue and create a PR with the changes",
  "project": "backend",
  "useWorktree": true
}
```

### Deploy preview

```json
{
  "task": "Build and deploy a Vercel preview of the current state",
  "project": "panpanmao"
}
```

## Available commands

| Command                     | Description                                       |
| --------------------------- | ------------------------------------------------- |
| `/projects [query]`         | List all discovered projects or search by keyword |
| `/projects_scan`            | Rescan workspace for new projects                 |
| `/worktrees`                | List active git worktrees                         |
| `/worktrees_merge <branch>` | Merge a worktree branch back to parent            |
| `/worktrees_cleanup`        | Remove stale worktrees older than threshold       |
| `/deploy_preview <project>` | Deploy a project to Vercel for preview            |

## Guidelines

1. **Use project routing** — prefer `project` param over `workingDirectory` when possible.
2. **Use worktrees for risky changes** — set `useWorktree: true` for refactoring, experimental changes, or when you want easy rollback.
3. **Be specific in the task** — include file names, error messages, or expected behavior when possible.
4. **Use allowedTools for safety** — restrict to `["Read", "Glob", "Grep"]` for exploration-only tasks.
5. **Ask clarifying questions** if the user's request is vague:
   - "Which project should I work on?"
   - "Can you share the error message?"
   - "Do you want me to also run the tests after fixing?"
6. **Report results clearly** — after the tool returns, summarize what was done, files changed, and any issues.
7. **Handle errors gracefully** — if the session fails or times out, explain what happened and suggest next steps.

## Response format

The tool returns JSON with:

- `status` — "success", "error", "timeout", etc.
- `result` — summary of what Claude Code did
- `turns` — number of conversation turns used
- `costUsd` — cost of the session
- `durationMs` — how long it took
- `workingDirectory` — where it ran
- `errors` — error details (if any)
- `worktree` — (when worktree used) branch name, path, files changed, insertions, deletions

## Available projects

Projects are auto-discovered from `/home/node/projects/` and configured overrides. Use `/projects` to see the full list.

Key projects:

- **kyc** — KYC verification service (Python)
- **backend** — Main Compute Labs backend (Python)
- **panpanmao** — PanPanMao product (TypeScript)

When the user doesn't specify a project, ask which one they want to work on, or use `/projects` to list options.
