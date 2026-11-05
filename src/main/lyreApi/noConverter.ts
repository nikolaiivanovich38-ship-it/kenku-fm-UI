/**
 * BUG-10: until ffmpeg is bundled (library request: ffmpeg-static; see ffmpegConverter.ts for how to plug it in),
 * files the player cannot play directly (WMA, AIFF and the like) are answered with plain words instead of a copy.
 */
import type { AudioConverter } from "../media/converter";

export const CANNOT_CONVERT_YET = "Lyre cannot convert this kind of file yet. Convert it to MP3, OGG, FLAC or WAV and add it again.";

export const noConverter: AudioConverter = {
  isLossless: async () => false,
  convert: async () => {
    throw new Error(CANNOT_CONVERT_YET);
  },
};
