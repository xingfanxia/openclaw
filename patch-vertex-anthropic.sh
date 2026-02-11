#!/bin/bash
# Patch: Force vertex-anthropic provider support for cold-start primary model.
#
# Patches applied:
# 1. model-selection: Register vertex-anthropic streaming at module load
# 2. model-selection: Sanitize tool IDs for Vertex AI compliance
# 3. model-selection: Strip cross-model thinking block signatures
# 4. reply bundle: Use correct api type for vertex-anthropic inline models
# 5. reply bundle: Use correct api type for vertex-anthropic provider fallback
#
# Re-apply after: docker compose down/up, docker build
# Survives: docker compose restart, SIGHUP

set -euo pipefail

CONTAINER="openclaw-openclaw-gateway-1"
TMPDIR="/tmp/openclaw-vertex-patch"
mkdir -p "$TMPDIR"

echo "=== Vertex-Anthropic Startup Patch ==="

# ── Patch 1 & 2: model-selection bundle ──
BUNDLE1="/app/dist/model-selection-D_mQehFF.js"
TMP1="$TMPDIR/model-selection.js"

echo "[1/2] Patching model-selection bundle..."
docker cp "$CONTAINER:$BUNDLE1" "$TMP1"

CHANGED1=0

# 1a. Streaming registration at module load
if ! grep -q "VERTEX_ANTHROPIC_STARTUP_PATCH" "$TMP1"; then
    EXPORT_LINE=$(grep -n '^export {' "$TMP1" | tail -1 | cut -d: -f1)
    if [ -z "$EXPORT_LINE" ]; then
        echo "  ERROR: Could not find export line"
        exit 1
    fi
    head -n $((EXPORT_LINE - 1)) "$TMP1" > "${TMP1}.new"
    cat >> "${TMP1}.new" << 'PATCH_EOF'

/* VERTEX_ANTHROPIC_STARTUP_PATCH: Force registration at module load */
try {
  if (isVertexAnthropicAvailable()) {
    registerVertexAnthropicApi();
    console.log("[vertex-anthropic-patch] Streaming provider registered at startup");
  }
} catch (e) {
  console.warn("[vertex-anthropic-patch] Registration failed:", e.message);
}
PATCH_EOF
    tail -n +"$EXPORT_LINE" "$TMP1" >> "${TMP1}.new"
    mv "${TMP1}.new" "$TMP1"
    CHANGED1=1
    echo "  [1a] Streaming registration: applied."
else
    echo "  [1a] Streaming registration: already patched."
fi

# 1b. Tool ID sanitizer function + patching
if ! grep -q "VERTEX_TOOL_ID_SANITIZE_PATCH" "$TMP1"; then
    # Inject sanitize function before streamVertexAnthropic
    STREAM_LINE=$(grep -n 'const streamVertexAnthropic' "$TMP1" | head -1 | cut -d: -f1)
    if [ -n "$STREAM_LINE" ]; then
        head -n $((STREAM_LINE - 1)) "$TMP1" > "${TMP1}.new"
        cat >> "${TMP1}.new" << 'SANITIZE_EOF'

/* VERTEX_TOOL_ID_SANITIZE_PATCH: Sanitize tool IDs for Vertex AI compliance */
function sanitizeToolId(id) {
  if (!id) return id;
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}
SANITIZE_EOF
        tail -n +"$STREAM_LINE" "$TMP1" >> "${TMP1}.new"
        mv "${TMP1}.new" "$TMP1"
    fi

    # Patch tool_use id
    sed -i 's/id: block\.id,/id: sanitizeToolId(block.id),/' "$TMP1"
    # Patch tool_result tool_use_id
    sed -i 's/tool_use_id: msg\.toolCallId,/tool_use_id: sanitizeToolId(msg.toolCallId),/g' "$TMP1"
    sed -i 's/tool_use_id: next\.toolCallId,/tool_use_id: sanitizeToolId(next.toolCallId),/g' "$TMP1"

    CHANGED1=1
    echo "  [1b] Tool ID sanitizer: applied."
else
    echo "  [1b] Tool ID sanitizer: already patched."
fi

# 1c. Strip cross-model thinking block signatures
if ! grep -q "VERTEX_DROP_THINKING_BLOCKS" "$TMP1"; then
    # Convert thinking blocks with signatures to plain text
    # Vertex AI rejects thinking signatures from other models (GPT/Codex)
    # Original pattern: type: "thinking", thinking: block.thinking, signature: block.thinkingSignature
    python3 -c "
import re
with open('$TMP1') as f:
    content = f.read()
# Replace the thinking return block - convert to text
old = '''return {
								type: \"thinking\",
								thinking: block.thinking,
								signature: block.thinkingSignature
							};'''
new = '''return {
								type: \"text\", /* VERTEX_DROP_THINKING_BLOCKS */
								text: block.thinking
							};'''
if old in content:
    content = content.replace(old, new, 1)
    with open('$TMP1', 'w') as f:
        f.write(content)
    print('replaced')
else:
    print('pattern-not-found')
"
    CHANGED1=1
    echo "  [1c] Thinking block strip: applied."
else
    echo "  [1c] Thinking block strip: already patched."
fi

if [ "$CHANGED1" -eq 1 ]; then
    docker cp "$TMP1" "$CONTAINER:$BUNDLE1"
    echo "  Model-selection bundle updated."
fi

# ── Patch 4 & 5: reply bundle ──
BUNDLE2="/app/dist/reply-BHlTJvrR.js"
TMP2="$TMPDIR/reply.js"

echo "[2/2] Patching reply bundle..."
docker cp "$CONTAINER:$BUNDLE2" "$TMP2"

CHANGED2=0

# 3. Inline model api injection
if ! grep -q "VERTEX_INLINE_API_PATCH" "$TMP2"; then
    sed -i 's|api: model\.api ?? entry?\.api|api: model.api \|\| entry?.api \|\| (trimmed === "vertex-anthropic" ? "vertex-anthropic" : undefined) /* VERTEX_INLINE_API_PATCH */|' "$TMP2"
    if grep -q "VERTEX_INLINE_API_PATCH" "$TMP2"; then
        CHANGED2=1
        echo "  [2a] Inline model api: applied."
    else
        echo "  [2a] WARNING: Inline model sed failed."
    fi
else
    echo "  [2a] Inline model api: already patched."
fi

# 4. Provider fallback api
if ! grep -q "VERTEX_API_FALLBACK_PATCH" "$TMP2"; then
    sed -i 's|api: providerCfg?.api ?? "openai-responses"|api: providerCfg?.api \|\| (provider === "vertex-anthropic" ? "vertex-anthropic" : "openai-responses") /* VERTEX_API_FALLBACK_PATCH */|' "$TMP2"
    if grep -q "VERTEX_API_FALLBACK_PATCH" "$TMP2"; then
        CHANGED2=1
        echo "  [2b] Provider fallback api: applied."
    else
        echo "  [2b] WARNING: Provider fallback sed failed."
    fi
else
    echo "  [2b] Provider fallback api: already patched."
fi

if [ "$CHANGED2" -eq 1 ]; then
    docker cp "$TMP2" "$CONTAINER:$BUNDLE2"
    echo "  Reply bundle updated."
fi

# ── Restart ──
echo "Restarting gateway..."
docker exec "$CONTAINER" kill -SIGHUP 1

echo ""
# ── Fix workspace permissions ──
echo "Fixing workspace permissions..."
docker exec -u root "$CONTAINER" chown -R node:node /home/node/.openclaw/workspace/ 2>/dev/null || true

echo "=== Patch complete! ==="
echo "Verify: docker logs --since 15s $CONTAINER 2>&1 | grep -E 'vertex|agent model|listening'"

rm -rf "$TMPDIR"
