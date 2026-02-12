#!/bin/bash
# Patch OpenClaw for cron jobs + Telegram auto-chunking
# Run after every docker compose up/rebuild:
#   bash ~/openclaw/patch-cron-timeout.sh
set -e
CONTAINER="openclaw-openclaw-gateway-1"

# 1. Cron tool timeout: 60s -> 300s (inside agent session)
# Find files dynamically instead of hardcoding hashed filenames
CRON_FILES=$(docker exec "$CONTAINER" grep -rl "timeoutMs: typeof params.timeoutMs === \"number\" ? params.timeoutMs : 6e4" /app/dist/ 2>/dev/null || true)
if [ -n "$CRON_FILES" ]; then
  docker exec "$CONTAINER" sed -i \
    's/timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : 6e4/timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : 3e5/g' \
    $CRON_FILES
  echo "[patch] Cron tool timeout set to 300s (5min) in: $(echo $CRON_FILES | tr '\n' ' ')"
else
  echo "[patch] Cron tool timeout pattern not found (already patched or changed)"
fi

# 2. Gateway call default timeout: 10s -> 120s (WebSocket connection)
CALL_FILES=$(docker exec "$CONTAINER" grep -rl "opts.timeoutMs : 1e4" /app/dist/ 2>/dev/null || true)
if [ -n "$CALL_FILES" ]; then
  docker exec "$CONTAINER" sed -i \
    's/opts.timeoutMs : 1e4/opts.timeoutMs : 12e4/g' \
    $CALL_FILES
  echo "[patch] Gateway call timeout set to 120s in: $(echo $CALL_FILES | tr '\n' ' ')"
else
  echo "[patch] Gateway call timeout pattern not found (already patched or changed)"
fi

# 3. Gateway CLI default timeout: 30s -> 120s (RPC response wait)
CLI_FILES=$(docker exec "$CONTAINER" grep -rl "p.timeoutMs)) : 3e4" /app/dist/ 2>/dev/null || true)
if [ -n "$CLI_FILES" ]; then
  docker exec "$CONTAINER" sed -i \
    's/p.timeoutMs)) : 3e4/p.timeoutMs)) : 12e4/g' \
    $CLI_FILES
  echo "[patch] Gateway CLI timeout set to 120s in: $(echo $CLI_FILES | tr '\n' ' ')"
else
  echo "[patch] Gateway CLI timeout pattern not found (already patched or changed)"
fi

# 4. Telegram auto-chunking: split messages > 4000 chars into multiple sends
docker cp /home/x_computelabs_ai/openclaw/patch-telegram-chunking.js "$CONTAINER":/tmp/patch-telegram-chunking.js
docker exec "$CONTAINER" node /tmp/patch-telegram-chunking.js
