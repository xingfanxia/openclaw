#!/bin/bash
# Fix UID mismatch between host (GCE OS Login UID 166404411) and container (node:1000)
# Run this after docker compose up/restart, or via cron

CONTAINER="openclaw-openclaw-gateway-1"

# Check if container is running
if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
    exit 0
fi

# Fix permissions inside container as root
docker exec -u root "$CONTAINER" sh -c '
    chown -R node:node /home/node/.openclaw/workspace 2>/dev/null
    chown -R node:node /home/node/.openclaw/media 2>/dev/null
    mkdir -p /home/node/.openclaw/media
    chown node:node /home/node/.openclaw/media
' 2>/dev/null

# Fix permissions on host side
sudo chown -R $(whoami):$(whoami) ~/.openclaw/workspace ~/.openclaw/media 2>/dev/null
