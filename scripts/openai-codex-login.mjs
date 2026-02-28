#!/usr/bin/env node
import { writeFileSync, readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
/**
 * OpenAI Codex OAuth Login
 *
 * Authenticates with your ChatGPT subscription (Plus/Pro/Team) to use
 * GPT models through OpenClaw without per-token API billing.
 *
 * Usage:
 *   node scripts/openai-codex-login.mjs          # Interactive login
 *   node scripts/openai-codex-login.mjs --check   # Check if token is valid
 *
 * After login, set your model to: openai-codex/gpt-5.3-codex
 */
import { loginOpenAICodex, refreshOpenAICodexToken } from "@mariozechner/pi-ai";

const PROFILE_ID = "openai-codex:default";
const profilesPath = join(homedir(), ".openclaw", "auth-profiles.json");

function loadProfiles() {
  if (!existsSync(profilesPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(profilesPath, "utf-8"));
  } catch {
    return {};
  }
}

function saveProfile(creds) {
  const profiles = loadProfiles();
  if (!profiles.profiles) {
    profiles.profiles = {};
  }
  profiles.profiles[PROFILE_ID] = {
    provider: "openai-codex",
    mode: "oauth",
    ...creds,
  };
  writeFileSync(profilesPath, JSON.stringify(profiles, null, 2) + "\n");
}

// --check mode: verify existing token
if (process.argv.includes("--check")) {
  const profiles = loadProfiles();
  const profile = profiles?.profiles?.[PROFILE_ID];
  if (!profile) {
    console.log("No OpenAI Codex credentials found. Run without --check to login.");
    process.exit(1);
  }
  console.log("Found OpenAI Codex profile.");
  if (profile.refreshToken) {
    console.log("Refresh token present. Attempting refresh...");
    try {
      const refreshed = await refreshOpenAICodexToken(profile.refreshToken);
      if (refreshed) {
        saveProfile(refreshed);
        console.log("Token refreshed successfully.");
        process.exit(0);
      }
    } catch (err) {
      console.error("Refresh failed:", err.message);
      console.log("Run without --check to re-authenticate.");
      process.exit(1);
    }
  }
  console.log("Token looks valid.");
  process.exit(0);
}

// Interactive login
console.log("OpenAI Codex OAuth Login");
console.log("========================");
console.log("This uses your ChatGPT subscription (not API billing).\n");

try {
  const creds = await loginOpenAICodex({
    onAuth: ({ url }) => {
      console.log("1. Open this URL in your browser:\n");
      console.log(url);
      console.log("\n2. Sign in with your OpenAI account");
      console.log("3. The browser will redirect to localhost:1455 (which will fail)");
      console.log("4. Copy the full URL from the address bar and paste it below\n");
    },
    onManualCodeInput: async () => {
      const { createInterface } = await import("readline");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      return new Promise((resolve) => {
        rl.question("Paste callback URL > ", (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });
    },
    onProgress: (msg) => console.log("  " + msg),
  });

  if (creds) {
    saveProfile(creds);
    console.log("\nAuthenticated successfully!");
    console.log("Saved to:", profilesPath);
    console.log("\nYou can now use: openai-codex/gpt-5.3-codex");
    console.log("To set as fallback in openclaw.json:");
    console.log('  "fallbacks": ["openai-codex/gpt-5.3-codex"]');
  } else {
    console.error("\nNo credentials returned. Please try again.");
    process.exit(1);
  }
} catch (err) {
  console.error("\nLogin failed:", err.message);
  process.exit(1);
}
