#!/bin/bash
# Patch: Sanitize tool_use IDs for Vertex AI Anthropic API.
#
# Vertex AI rejects tool_use.id values that don't match ^[a-zA-Z0-9_-]+$
# (e.g., IDs from GPT/Codex models may contain dots, colons, etc.)
#
# This patch injects a sanitization function into the vertex-anthropic
# streaming code in the model-selection bundle.

set -euo pipefail

CONTAINER="openclaw-openclaw-gateway-1"
TMPDIR="/tmp/openclaw-toolid-patch"
mkdir -p "$TMPDIR"

echo "=== Vertex Tool ID Sanitizer Patch ==="

BUNDLE="/app/dist/model-selection-D_mQehFF.js"
TMP="$TMPDIR/model-selection.js"

docker cp "$CONTAINER:$BUNDLE" "$TMP"

if grep -q "VERTEX_TOOL_ID_SANITIZE_PATCH" "$TMP"; then
    echo "Already patched."
    rm -rf "$TMPDIR"
    exit 0
fi

# Strategy: Add a sanitize function and apply it to all tool_use.id and tool_use_id references
# in the vertex-anthropic streaming code.

# 1. Inject sanitize function before the streamVertexAnthropic function
STREAM_LINE=$(grep -n 'const streamVertexAnthropic' "$TMP" | head -1 | cut -d: -f1)
if [ -z "$STREAM_LINE" ]; then
    echo "ERROR: Could not find streamVertexAnthropic"
    exit 1
fi

head -n $((STREAM_LINE - 1)) "$TMP" > "${TMP}.new"
cat >> "${TMP}.new" << 'SANITIZE_EOF'

/* VERTEX_TOOL_ID_SANITIZE_PATCH: Sanitize tool IDs for Vertex AI compliance */
function sanitizeToolId(id) {
  if (!id) return id;
  // Replace any character not matching [a-zA-Z0-9_-] with underscore
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}
SANITIZE_EOF
tail -n +"$STREAM_LINE" "$TMP" >> "${TMP}.new"
mv "${TMP}.new" "$TMP"

# 2. Patch tool_use id: block.id → sanitizeToolId(block.id)
sed -i 's|type: "tool_use",\n\t\t\t\t\t\t\tid: block\.id,|type: "tool_use",\n\t\t\t\t\t\t\tid: sanitizeToolId(block.id),|' "$TMP"

# Try single-line version (minified code might be on one line)
sed -i 's|id: block\.id,\(\s*\)name: block\.name|id: sanitizeToolId(block.id),\1name: block.name|' "$TMP"

# 3. Patch tool_result tool_use_id: msg.toolCallId → sanitizeToolId(msg.toolCallId)
sed -i 's|tool_use_id: msg\.toolCallId,|tool_use_id: sanitizeToolId(msg.toolCallId),|g' "$TMP"
sed -i 's|tool_use_id: next\.toolCallId,|tool_use_id: sanitizeToolId(next.toolCallId),|g' "$TMP"

# Verify patches applied
PATCHED=0
if grep -q 'sanitizeToolId(block.id)' "$TMP"; then
    echo "  tool_use.id sanitized."
    PATCHED=1
fi
if grep -q 'sanitizeToolId(msg.toolCallId)' "$TMP"; then
    echo "  tool_result.tool_use_id (msg) sanitized."
    PATCHED=1
fi
if grep -q 'sanitizeToolId(next.toolCallId)' "$TMP"; then
    echo "  tool_result.tool_use_id (next) sanitized."
    PATCHED=1
fi

if [ "$PATCHED" -eq 0 ]; then
    echo "WARNING: No patterns matched! Checking file..."
    grep -n 'block\.id' "$TMP" | grep 'tool_use' | head -5
    exit 1
fi

docker cp "$TMP" "$CONTAINER:$BUNDLE"
echo "Bundle patched and copied back."

# Restart
echo "Restarting gateway..."
docker exec "$CONTAINER" kill -SIGHUP 1

echo "=== Done ==="
rm -rf "$TMPDIR"
