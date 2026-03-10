#!/bin/bash
# Patch OpenClaw: Telegram auto-chunking + Gemini thinking leak
# Run after every docker compose up/rebuild:
#   bash ~/openclaw/patch-cron-timeout.sh
set -e
CONTAINER="openclaw-openclaw-gateway-1"

# Telegram auto-chunking: split messages > 4000 chars into multiple sends
docker cp /home/x_computelabs_ai/openclaw/patch-telegram-chunking.js "$CONTAINER":/tmp/patch-telegram-chunking.js
docker exec "$CONTAINER" node /tmp/patch-telegram-chunking.js

# Gemini thinking leak: set includeThoughts to false so thinking text isn't delivered
# Runs as root because /app/node_modules is owned by root
docker cp /home/x_computelabs_ai/openclaw/patch-gemini-thinking.js "$CONTAINER":/tmp/patch-gemini-thinking.js
docker exec -u root "$CONTAINER" node /tmp/patch-gemini-thinking.js
