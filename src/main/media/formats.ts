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

/**
 * Security review 7: ffmpeg's reader (demuxer) for each audio extension Lyre adds (src/main/data/import/audioFiles.ts),
 * named with `-f` so ffmpeg never picks a reader from the file's content: a playlist or a list of other files named
 * ".wma" is then read as WMA, and refused, instead of being followed to files outside the library.
 */
const DEMUXERS: Record<string, string> = {
  ".flac": "flac",
  ".mp3": "mp3",
  ".wav": "wav",
  ".ogg": "ogg",
  ".oga": "ogg",
  ".opus": "ogg",
  ".m4a": "mov",
  ".aac": "aac",
  ".wma": "asf",
  ".asf": "asf",
  ".aif": "aiff",
  ".aiff": "aiff",
  ".aifc": "aiff",
  ".mka": "matroska",
  ".ape": "ape",
  ".wv": "wv",
  ".tta": "tta",
  ".ac3": "ac3",
};

/**
 * The input arguments that fix ffmpeg's reader for `filePath`, or null when Lyre knows none for its extension (the
 * file is then not given to ffmpeg at all). Musepack has a reader per stream version: only those two are allowed.
 */
export function demuxerArgs(filePath: string): string[] | null {
  const extension = nodePath.extname(filePath).toLowerCase();
  if (extension === ".mpc") return ["-format_whitelist", "mpc,mpc8"];
  return Object.prototype.hasOwnProperty.call(DEMUXERS, extension) ? ["-f", DEMUXERS[extension]] : null;
}
