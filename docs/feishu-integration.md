# Feishu Integration Guide

## Overview

OpenClaw Feishu integration using the community plugin `@m1heng-clawd/feishu` (v0.1.9+). Provides bidirectional messaging, Bitable (spreadsheet DB), document, wiki, and drive tools.

## Plugin Installation

```bash
# Via docker exec
docker exec openclaw-openclaw-gateway-1 npx openclaw plugins install @m1heng-clawd/feishu

# Installs to: /home/node/.openclaw/extensions/feishu/
```

**Note**: The community plugin shares the same ID "feishu" as the built-in plugin. Both load (with a "duplicate plugin id" warning), but the community plugin registers tools first and takes precedence. The built-in's tools get de-duped names (e.g., `feishu_doc_2`) which are harmless.

## Configuration

### Channel Config (`openclaw.json` → `channels.feishu`)

Use **flat format** (not nested `accounts`):

```json
{
  "feishu": {
    "enabled": true,
    "appId": "<your-app-id>",
    "appSecret": "<your-app-secret>",
    "domain": "feishu",
    "connectionMode": "websocket",
    "dmPolicy": "pairing",
    "groupPolicy": "open",
    "requireMention": true,
    "renderMode": "auto",
    "mediaMaxMb": 30,
    "dmHistoryLimit": 20,
    "historyLimit": 50,
    "tools": {
      "doc": true,
      "wiki": true,
      "drive": true,
      "perm": false,
      "scopes": true
    }
  }
}
```

### Key Config Fields

| Field            | Values                            | Notes                                                 |
| ---------------- | --------------------------------- | ----------------------------------------------------- |
| `connectionMode` | `websocket` / `webhook`           | websocket recommended — no public URL needed          |
| `renderMode`     | `auto` / `raw` / `card`           | auto detects markdown and uses cards when needed      |
| `dmPolicy`       | `open` / `pairing` / `allowlist`  | pairing = 1:1 session per user                        |
| `groupPolicy`    | `open` / `allowlist` / `disabled` | open = respond in all groups                          |
| `requireMention` | boolean                           | true = only respond when @mentioned in groups         |
| `tools.perm`     | boolean                           | disabled by default — sensitive permission management |

### Connection Modes

- **websocket** (recommended): Long-polling WebSocket. Works behind NAT/firewall, no public URL needed.
- **webhook**: Requires public HTTPS URL configured in Feishu console under Events and Callbacks.

### Render Modes

- **auto**: Detects markdown — uses card for code blocks/tables, plain text otherwise
- **raw**: Always plain text with ASCII table conversion
- **card**: Interactive cards with full markdown rendering

## Available Tools

### Document & Content

| Tool                | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `feishu_doc`        | Read, create, write documents with markdown            |
| `feishu_wiki`       | Navigate wiki spaces, search nodes, create/move/rename |
| `feishu_drive`      | Manage folders and files on Feishu Drive               |
| `feishu_app_scopes` | Diagnostic: check which API permissions the bot has    |
| `feishu_perm`       | Permission management (disabled by default)            |

### Bitable (Spreadsheet Database)

| Tool                           | Description                                            |
| ------------------------------ | ------------------------------------------------------ |
| `feishu_bitable_get_meta`      | Parse Bitable URL → extract `app_token` and `table_id` |
| `feishu_bitable_list_fields`   | List all columns/fields in a table                     |
| `feishu_bitable_list_records`  | List records with optional filter/sort                 |
| `feishu_bitable_get_record`    | Get a single record by ID                              |
| `feishu_bitable_create_record` | Create a new record                                    |
| `feishu_bitable_update_record` | Update an existing record                              |

**No task tools** (`feishu_task_*`) — the community plugin does not include task management.

## Feishu App Setup

### Required Permissions (Scopes)

```
bitable:app, bitable:app:readonly
docx:document, docx:document:readonly, docx:document.block:convert
drive:drive, drive:drive:readonly
im:chat, im:message, im:message:send_as_bot, im:message:readonly
im:message.group_msg, im:message.p2p_msg:readonly
im:resource
task:task:read, task:task:write
wiki:wiki, wiki:wiki:readonly
sheets:spreadsheet
contact:user.base:readonly
```

### Required Event Subscriptions

Configure in Feishu Developer Console → Events and Callbacks:

- `im.message.receive_v1` — **required** for receiving messages
- `im.message.message_read_v1` — read receipts
- `im.chat.member.bot.added_v1` — bot added to group
- `im.chat.member.bot.deleted_v1` — bot removed from group

For WebSocket mode, set subscription mode to "使用长连接接收事件/回调".

### Adding Bot to Group Chats

1. Open group chat → group settings → "机器人"/"Bots" → "添加机器人" → search bot name
2. Set `groupPolicy: "open"` in config (or use `"allowlist"` with specific chat IDs in `groupAllowFrom`)
3. With `requireMention: true`, bot only responds when @mentioned in groups

## Bitable API (Direct)

For creating Bitables programmatically (the plugin only reads/writes records, not creates tables):

```bash
# Get tenant access token
curl -s -X POST "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" \
  -H "Content-Type: application/json" \
  -d '{"app_id":"<APP_ID>","app_secret":"<APP_SECRET>"}'

# Create Bitable
curl -s -X POST "https://open.feishu.cn/open-apis/bitable/v1/apps" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Bitable"}'

# Add field (type: 1=Text, 3=SingleSelect, 5=DateTime, 15=URL, 17=Attachment)
curl -s -X POST "https://open.feishu.cn/open-apis/bitable/v1/apps/<APP_TOKEN>/tables/<TABLE_ID>/fields" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"field_name":"Status","type":3,"property":{"options":[{"name":"New","color":0}]}}'

# Update field (must include type)
curl -s -X PUT ".../fields/<FIELD_ID>" \
  -d '{"field_name":"New Name","type":1}'

# Transfer ownership
curl -s -X POST ".../drive/v1/permissions/<APP_TOKEN>/members?type=bitable" \
  -d '{"member_type":"openid","member_id":"<USER_OPEN_ID>","perm":"full_access"}'
curl -s -X POST ".../drive/v1/permissions/<APP_TOKEN>/members/transfer_owner?type=bitable" \
  -d '{"member_type":"openid","member_id":"<USER_OPEN_ID>"}'
```

### Bitable Field Types

| Type ID | Name         | UI Type      |
| ------- | ------------ | ------------ |
| 1       | Text         | Text         |
| 2       | Number       | Number       |
| 3       | SingleSelect | SingleSelect |
| 4       | MultiSelect  | MultiSelect  |
| 5       | DateTime     | DateTime     |
| 7       | Checkbox     | Checkbox     |
| 11      | User         | User         |
| 15      | URL          | Url          |
| 17      | Attachment   | Attachment   |

## Agent Binding

Route Feishu messages to a specific agent:

```json
{
  "bindings": [
    {
      "agentId": "my-agent",
      "match": {
        "channel": "feishu",
        "accountId": "*"
      }
    }
  ]
}
```

**Critical**: `"accountId": "*"` is required. Without it, only the `"default"` account matches — named accounts like `"main"` silently fail.

## Gotchas & Troubleshooting

### Binding accountId

`"accountId": "*"` must be set in bindings. Without it, the default match is `"default"` which won't match named accounts like `"main"`.

### Duplicate plugin warning

Both built-in (`/app/extensions/feishu/`) and community (`~/.openclaw/extensions/feishu/`) plugins load. Harmless — community tools register first and win. De-duped names (`feishu_doc_2`) from the built-in are unused.

### EROFS error (read-only filesystem)

If `~/.claude` is mounted `:ro` in docker-compose, `claude_code` tool crashes trying to write debug files. Fix: remove `:ro` from the mount.

### Git safe.directory

Mounted repos have different UIDs than the container user (1000). Fix: `git config --global --add safe.directory '*'` inside container, or mount a `.gitconfig` with the wildcard.

### File permissions

Container runs as UID 1000. All workspace files and mounted repos must be owned by 1000:

```bash
sudo chown -R 1000:1000 ~/.openclaw/workspace-*/
sudo chown -R 1000:1000 ~/projects/panpanmao/
```

### NODE_ENV=production

Default Docker image sets `NODE_ENV=production`, causing `pnpm install` to skip devDependencies. Fix: set `NODE_ENV: development` in docker-compose environment.

### Bitable created by bot → user can't see it

Bitables created via tenant access token live in the bot's app space. Users can't see or move them. Fix: transfer ownership using the Drive permissions API with the user's `open_id`.

### Finding user open_id

The `contact:user.id:readonly` scope is needed to look up users by email. If not granted, find the user's open_id from gateway logs after they DM the bot:

```
feishu[default]: received message from ou_XXXX in oc_XXXX (p2p)
```

### Field update requires type

When updating Bitable fields via API, the `type` field is required even if unchanged. Omitting it causes `99992402: field validation failed`.

## Docker Compose Setup

```yaml
services:
  openclaw-gateway:
    environment:
      NODE_ENV: development # allows pnpm install with devDependencies
    volumes:
      - ${HOME}/.claude:/home/node/.claude # NOT :ro — claude_code needs write access
      - ${HOME}/.gitconfig-openclaw:/home/node/.gitconfig:ro # persistent safe.directory
      - ${HOME}/projects:/home/node/projects
```

## References

- Community plugin: https://github.com/m1heng/clawdbot-feishu
- Community plugin wiki (CN): https://github.com/m1heng/clawdbot-feishu/wiki
- Feishu Developer Console: https://open.feishu.cn/app/
- Feishu API docs: https://open.feishu.cn/document/
