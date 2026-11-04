/**
 * BUG-10: which audio files the player plays itself and which are converted.
 *
 * Chromium (Lyre's player) plays FLAC, MP3, WAV, Ogg (Vorbis, Opus, FLAC),
 * M4A/AAC and WebM. Everything in CONVERTED is converted once, in the
 * background, to a cached copy: FLAC when the source is lossless, Opus when
 * it is not (see mediaCache.ts). Anything else is played as it is, and the
 * player reports in plain words if it cannot.
 */
import nodePath from "path";

/** "lossless": always lossless; "lossy": never; "check": ask the converter (WMA may be WMA Lossless). */
export type Conversion = "lossless" | "lossy" | "check";

const CONVERTED: Record<string, Conversion> = {
  ".wma": "check",
  ".asf": "check",
  ".mka": "check",
  ".aif": "lossless",
  ".aiff": "lossless",
  ".aifc": "check",
  ".ape": "lossless",
  ".wv": "lossless",
  ".tta": "lossless",
  ".ac3": "lossy",
  ".mpc": "lossy",
};

/** How a file must be converted before the player can play it, or null when it plays as it is. */
export function conversionOf(filePath: string): Conversion | null {
  return CONVERTED[nodePath.extname(filePath).toLowerCase()] ?? null;
}

const LOSSY_CODECS = new Set(["wmav1", "wmav2", "wmapro", "wmavoice", "mp1", "mp2", "mp3", "aac", "vorbis", "opus", "ac3", "eac3", "dts", "musepack7", "musepack8", "cook", "ra_144", "ra_288", "atrac3", "atrac3p"]);

/** Whether ffmpeg's codec name is a lossy one. Codecs in neither list are treated as lossless, to keep every detail. */
export function isLossyCodec(codec: string): boolean {
  return LOSSY_CODECS.has(codec);
}
