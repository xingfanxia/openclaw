import type { MediaUnderstandingProvider } from "openclaw/plugin-sdk/media-understanding";
import { transcribeVolcengineAudio } from "./audio.js";

export const volcengineMediaUnderstandingProvider: MediaUnderstandingProvider = {
  id: "volcengine",
  capabilities: ["audio"],
  transcribeAudio: transcribeVolcengineAudio,
};
