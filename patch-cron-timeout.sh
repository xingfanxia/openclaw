#!/bin/bash
# Patch OpenClaw for cron jobs + Telegram auto-chunking
# Run after every docker compose up/rebuild:
#   bash ~/openclaw/patch-cron-timeout.sh
set -e
CONTAINER="openclaw-openclaw-gateway-1"

# 1. Cron tool timeout: 60s -> 300s (inside agent session)
docker exec "$CONTAINER" sed -i \
  's/timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : 6e4/timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : 3e5/g' \
  /app/dist/reply-L7QaxXzW.js \
  /app/dist/loader-XhrFClh9.js \
  /app/dist/extensionAPI.js
echo "[patch] Cron tool timeout set to 300s (5min)"

# 2. Gateway call default timeout: 10s -> 120s (WebSocket connection)
docker exec "$CONTAINER" sed -i \
  's/opts.timeoutMs : 1e4/opts.timeoutMs : 12e4/g' \
  /app/dist/call-D2nostnG.js \
  /app/dist/call-DQd_2G45.js
echo "[patch] Gateway call timeout set to 120s"

# 3. Gateway CLI default timeout: 30s -> 120s (RPC response wait)
docker exec "$CONTAINER" sed -i \
  's/p.timeoutMs)) : 3e4/p.timeoutMs)) : 12e4/g' \
  /app/dist/gateway-cli-BCHAva1l.js \
  /app/dist/gateway-cli-DBZhiuhA.js
echo "[patch] Gateway CLI timeout set to 120s"

# 4. Telegram auto-chunking: split messages > 4000 chars into multiple sends
docker cp /home/x_computelabs_ai/openclaw/patch-telegram-chunking.js "$CONTAINER":/tmp/patch-telegram-chunking.js
docker exec "$CONTAINER" node /tmp/patch-telegram-chunking.js
