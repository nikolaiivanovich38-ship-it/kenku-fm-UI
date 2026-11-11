/**
 * BUG-10: used only when the bundled ffmpeg is missing (a damaged install; see media/bundledFfmpeg.ts). Files the
 * player cannot play directly (WMA, AIFF and the like) are then answered with plain words instead of a copy.
 */
import type { AudioConverter } from "../media/converter";

export const CONVERTER_MISSING =
  "Lyre cannot find its converter, so it cannot play this kind of file. Reinstall Lyre, or convert the file to MP3, OGG, FLAC or WAV and add it again.";

export const noConverter: AudioConverter = {
  isLossless: async () => false,
  convert: async () => {
    throw new Error(CONVERTER_MISSING);
  },
};
