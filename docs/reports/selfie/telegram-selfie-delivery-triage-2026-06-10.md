---
summary: "Triage notes for Telegram selfie replies that lost media or duplicated caption text"
read_when:
  - Debugging selfie_generate results that say an image was attached but Telegram shows only text
  - Debugging duplicate Telegram selfie replies where one copy has media and another is text only
  - Investigating generated media paths being dropped before channel delivery
  - Verifying Telegram media dedupe behavior after agent tool results
title: "Telegram selfie delivery triage"
sidebarTitle: "Telegram selfie delivery triage"
---

# Telegram Selfie Delivery Triage - 2026-06-10

## Facts

A Telegram user reported a selfie reply whose caption implied an image had been
attached, but the chat showed only text. The selfie provider did generate an
image and wrote it under the OpenClaw media directory. Gateway logs showed the
agent turn ended with:

```txt
selfie ... OK: <openclaw-config-dir>/media/selfies/<file>.jpeg
telegram outbound send ok ... operation=sendMessage deliveryKind=text
```

There was no matching `operation=sendPhoto` for the successful generation.
Earlier provider failures in the same session, such as
`OutputImageSensitiveContentDetected`, were separate from the delivery bug:
those failures correctly triggered a safer prompt retry.

A follow-up failure showed the opposite edge: Telegram displayed duplicate
assistant text where one copy carried generated media and the other was text
only. Gateway logs around the same turn showed successful selfie generation and
a final text send. Telegram message ids advanced with a missing id between user
and final text messages, which is a useful hint that another media delivery path
also ran even when the high-level outbound log only showed the text send.

## Root Cause

Four delivery invariants were broken at different layers.

First, Telegram non-streaming media dedupe marked media as already sent when a
text-bearing block returned a visible delivery result. That let the final
payload suppress the same media URL even though the visible delivery was only
text. Text-bearing block delivery must not count as media delivery. Only a
media-only block can mark block media as already sent.

Second, plugin-generated local media paths were filtered out before final
delivery. `selfie_generate` is a plugin tool, not a core built-in media tool.
The embedded subscription path was not defaulting the trusted local-media set to
the exact tools registered for the current run, so a legitimate
`message.details.media.mediaUrls` entry like
`<openclaw-config-dir>/media/selfies/<file>.jpeg` could be removed as an
untrusted local path.

A third guard was added for replay safety: assistant-authored `MEDIA:` paths
from old conversation history must not resurrect stale local files unless the
path is also in the current run pending tool-media queue.

A fourth guard was missing at message finalization. For `text_end` channels, the
streaming path can already deliver the caption text and record it in
`lastBlockReplyText`. When `message_end` later sees the same final text with a
current-run `MEDIA:` directive, it still needs to deliver the media, but it must
not send the same caption text again. The old guard skipped duplicate
`message_end` text only when there was no media, so a media-bearing final reply
bypassed the text duplicate guard.

## Impact

The provider succeeded and the session transcript contained a tool result with
structured media, but the channel payload reaching Telegram had no media. The
user saw a natural caption and no photo. Because the final channel log was a
successful `sendMessage`, this failure can look like an image-generation issue
unless the session JSON and outbound operation are inspected together.

The follow-up duplicate bug made the same caption visible twice, once attached
to media and once as a plain text message. That made retries look like model
behavior, but the root cause was delivery finalization replaying text that had
already been streamed.

## Triage Checklist

1. Confirm generation before debugging delivery.

```bash
docker compose logs --since 10m openclaw-gateway \
  | rg "selfie|doubao|gemini|gpt-image|OutputImageSensitiveContentDetected"
```

If the provider returns a content-policy failure, verify whether a safer retry
starts. Do not treat the first provider failure as the delivery root cause when
a later retry succeeds.

2. Confirm Telegram operation type.

```bash
docker compose logs --since 10m openclaw-gateway \
  | rg "sendPhoto|sendMessage|deliveryKind|outbound send"
```

For a successful selfie delivery, expect `operation=sendPhoto`. If only
`operation=sendMessage deliveryKind=text` appears after a successful provider
run, continue to payload inspection.

3. Inspect the session JSON at the nested message level.

The structured media path is under `message.details.media.mediaUrls`, not a
top-level `details` key:

```bash
jq -c '
  select(.message.toolName == "selfie_generate")
  | {
      timestamp,
      isError: .message.isError,
      media: .message.details.media.mediaUrls,
      contentTypes: [.message.content[]?.type]
    }
' <session-file>.jsonl
```

If `media` is present in the tool result but Telegram sends only text, the
failure is downstream of tool execution.

4. Check local-media trust before changing channel code.

Local generated files are intentionally filtered unless the raw tool name is
trusted for the current run. The trusted set must use exact registered tool
names, including plugin tools like `selfie_generate`, and must not let
normalized aliases inherit trust.

5. Check stale media replay behavior.

Assistant-authored local `MEDIA:` directives from history should be stripped
unless they match current pending tool media. This prevents old generated files
from being resent on later turns.

6. Check for text plus media duplication.

When users report two identical replies and one has media, compare the final
caption to `lastBlockReplyText` behavior in the message handler. For
`text_end` channels, final media delivery should preserve the media URL but
clear the duplicate caption if normalized text matches the caption already sent
by the streaming path.

## Fix Applied

- `extensions/telegram/src/bot-message-dispatch.ts`
  - Changed block-media tracking so only media-only block deliveries mark media
    as already sent.
  - Added a regression test where a text-bearing block and final reply share a
    media URL; final delivery must keep the media URL.

- `src/agents/embedded-agent-runner/run/attempt.subscription-cleanup.ts`
  - Defaulted `trustedLocalMediaToolNames` to the current run's registered tool
    names when no explicit trusted set is passed.
  - Added tests proving plugin tools such as `selfie_generate` inherit current
    run trust, while explicit trusted sets still override the default.

- `src/agents/embedded-agent-subscribe.handlers.messages.ts`
  - Filtered replay-sensitive assistant-authored media paths unless they are in
    the current pending tool-media queue.
  - Avoided duplicate delivery when the media was already sent by a messaging
    tool.
  - Preserved final media delivery while clearing duplicate final caption text
    when `text_end` already delivered the same caption.

## Verification Commands

Run targeted tests for the affected surfaces:

```bash
pnpm test extensions/telegram/src/bot-message-dispatch.test.ts -- -t "non-streaming media dedup"
pnpm test src/agents/embedded-agent-subscribe.handlers.messages.test.ts -- -t "keeps final media but omits duplicate text"
pnpm test src/agents/embedded-agent-runner/run/attempt.subscription-cleanup.test.ts
pnpm test src/agents/embedded-agent-subscribe.handlers.tools.media.test.ts \
  src/agents/embedded-agent-subscribe.handlers.messages.test.ts \
  src/agents/embedded-agent-subscribe.handlers.lifecycle.test.ts
```

Run formatting and diff sanity:

```bash
pnpm exec oxfmt --check --threads=1 \
  extensions/telegram/src/bot-message-dispatch.ts \
  extensions/telegram/src/bot-message-dispatch.test.ts \
  src/agents/embedded-agent-runner/run/attempt.subscription-cleanup.ts \
  src/agents/embedded-agent-runner/run/attempt.subscription-cleanup.test.ts \
  src/agents/embedded-agent-subscribe.handlers.messages.ts \
  src/agents/embedded-agent-subscribe.handlers.messages.test.ts

git diff --check -- \
  extensions/telegram/src/bot-message-dispatch.ts \
  extensions/telegram/src/bot-message-dispatch.test.ts \
  src/agents/embedded-agent-runner/run/attempt.subscription-cleanup.ts \
  src/agents/embedded-agent-runner/run/attempt.subscription-cleanup.test.ts \
  src/agents/embedded-agent-subscribe.handlers.messages.ts \
  src/agents/embedded-agent-subscribe.handlers.messages.test.ts
```

For a deployed Gateway, rebuild and restart, then live-verify:

```bash
docker compose build openclaw-gateway openclaw-cli
docker compose up -d openclaw-gateway openclaw-cli
docker compose logs -f --since 30s openclaw-gateway \
  | rg --line-buffered "selfie|sendPhoto|sendMessage|deliveryKind|outbound send|error|failed"
```

After a new selfie request, success means:

```txt
selfie ... OK: <openclaw-config-dir>/media/selfies/<file>.jpeg
telegram outbound send ok ... operation=sendPhoto ...
```

For the duplicate-caption case, success means Telegram does not show the same
caption twice. If media delivery follows a text-end caption, the media-bearing
final payload should be media-only or otherwise omit the already delivered text.

## Lessons

- Do not trust the assistant caption. Prove the channel operation type.
- Do not stop at provider success. Confirm structured media survives into the
  channel payload.
- Read the session JSON at the right nesting level:
  `message.details.media.mediaUrls`.
- Treat local generated media as trusted only when it comes from an exact raw
  tool registered in the current run.
- Keep replay protection strict. Old local `MEDIA:` paths in history are not
  deliverable evidence.
- For `text_end` channels, a final `MEDIA:` directive is not permission to
  replay already streamed caption text. Media and text dedupe are separate
  invariants.
