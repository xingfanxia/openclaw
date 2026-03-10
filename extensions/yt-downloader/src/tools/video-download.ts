import { execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../../../../src/agents/tools/common.js";
import { uploadFileFromPath } from "../../../drive-manager/src/drive-client.js";
import type { OAuthConfig, AccountConfig, YtDownloaderConfig } from "../types.js";
import { resolveAccountId } from "../types.js";

const execFileAsync = promisify(execFile);

const FORMAT_MAP: Record<string, string> = {
  best: "bestvideo+bestaudio/best",
  "1080p": "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
  "720p": "bestvideo[height<=720]+bestaudio/best[height<=720]",
  "480p": "bestvideo[height<=480]+bestaudio/best[height<=480]",
};

const MIME_MAP: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".flv": "video/x-flv",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".opus": "audio/opus",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

function getBaseArgs(config: YtDownloaderConfig): string[] {
  const args = ["--js-runtimes", "node"];
  const cookiesPath = config.cookiesFile ?? path.join(os.homedir(), ".openclaw", "cookies.txt");
  if (fs.existsSync(cookiesPath)) {
    args.push("--cookies", cookiesPath);
  }
  return args;
}

export function createVideoDownloadTool(
  oauthConfig: OAuthConfig,
  accounts: AccountConfig[],
  config: YtDownloaderConfig,
): AnyAgentTool {
  return {
    name: "video_download",
    description:
      "Download a video from YouTube, Bilibili, or other supported sites using yt-dlp, then upload it to Google Drive. " +
      "Supports quality selection and audio-only extraction. " +
      "Requires a cookies.txt file at ~/.openclaw/cookies.txt for age-restricted or authenticated content.",
    parameters: Type.Object({
      url: Type.String({
        description: "Video URL to download (YouTube, Bilibili, Twitter, etc.)",
      }),
      quality: Type.Optional(
        Type.String({
          description: 'Video quality: "best" (default), "1080p", "720p", "480p"',
          default: "best",
        }),
      ),
      audio_only: Type.Optional(
        Type.Boolean({
          description: "Extract audio only as MP3. Default: false",
          default: false,
        }),
      ),
      folder_id: Type.Optional(
        Type.String({
          description: "Google Drive folder ID to upload into. If omitted, uploads to root.",
        }),
      ),
      account_id: Type.Optional(
        Type.String({
          description: "Google account ID or alias for Drive upload. If omitted, uses default.",
        }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        url: string;
        quality?: string;
        audio_only?: boolean;
        folder_id?: string;
        account_id?: string;
      },
    ) => {
      const accountId = resolveAccountId(params.account_id, config);
      if (!accountId) {
        const result = {
          error: "No account specified and no default account configured.",
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      const account = accounts.find((a) => a.id === accountId);
      if (!account) {
        const result = {
          error: `Account "${accountId}" not found. Available: ${accounts.map((a) => a.id).join(", ")}`,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      const tmpDir = path.join(os.tmpdir(), `yt-dlp-${crypto.randomBytes(6).toString("hex")}`);

      try {
        fs.mkdirSync(tmpDir, { recursive: true });

        // Step 1: Get video metadata
        const cookiesArgs = getBaseArgs(config);
        const metaArgs = [
          "--print",
          "%(title)s",
          "--print",
          "%(duration)s",
          "--print",
          "%(ext)s",
          ...cookiesArgs,
          "--no-download",
          params.url,
        ];

        const metaResult = await execFileAsync("yt-dlp", metaArgs, {
          timeout: 30_000,
        });
        const metaLines = metaResult.stdout.trim().split("\n");
        const videoTitle = metaLines[0] ?? "unknown";
        const duration = metaLines[1] ?? "unknown";

        // Step 2: Download the video
        const quality = params.quality ?? "best";
        const audioOnly = params.audio_only ?? false;

        const outputTemplate = path.join(tmpDir, "%(title)s.%(ext)s");
        const downloadArgs: string[] = [
          "-o",
          outputTemplate,
          "--no-playlist",
          "--merge-output-format",
          "mp4",
          ...cookiesArgs,
        ];

        if (audioOnly) {
          downloadArgs.push("-x", "--audio-format", "mp3");
        } else {
          const formatStr = FORMAT_MAP[quality] ?? FORMAT_MAP["best"];
          downloadArgs.push("-f", formatStr);
        }

        downloadArgs.push(params.url);

        await execFileAsync("yt-dlp", downloadArgs, {
          timeout: 600_000, // 10 minute timeout for large downloads
        });

        // Step 3: Find the downloaded file
        const files = fs.readdirSync(tmpDir);
        if (files.length === 0) {
          throw new Error("yt-dlp completed but no file was produced");
        }

        const downloadedFile = path.join(tmpDir, files[0]);
        const stat = fs.statSync(downloadedFile);
        const fileSizeMB = (stat.size / (1024 * 1024)).toFixed(1);
        const mimeType = getMimeType(downloadedFile);
        const fileName = files[0];

        // Step 4: Upload to Google Drive
        const driveFile = await uploadFileFromPath(
          oauthConfig,
          accountId,
          downloadedFile,
          fileName,
          mimeType,
          params.folder_id,
        );

        const result = {
          success: true,
          video: {
            title: videoTitle,
            duration: duration,
            fileName: fileName,
            sizeMB: fileSizeMB,
            quality: audioOnly ? "audio-only" : quality,
          },
          drive: {
            fileId: driveFile.id,
            fileName: driveFile.name,
            webViewLink: driveFile.webViewLink,
            webContentLink: driveFile.webContentLink,
            account: account.email,
          },
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const result = { error: `Video download failed: ${message}` };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } finally {
        // Clean up temp directory
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    },
  } as AnyAgentTool;
}
