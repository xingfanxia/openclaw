/**
 * Quick smoke test for the Doubao (Volcengine) Seed ASR STT integration.
 *
 * Usage:
 *   bun scripts/test-doubao-stt.ts <audio-file>
 *
 * Reads credentials from env vars (DOUBAO_STT_APP_ID, DOUBAO_STT_ACCESS_KEY)
 * or falls back to the openclaw.json volcengine audio config.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const SUBMIT_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit";
const QUERY_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query";
const RESOURCE_ID = "volc.seedasr.auc";

// Resolve credentials: env vars first, then openclaw.json
function resolveCredentials(): { appId: string; accessKey: string } {
  if (process.env.DOUBAO_STT_APP_ID && process.env.DOUBAO_STT_ACCESS_KEY) {
    return {
      appId: process.env.DOUBAO_STT_APP_ID,
      accessKey: process.env.DOUBAO_STT_ACCESS_KEY,
    };
  }
  // Fall back to openclaw.json
  try {
    const home = process.env.HOME ?? "/home/xingfanxia";
    const cfg = JSON.parse(readFileSync(path.join(home, ".openclaw/openclaw.json"), "utf8"));
    const audioModels = cfg?.tools?.media?.audio?.models ?? [];
    const volcEntry = audioModels.find((m: Record<string, unknown>) => m.provider === "volcengine");
    if (volcEntry?.headers) {
      return {
        appId: volcEntry.headers["X-Api-App-Id"] ?? "",
        accessKey:
          volcEntry.headers["X-Api-Access-Key"] ?? cfg?.models?.providers?.volcengine?.apiKey ?? "",
      };
    }
  } catch {}
  throw new Error(
    "No Doubao STT credentials found (set DOUBAO_STT_APP_ID + DOUBAO_STT_ACCESS_KEY)",
  );
}

function mimeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ogg": "ogg",
    ".opus": "ogg",
    ".mp3": "mp3",
    ".wav": "wav",
    ".m4a": "m4a",
    ".mp4": "m4a",
  };
  return map[ext] ?? "mp3";
}

async function main() {
  const audioFile = process.argv[2];
  if (!audioFile) {
    console.error("Usage: bun scripts/test-doubao-stt.ts <audio-file>");
    process.exit(1);
  }

  const { appId, accessKey } = resolveCredentials();
  console.log(`App ID: ${appId}`);
  console.log(`Access Key: ${accessKey.slice(0, 6)}...`);

  const audioBuffer = readFileSync(audioFile);
  const audioBase64 = audioBuffer.toString("base64");
  const format = mimeFromExt(audioFile);
  const reqId = randomUUID();

  console.log(`\nFile: ${audioFile} (${audioBuffer.length} bytes, format: ${format})`);
  console.log(`Request ID: ${reqId}`);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-App-Key": appId,
    "X-Api-Access-Key": accessKey,
    "X-Api-Resource-Id": RESOURCE_ID,
    "X-Api-Request-Id": reqId,
    "X-Api-Sequence": "-1",
  };

  // Step 1: Submit
  console.log("\n--- Submit ---");
  const submitRes = await fetch(SUBMIT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      user: { uid: "openclaw-test" },
      audio: { data: audioBase64, format },
      request: { model_name: "bigmodel", enable_itn: true, enable_punc: true },
    }),
  });

  const submitStatus = submitRes.headers.get("X-Api-Status-Code");
  const submitMessage = submitRes.headers.get("X-Api-Message");
  const submitBody = await submitRes.text();
  console.log(`HTTP ${submitRes.status}`);
  console.log(`X-Api-Status-Code: ${submitStatus}`);
  console.log(`X-Api-Message: ${submitMessage}`);
  console.log(`Body: ${submitBody.slice(0, 200)}`);

  if (submitRes.status !== 200 || (submitStatus && submitStatus !== "20000000")) {
    console.error("\nSubmit failed!");
    process.exit(1);
  }

  // Step 2: Poll
  console.log("\n--- Polling ---");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const queryRes = await fetch(QUERY_URL, {
      method: "POST",
      headers,
      body: "{}",
    });
    const queryStatus = queryRes.headers.get("X-Api-Status-Code");
    const body = await queryRes.text();
    console.log(`Poll ${i + 1}: status=${queryStatus} body=${body.slice(0, 200)}`);

    if (body && body !== "{}") {
      const parsed = JSON.parse(body);
      if (parsed.result?.text) {
        console.log(`\n=== Transcription ===\n${parsed.result.text}`);
        if (parsed.audio_info?.duration) {
          console.log(`Duration: ${parsed.audio_info.duration}ms`);
        }
        process.exit(0);
      }
    }
  }

  console.error("\nTimed out after 60s");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
