---
summary: "Text-to-speech (TTS) for outbound replies"
read_when:
  - Enabling text-to-speech for replies
  - Configuring TTS providers or limits
  - Using /tts commands
title: "Text-to-Speech"
---

# Text-to-speech (TTS)

OpenClaw can convert outbound replies into audio using ElevenLabs, OpenAI, Edge TTS, Volcano Engine, or Fish Audio.
It works anywhere OpenClaw can send audio; Telegram gets a round voice-note bubble.

## Supported services

- **ElevenLabs** (primary or fallback provider)
- **OpenAI** (primary or fallback provider; also used for summaries)
- **Edge TTS** (primary or fallback provider; uses `node-edge-tts`, default when no API keys)
- **Volcano Engine** (v1 standard TTS, v2 with LLM-driven emotion control via `seed-tts-2.0`)
- **Fish Audio** (OGG/Opus voice bubbles)

### Edge TTS notes

Edge TTS uses Microsoft Edge's online neural TTS service via the `node-edge-tts`
library. It's a hosted service (not local), uses Microsoft’s endpoints, and does
not require an API key. `node-edge-tts` exposes speech configuration options and
output formats, but not all options are supported by the Edge service. citeturn2search0

Because Edge TTS is a public web service without a published SLA or quota, treat it
as best-effort. If you need guaranteed limits and support, use OpenAI or ElevenLabs.
Microsoft's Speech REST API documents a 10‑minute audio limit per request; Edge TTS
does not publish limits, so assume similar or lower limits. citeturn0search3

## Optional keys

If you want OpenAI or ElevenLabs:

- `ELEVENLABS_API_KEY` (or `XI_API_KEY`)
- `OPENAI_API_KEY`

Edge TTS does **not** require an API key. If no API keys are found, OpenClaw defaults
to Edge TTS (unless disabled via `messages.tts.edge.enabled=false`).

If multiple providers are configured, the selected provider is used first and the others are fallback options.
Auto-summary uses the configured `summaryModel` (or `agents.defaults.model.primary`),
so that provider must also be authenticated if you enable summaries.

## Service links

- [OpenAI Text-to-Speech guide](https://platform.openai.com/docs/guides/text-to-speech)
- [OpenAI Audio API reference](https://platform.openai.com/docs/api-reference/audio)
- [ElevenLabs Text to Speech](https://elevenlabs.io/docs/api-reference/text-to-speech)
- [ElevenLabs Authentication](https://elevenlabs.io/docs/api-reference/authentication)
- [node-edge-tts](https://github.com/SchneeHertz/node-edge-tts)
- [Microsoft Speech output formats](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#audio-outputs)

## Is it enabled by default?

No. Auto‑TTS is **off** by default. Enable it in config with
`messages.tts.auto` or per session with `/tts always` (alias: `/tts on`).

Edge TTS **is** enabled by default once TTS is on, and is used automatically
when no OpenAI or ElevenLabs API keys are available.

## Config

TTS config lives under `messages.tts` in `openclaw.json`.
Full schema is in [Gateway configuration](/gateway/configuration).

### Minimal config (enable + provider)

```json5
{
  messages: {
    tts: {
      auto: "always",
      provider: "elevenlabs",
    },
  },
}
```

### OpenAI primary with ElevenLabs fallback

```json5
{
  messages: {
    tts: {
      auto: "always",
      provider: "openai",
      summaryModel: "openai/gpt-4.1-mini",
      modelOverrides: {
        enabled: true,
      },
      openai: {
        apiKey: "openai_api_key",
        model: "gpt-4o-mini-tts",
        voice: "alloy",
      },
      elevenlabs: {
        apiKey: "elevenlabs_api_key",
        baseUrl: "https://api.elevenlabs.io",
        voiceId: "voice_id",
        modelId: "eleven_multilingual_v2",
        seed: 42,
        applyTextNormalization: "auto",
        languageCode: "en",
        voiceSettings: {
          stability: 0.5,
          similarityBoost: 0.75,
          style: 0.0,
          useSpeakerBoost: true,
          speed: 1.0,
        },
      },
    },
  },
}
```

### Edge TTS primary (no API key)

```json5
{
  messages: {
    tts: {
      auto: "always",
      provider: "edge",
      edge: {
        enabled: true,
        voice: "en-US-MichelleNeural",
        lang: "en-US",
        outputFormat: "audio-24khz-48kbitrate-mono-mp3",
        rate: "+10%",
        pitch: "-5%",
      },
    },
  },
}
```

### Disable Edge TTS

```json5
{
  messages: {
    tts: {
      edge: {
        enabled: false,
      },
    },
  },
}
```

### Custom limits + prefs path

```json5
{
  messages: {
    tts: {
      auto: "always",
      maxTextLength: 4000,
      timeoutMs: 30000,
      prefsPath: "~/.openclaw/settings/tts.json",
    },
  },
}
```

### Only reply with audio after an inbound voice note

```json5
{
  messages: {
    tts: {
      auto: "inbound",
    },
  },
}
```

### Disable auto-summary for long replies

```json5
{
  messages: {
    tts: {
      auto: "always",
    },
  },
}
```

Then run:

```
/tts summary off
```

### Notes on fields

- `auto`: auto‑TTS mode (`off`, `always`, `inbound`, `tagged`).
  - `inbound` only sends audio after an inbound voice note.
  - `tagged` only sends audio when the reply includes `[[tts]]` tags.
- `enabled`: legacy toggle (doctor migrates this to `auto`).
- `mode`: `"final"` (default) or `"all"` (includes tool/block replies).
- `provider`: `"elevenlabs"`, `"openai"`, `"edge"`, `"volcano"`, or `"fishaudio"` (fallback is automatic).
- If `provider` is **unset**, OpenClaw prefers `openai` (if key), then `elevenlabs` (if key),
  otherwise `edge`.
- `summaryModel`: optional cheap model for auto-summary; defaults to `agents.defaults.model.primary`.
  - Accepts `provider/model` or a configured model alias.
- `modelOverrides`: allow the model to emit TTS directives (on by default).
  - `allowProvider` defaults to `false` (provider switching is opt-in).
- `maxTextLength`: hard cap for TTS input (chars). `/tts audio` fails if exceeded.
- `timeoutMs`: request timeout (ms).
- `prefsPath`: override the local prefs JSON path (provider/limit/summary).
- `apiKey` values fall back to env vars (`ELEVENLABS_API_KEY`/`XI_API_KEY`, `OPENAI_API_KEY`).
- `elevenlabs.baseUrl`: override ElevenLabs API base URL.
- `elevenlabs.voiceSettings`:
  - `stability`, `similarityBoost`, `style`: `0..1`
  - `useSpeakerBoost`: `true|false`
  - `speed`: `0.5..2.0` (1.0 = normal)
- `elevenlabs.applyTextNormalization`: `auto|on|off`
- `elevenlabs.languageCode`: 2-letter ISO 639-1 (e.g. `en`, `de`)
- `elevenlabs.seed`: integer `0..4294967295` (best-effort determinism)
- `edge.enabled`: allow Edge TTS usage (default `true`; no API key).
- `edge.voice`: Edge neural voice name (e.g. `en-US-MichelleNeural`).
- `edge.lang`: language code (e.g. `en-US`).
- `edge.outputFormat`: Edge output format (e.g. `audio-24khz-48kbitrate-mono-mp3`).
  - See Microsoft Speech output formats for valid values; not all formats are supported by Edge.
- `edge.rate` / `edge.pitch` / `edge.volume`: percent strings (e.g. `+10%`, `-5%`).
- `edge.saveSubtitles`: write JSON subtitles alongside the audio file.
- `edge.proxy`: proxy URL for Edge TTS requests.
- `edge.timeoutMs`: request timeout override (ms).

## Model-driven overrides (default on)

By default, the model **can** emit TTS directives for a single reply.
When `messages.tts.auto` is `tagged`, these directives are required to trigger audio.

When enabled, the model can emit `[[tts:...]]` directives to override the voice
for a single reply, plus an optional `[[tts:text]]...[[/tts:text]]` block to
provide expressive tags (laughter, singing cues, etc) that should only appear in
the audio.

`provider=...` directives are ignored unless `modelOverrides.allowProvider: true`.

Example reply payload:

```
Here you go.

[[tts:voiceId=pMsXgVXv3BLzUgSXRplE model=eleven_v3 speed=1.1]]
[[tts:text]](laughs) Read the song once more.[[/tts:text]]
```

Available directive keys (when enabled):

- `provider` (`openai` | `elevenlabs` | `edge`, requires `allowProvider: true`)
- `voice` (OpenAI voice) or `voiceId` (ElevenLabs)
- `model` (OpenAI TTS model or ElevenLabs model id)
- `stability`, `similarityBoost`, `style`, `speed`, `useSpeakerBoost`
- `applyTextNormalization` (`auto|on|off`)
- `languageCode` (ISO 639-1)
- `seed`

Disable all model overrides:

```json5
{
  messages: {
    tts: {
      modelOverrides: {
        enabled: false,
      },
    },
  },
}
```

Optional allowlist (enable provider switching while keeping other knobs configurable):

```json5
{
  messages: {
    tts: {
      modelOverrides: {
        enabled: true,
        allowProvider: true,
        allowSeed: false,
      },
    },
  },
}
```

## Per-user preferences

Slash commands write local overrides to `prefsPath` (default:
`~/.openclaw/settings/tts.json`, override with `OPENCLAW_TTS_PREFS` or
`messages.tts.prefsPath`).

Stored fields:

- `enabled`
- `provider`
- `maxLength` (summary threshold; default 1500 chars)
- `summarize` (default `true`)

These override `messages.tts.*` for that host.

## Output formats (fixed)

- **Telegram**: Opus voice note (`opus_48000_64` from ElevenLabs, `opus` from OpenAI).
  - 48kHz / 64kbps is a good voice-note tradeoff and required for the round bubble.
- **Other channels**: MP3 (`mp3_44100_128` from ElevenLabs, `mp3` from OpenAI).
  - 44.1kHz / 128kbps is the default balance for speech clarity.
- **Edge TTS**: uses `edge.outputFormat` (default `audio-24khz-48kbitrate-mono-mp3`).
  - `node-edge-tts` accepts an `outputFormat`, but not all formats are available
    from the Edge service. citeturn2search0
  - Output format values follow Microsoft Speech output formats (including Ogg/WebM Opus). citeturn1search0
  - Telegram `sendVoice` accepts OGG/MP3/M4A; use OpenAI/ElevenLabs if you need
    guaranteed Opus voice notes. citeturn1search1
  - If the configured Edge output format fails, OpenClaw retries with MP3.

OpenAI/ElevenLabs formats are fixed; Telegram expects Opus for voice-note UX.

## Auto-TTS behavior

When enabled, OpenClaw:

- skips TTS if the reply already contains media or a `MEDIA:` directive.
- skips very short replies (< 10 chars).
- summarizes long replies when enabled using `agents.defaults.model.primary` (or `summaryModel`).
- attaches the generated audio to the reply.

If the reply exceeds `maxLength` and summary is off (or no API key for the
summary model), audio
is skipped and the normal text reply is sent.

## Flow diagram

```
Reply -> TTS enabled?
  no  -> send text
  yes -> has media / MEDIA: / short?
          yes -> send text
          no  -> length > limit?
                   no  -> TTS -> attach audio
                   yes -> summary enabled?
                            no  -> send text
                            yes -> summarize (summaryModel or agents.defaults.model.primary)
                                      -> TTS -> attach audio
```

## Slash command usage

There is a single command: `/tts`.
See [Slash commands](/tools/slash-commands) for enablement details.

Discord note: `/tts` is a built-in Discord command, so OpenClaw registers
`/voice` as the native command there. Text `/tts ...` still works.

```
/tts off
/tts always
/tts inbound
/tts tagged
/tts status
/tts provider openai
/tts limit 2000
/tts summary off
/tts audio Hello from OpenClaw
```

Notes:

- Commands require an authorized sender (allowlist/owner rules still apply).
- `commands.text` or native command registration must be enabled.
- `off|always|inbound|tagged` are per‑session toggles (`/tts on` is an alias for `/tts always`).
- `limit` and `summary` are stored in local prefs, not the main config.
- `/tts audio` generates a one-off audio reply (does not toggle TTS on).

## Agent tool

The `tts` tool converts text to speech and returns a `MEDIA:` path. When the
result is Telegram-compatible, the tool includes `[[audio_as_voice]]` so
Telegram sends a voice bubble.

## Gateway RPC

Gateway methods:

- `tts.status`
- `tts.enable`
- `tts.disable`
- `tts.convert`
- `tts.setProvider`
- `tts.providers`

## Fish Audio setup guide

Fish Audio outputs OGG/Opus — ideal for Telegram voice bubbles without transcoding.

### Step-by-step setup

**Step 1.** Create an account at [fish.audio](https://fish.audio) and get an API key from the dashboard.

**Step 2.** Pick a voice model — browse the [voice library](https://fish.audio/voices) or clone your own. Copy the reference ID.

**Step 3.** Add to `openclaw.json`:

```json5
{
  messages: {
    tts: {
      auto: "always", // or "tagged" (LLM decides when to voice) / "inbound" (voice replies only)
      provider: "fishaudio",
      fishaudio: {
        apiKey: "your-fish-audio-api-key", // or set env FISH_API_KEY
        referenceId: "your-voice-reference-id", // from fish.audio voice library
      },
    },
  },
}
```

**Step 4.** Restart the gateway (or `kill -USR1` for hot reload).

**Step 5.** Verify: send `/tts status` — should show `Provider: fishaudio (configured)`. Test with `/tts audio 你好`.

### Config fields

| Field         | Env fallback   | Description                                              |
| ------------- | -------------- | -------------------------------------------------------- |
| `apiKey`      | `FISH_API_KEY` | Fish Audio API key                                       |
| `referenceId` | —              | Voice model ID from fish.audio (leave empty for default) |

### Gotchas

- Fish Audio does **not** support emotion markers like Volcano v2. `[brackets]` will be spoken literally.
- Output is OGG/Opus — Telegram shows it as a voice bubble automatically (`voiceCompatible: true`).
- If `referenceId` is empty, Fish Audio uses its default voice.

### API details

```
POST https://api.fish.audio/v1/tts
Headers: Authorization: Bearer <apiKey>, model: s1
Body: { "text": "...", "reference_id": "...", "format": "opus", "opus_bitrate": 64 }
```

Returns raw Opus audio buffer. Output file is `.ogg` — Telegram sends it as a voice bubble.

### Code pointers

| What               | File                            | Line    | Notes                                                                                                     |
| ------------------ | ------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| API call           | `src/tts/tts-core.ts`           | 721-757 | `fishAudioTTS()` — POST to fish.audio, returns `Buffer`                                                   |
| Config resolution  | `src/tts/tts.ts`                | 385-388 | `fishaudio.apiKey` falls back to `FISH_API_KEY` env                                                       |
| Provider detection | `src/tts/tts.ts`                | 659-661 | `isTtsProviderConfigured()` checks `fishaudio.apiKey`                                                     |
| TTS execution      | `src/tts/tts.ts`                | 772-802 | Fish Audio path in `textToSpeech()` — calls `fishAudioTTS()`, writes `.ogg`, sets `voiceCompatible: true` |
| Schema             | `src/config/zod-schema.core.ts` | 253-259 | `fishaudio: { apiKey, referenceId }`                                                                      |
| Type               | `src/config/types.tts.ts`       | 86-89   | `fishaudio?: { apiKey?: string; referenceId?: string }`                                                   |

### Verification

```
/tts status
```

Expected: `Provider: fishaudio (configured)`. Test with `/tts audio 你好`.

---

## Volcano Engine v2 setup guide (Emotion Control)

Volcano Engine v2 uses the `seed-tts-2.0` voice cloning model with LLM-driven emotion control
via the `context_texts` API parameter. The LLM prepends `[emotion]` markers before each sentence,
OpenClaw parses them, calls the API per-sentence with individual emotion instructions, then
concatenates the MP3 buffers into a single voice message.

### Step-by-step setup

**Step 1.** Create a Volcengine account at [console.volcengine.com](https://console.volcengine.com).

**Step 2.** Enable the TTS service ("语音合成"). Get your **App ID** and **Access Token** from the console.

**Step 3.** (Recommended) Clone a voice in the Volcano console. Note the speaker ID — it starts with `S_` (e.g. `S_EVeoGUVU1`). Without a cloned voice, use a built-in speaker like `zh_female_linzhiling_mars_bigtts`.

**Step 4.** Add to `openclaw.json`:

```json5
{
  messages: {
    tts: {
      auto: "tagged", // "tagged" = LLM decides when to voice; "always" = every reply
      provider: "volcano",
      volcano: {
        appId: "your-app-id", // or set env VOLC_TTS_APP_ID
        accessKey: "your-access-key", // or set env VOLC_TTS_ACCESS_TOKEN
        version: "v2", // REQUIRED for emotion control
        speaker: "S_EVeoGUVU1", // your cloned voice ID
        // resourceId auto-defaults to "volc.seedicl.default" for v2
      },
    },
  },
}
```

**Step 5.** Restart the gateway (or `kill -USR1` for hot reload).

**Step 6.** Verify: send `/tts status` — should show `Provider: volcano v2 (configured)`. Test with `/tts audio [开心]你好呀！`.

### Config fields

| Field        | Env fallback            | Default                                               | Description                                                                                                                      |
| ------------ | ----------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `appId`      | `VOLC_TTS_APP_ID`       | —                                                     | Volcano application ID                                                                                                           |
| `accessKey`  | `VOLC_TTS_ACCESS_TOKEN` | —                                                     | Volcano access token                                                                                                             |
| `version`    | —                       | `"v1"`                                                | **Must be `"v2"`** for emotion control                                                                                           |
| `resourceId` | —                       | `"volc.seedicl.default"` (v2) / `"seed-tts-1.0"` (v1) | Model resource. Auto-detected: if ID contains `seedicl`/`seed-tts-2.0`/`seed-icl-2.0`, v2 activates even without `version: "v2"` |
| `speaker`    | —                       | `"zh_female_linzhiling_mars_bigtts"`                  | Speaker or cloned voice ID. For cloned voices use the `S_` prefixed ID from Volcano console                                      |

### Gotchas

- **`version: "v2"` is required.** Without it, you get v1 behavior (no emotion, no voice bubble).
- **`context_texts` only affects the first sentence per API call.** This is why OpenClaw splits into per-sentence calls. If you send a multi-sentence text as one call, only the first sentence gets emotion.
- **`[bracket]` markers must NOT be stripped before TTS.** The code explicitly preserves them for v2 (`stripActionMarkers()` at `tts.ts:1048` skips stripping when v2 is active). They are only stripped from the visible text shown to the user.
- **MP3 output is voice-compatible on Telegram.** v2 sets `voiceCompatible: true` so Telegram renders it as a round voice bubble, not a document attachment.
- **Session model overrides can persist.** If the agent model was changed per-session (e.g. via `/model`), it persists in `sessions.json` and survives config reloads. Clear it manually or restart the gateway.
- **Duplicate voice messages** can occur if the LLM sees the audio file path and re-sends it via the message tool. The TTS tool returns "Audio delivered. Do not re-send." (line 56) and the MEDIA file path is hidden from the LLM to prevent this.

### How emotion control works

**The key insight**: `context_texts` only affects the **first sentence** per API call. So to get
per-sentence emotion variation, OpenClaw splits text into segments and calls the API once per segment.

1. System prompt (`buildTtsSystemPromptHint()` at `tts.ts:469`) tells the LLM to prepend `[emotion]` markers
2. LLM generates: `[开心]你好呀！[伤心]我好难过。`
3. `parseVolcanoEmotionSegments()` at `tts.ts:94` splits into segments:
   - `{ contextText: "开心", text: "你好呀！" }`
   - `{ contextText: "伤心", text: "我好难过。" }`
4. Each segment calls `volcanoTTS()` with `contextTexts: ["开心"]` (at `tts-core.ts:650`)
5. API receives `additions: '{"context_texts":["开心"]}'` in `req_params` (at `tts-core.ts:675`)
6. MP3 buffers are concatenated: `Buffer.concat(chunks)` (at `tts.ts:837`)
7. Result: single voice bubble on Telegram with emotion variation per sentence
8. `[markers]` are stripped from visible text (`stripEmotionMarkers()` at `tts.ts:81`) — user sees clean text

### Emotion marker syntax

The LLM uses three styles (all passed to `context_texts`):

**Emotion labels** (short keywords):

```
[开心]你好呀！今天天气真好！
[伤心]可是我的猫生病了。
[愤怒]这太过分了！
```

**Voice commands** (descriptive instructions):

```
[用温柔甜蜜的声音]晚安，好梦。
[用冷淡不耐烦的语气]随便你吧。
[用激动兴奋的声音]我们赢了！
```

**Context descriptions** (scene narration):

```
[她正在生气地质问对方]你到底去哪儿了？
[他刚收到好消息非常开心]太好了，我通过了！
```

### API details

Endpoint (same for v1 and v2):

```
POST https://openspeech.bytedance.com/api/v3/tts/unidirectional
```

Request body per segment:

```json
{
  "user": { "uid": "openclaw-tts" },
  "req_params": {
    "text": "你好呀！今天天气真好！",
    "speaker": "S_EVeoGUVU1",
    "audio_params": { "format": "mp3", "sample_rate": 24000 },
    "additions": "{\"context_texts\":[\"开心\"]}"
  }
}
```

Response: streaming binary MP3 chunks (parsed from JSON-framed response, base64 `data` field).

### Differences from v1

|                       | v1                             | v2                                       |
| --------------------- | ------------------------------ | ---------------------------------------- |
| Resource ID           | `seed-tts-1.0`                 | `volc.seedicl.default`                   |
| Emotion control       | None                           | `context_texts` per sentence             |
| Output                | Single audio, no emotion       | Concatenated segments with emotion       |
| Telegram voice bubble | No (MP3, not voice-compatible) | Yes (`voiceCompatible: true`)            |
| Marker stripping      | `[brackets]` stripped          | Stripped from display, preserved for TTS |

### Code pointers

#### Config and schema

| What            | File                            | Line    | Notes                                                         |
| --------------- | ------------------------------- | ------- | ------------------------------------------------------------- |
| Type definition | `src/config/types.tts.ts`       | 83      | `version?: "v1" \| "v2"` field on volcano config              |
| Zod schema      | `src/config/zod-schema.core.ts` | 243-252 | `volcano: { appId, accessKey, resourceId, speaker, version }` |

#### Core TTS functions (`src/tts/tts.ts`)

| Function                        | Line             | Purpose                                                                                          |
| ------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `isVolcanoV2()`                 | 70               | Detects v2 by `version: "v2"` or resourceId patterns (`seedicl`, `seed-tts-2.0`, `seed-icl-2.0`) |
| `stripEmotionMarkers()`         | 81               | Strips `[bracket]` markers from visible text: `text.replace(/\[[^\]]+\]/g, "")`                  |
| `parseVolcanoEmotionSegments()` | 94               | Parses `[emotion]text` into `Array<{ contextText?: string; text: string }>`                      |
| `resolveTtsConfig()`            | 323 (380)        | Defaults `resourceId` to `"volc.seedicl.default"` for v2; env fallbacks for `appId`/`accessKey`  |
| `buildTtsSystemPromptHint()`    | 433 (469-481)    | Injects v2 emotion instructions into system prompt                                               |
| `textToSpeech()`                | 673 (814-837)    | **V2 path**: parse segments → call `volcanoTTS()` per segment → `Buffer.concat()`                |
| `stripActionMarkers()`          | 1048             | Skips stripping for v2 — `[bracket]` markers must survive for emotion parsing                    |
| `maybeApplyTtsToPayload()`      | 1081 (1113-1116) | Strips emotion markers from visible text for v2                                                  |

#### Volcano API call (`src/tts/tts-core.ts`)

| What                      | Line    | Notes                                                                        |
| ------------------------- | ------- | ---------------------------------------------------------------------------- |
| `volcanoTTS()` params     | 643-651 | Accepts `contextTexts?: string[]`                                            |
| `context_texts` injection | 675-677 | `additions: JSON.stringify({ context_texts: contextTexts })` in `req_params` |

#### Agent TTS tool (`src/agents/tools/tts-tool.ts`)

| What                           | Line  | Notes                                                                       |
| ------------------------------ | ----- | --------------------------------------------------------------------------- |
| `[[audio_as_voice]]` directive | 41    | Voice bubble directive when result is voice-compatible                      |
| `MEDIA:` directive             | 43    | Framework-only delivery — LLM does not see the file path                    |
| Display text for v2            | 48-49 | Strips emotion markers so LLM knows what was spoken                         |
| Anti-duplicate                 | 56    | "Audio delivered. Do not re-send." prevents LLM re-sending via message tool |

#### Tool result delivery pipeline

| What                | File                                           | Line          | Notes                                                             |
| ------------------- | ---------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| `onToolResult` type | `src/agents/pi-embedded-subscribe.types.ts`    | 19            | `audioAsVoice?: boolean` in payload                               |
| `emitToolOutput()`  | `src/agents/pi-embedded-subscribe.ts`          | 341, 349, 358 | Extracts and passes `audioAsVoice` through to `onToolResult`      |
| Dispatch callback   | `src/auto-reply/reply/dispatch-from-config.ts` | 342           | Receives `ReplyPayload` with `audioAsVoice`, sends via dispatcher |

#### System prompt and slash commands

| What                    | File                                   | Line    | Notes                                      |
| ----------------------- | -------------------------------------- | ------- | ------------------------------------------ |
| V2 emotion instructions | `src/tts/tts.ts`                       | 469-481 | Injected into system prompt when v2 active |
| `/tts status` v2 label  | `src/auto-reply/reply/commands-tts.ts` | 265-266 | Shows `"volcano v2"` as provider           |

### Data flow (end to end)

```
LLM generates: "[开心]你好呀！[伤心]我好难过。"
       |
       v
buildTtsSystemPromptHint() — told LLM to use [brackets]    (tts.ts:469)
       |
       v
maybeApplyTtsToPayload() — strips [markers] from visible    (tts.ts:1113)
       |                    text, keeps them for TTS input
       v
textToSpeech() — detects v2, enters v2 path                 (tts.ts:814)
       |
       v
parseVolcanoEmotionSegments() — splits into segments         (tts.ts:94)
       |    segment 1: { contextText: "开心", text: "你好呀！" }
       |    segment 2: { contextText: "伤心", text: "我好难过。" }
       v
volcanoTTS() x N — calls API per segment with contextTexts   (tts-core.ts:650)
       |    POST .../api/v3/tts/unidirectional
       |    req_params.additions = {"context_texts":["开心"]}
       v
Buffer.concat(chunks) — merges MP3 buffers into one file     (tts.ts:837)
       |
       v
Single voice bubble on Telegram (audioAsVoice: true)
User sees: "你好呀！我好难过。" (no brackets)
```

### Verification

```
/tts status
```

Expected: `Provider: volcano v2 (configured)`. Test with `/tts audio [开心]你好呀！`.

### Troubleshooting

- **No audio, no error**: Check `appId` and `accessKey` are set. Verify with `/tts status`.
- **Audio but no emotion**: Confirm `version: "v2"` is set. Check `/tts status` shows `volcano v2` not just `volcano`.
- **`[brackets]` showing in text**: `stripEmotionMarkers()` should strip them. Verify the v2 path is active in `maybeApplyTtsToPayload()` (line 1113).
- **Voice sent as document, not voice bubble**: Check `audioAsVoice` flows through `emitToolOutput()` (line 358) and `onToolResult` type includes it (line 19 of types file).
- **Duplicate voice messages**: The TTS tool should return "Audio delivered. Do not re-send." (line 56) to prevent the LLM from re-sending via message tool. Check the tool description includes `SILENT_REPLY_TOKEN`.

### Limitations

- `context_texts` only affects the first sentence per API call — hence per-sentence splitting.
- Very short segments (< 10 chars after stripping) are skipped.
- If all segments fail, the reply falls back to text-only.
- Emotion quality depends on the cloned voice model and the emotion instruction quality.
