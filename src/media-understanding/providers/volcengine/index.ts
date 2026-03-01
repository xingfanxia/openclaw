import type { MediaUnderstandingProvider } from "../../types.js";
import { transcribeVolcengineAudio } from "./audio.js";

export const volcengineProvider: MediaUnderstandingProvider = {
  id: "volcengine",
  capabilities: ["audio"],
  transcribeAudio: transcribeVolcengineAudio,
};
