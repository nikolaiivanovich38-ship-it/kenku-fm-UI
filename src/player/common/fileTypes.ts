/**
 * Which files Kenku FM accepts for import (BUG-10).
 *
 * Operating systems report MIME types inconsistently (audio/x-m4a,
 * audio/x-flac, audio/x-wav, or an empty string), so a file is accepted when
 * either its MIME type or its file extension is known. This module is the
 * single source of truth for folder drops, single-file drops and the file
 * picker's `accept` attribute.
 */

/** A set of files a drop zone or file picker accepts. */
export type FileTypeRule = {
  /** MIME types accepted exactly (lower case, no parameters). */
  mimeTypes: readonly string[];
  /** Optional MIME prefix accepted as a family, e.g. "image/". */
  mimePrefix?: string;
  /** File extensions accepted, lower case, without the dot. */
  extensions: readonly string[];
  /** Value for an `<input type="file">` accept attribute. */
  accept: string;
};

/** Audio file extensions the player can decode (Chromium media stack). */
export const AUDIO_EXTENSIONS = [
  "mp3",
  "wav",
  "ogg",
  "oga",
  "opus",
  "flac",
  "m4a",
  "aac",
  "webm",
  "weba",
  "mp4",
] as const;

/** MIME types, including common OS-specific aliases, for those formats. */
export const AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/x-mp3",
  "audio/mpeg3",
  "audio/x-mpeg-3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/vnd.wave",
  "audio/ogg",
  "audio/x-ogg",
  "audio/opus",
  "audio/flac",
  "audio/x-flac",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/x-aac",
  "audio/aacp",
  "audio/webm",
] as const;

/** Plain-language list of formats for messages to the user. */
export const AUDIO_FORMATS_LABEL = "MP3, WAV, OGG, OPUS, FLAC, M4A, AAC or WEBM";

/** Audio accepted for tracks and sounds. */
export const audioFileType: FileTypeRule = {
  mimeTypes: AUDIO_MIME_TYPES,
  extensions: AUDIO_EXTENSIONS,
  accept: AUDIO_EXTENSIONS.map((extension) => `.${extension}`).join(","),
};

/** Images accepted for playlist and soundboard backgrounds. */
export const imageFileType: FileTypeRule = {
  mimeTypes: [],
  mimePrefix: "image/",
  extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"],
  accept: "image/*",
};

/**
 * Lower-case extension of a file name or URL path, without the dot, or ""
 * when there is none. Query strings and fragments are ignored.
 */
export function fileExtension(nameOrUrl: string): string {
  const withoutQuery = nameOrUrl.split(/[?#]/)[0];
  const baseName = withoutQuery.split(/[/\\]/).pop() ?? "";
  const dot = baseName.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return baseName.slice(dot + 1).toLowerCase();
}

/** True when the file's MIME type or extension matches the rule. */
export function isAcceptedFile(
  file: { name: string; type: string },
  rule: FileTypeRule
): boolean {
  const mimeType = file.type.split(";")[0].trim().toLowerCase();
  if (mimeType && rule.mimeTypes.includes(mimeType)) {
    return true;
  }
  if (mimeType && rule.mimePrefix && mimeType.startsWith(rule.mimePrefix)) {
    return true;
  }
  return rule.extensions.includes(fileExtension(file.name));
}

/** True for audio the player can import (BUG-10). */
export function isAudioFile(file: { name: string; type: string }): boolean {
  return isAcceptedFile(file, audioFileType);
}

/**
 * True when a URL or path ends in an audio extension, used to warn about
 * sources that may not play. "mpeg" and "3gp" stay accepted here because
 * earlier versions did not warn about them.
 */
export function hasAudioExtension(urlOrPath: string): boolean {
  const extension = fileExtension(urlOrPath);
  return (
    (AUDIO_EXTENSIONS as readonly string[]).includes(extension) ||
    extension === "mpeg" ||
    extension === "3gp"
  );
}

const SYSTEM_FILE_NAMES = ["desktop.ini", "thumbs.db"];

/**
 * True for hidden and OS housekeeping files (".DS_Store", "Thumbs.db") that
 * are skipped silently instead of being reported as "not audio".
 */
export function isSystemFile(name: string): boolean {
  return name.startsWith(".") || SYSTEM_FILE_NAMES.includes(name.toLowerCase());
}
