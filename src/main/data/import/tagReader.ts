/**
 * DAT-5: reading a file's embedded tags (title, artist, album, track and disc
 * number, length, and where present mood, genre and comment).
 *
 * Behind an interface so imports and their tests run without a tag library.
 * The real reader is music-metadata (MIT, pure JavaScript), wired in the
 * library's process as `musicMetadataTagReader` (musicMetadata.ts). A file
 * whose tags cannot be read is named after its file (`noTagReader` does the
 * same in tests). Tags fill the file-tag title, artist, album and length;
 * never the game master's own title.
 */
import path from "path";
import { MAX_NAME_LENGTH, MAX_TEXT_LENGTH } from "../validate";

export type EmbeddedTags = {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  /** Length in milliseconds. */
  durationMs?: number | null;
  moods?: string[];
  genres?: string[];
  comment?: string | null;
  /**
   * UX review 3: whether the reader found audio it can measure (a format and a length). False for a file that is
   * not audio whatever its name; left out by a reader that cannot tell (the import then trusts the extension).
   */
  audio?: boolean;
};

/** EmbeddedTags checked and tidied: every field present, text safe to store. */
export type CleanTags = Required<Omit<EmbeddedTags, "audio">>;

export interface TagReader {
  /** The file's tags; rejects when the file cannot be read or parsed. */
  read(filePath: string): Promise<EmbeddedTags>;
}

/** Used until a tag library is added: no tags, so new tracks are named after their files. */
export const noTagReader: TagReader = { read: async () => ({}) };

// Control characters, and (security review 12) the text-direction controls (embeddings, overrides, isolates)
// that can make a name read differently from what it is, e.g. "evil\u202Egnp.mp3" showing as "evilmp3.png".
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

/** Tag text as the library can hold it: control characters dropped, trimmed, shortened to `max`; null when empty. */
export function cleanText(value: unknown, max = MAX_NAME_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(CONTROL, "").replace(/[ \t]+/g, " ").trim();
  if (text === "") return null;
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

const positiveInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : null;

const cleanList = (values: unknown): string[] =>
  Array.isArray(values) ? values.map((value) => cleanText(value)).filter((value): value is string => value !== null) : [];

export function cleanTags(tags: EmbeddedTags): CleanTags {
  const duration = tags.durationMs;
  return {
    title: cleanText(tags.title),
    artist: cleanText(tags.artist),
    album: cleanText(tags.album),
    trackNumber: positiveInteger(tags.trackNumber),
    discNumber: positiveInteger(tags.discNumber),
    durationMs: typeof duration === "number" && Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
    moods: cleanList(tags.moods),
    genres: cleanList(tags.genres),
    comment: cleanText(tags.comment, MAX_TEXT_LENGTH),
  };
}

/**
 * A title from a file name when the file has no title tag, as the prototype
 * does: no extension, no leading track number ("03 ", "1-07 ", "02 - "),
 * underscores as spaces. A name that is only a number keeps it.
 */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  const withoutNumber = base.replace(/^[\d-]+\s*[-.]?\s+/, "").trim();
  return withoutNumber === "" ? base : withoutNumber;
}

/** The parts of music-metadata's result that Lyre reads (versions 7 to 12 share them). */
export type MusicMetadataResult = {
  common: {
    title?: string;
    artist?: string;
    albumartist?: string;
    album?: string;
    track?: { no: number | null; of?: number | null };
    disk?: { no: number | null; of?: number | null };
    genre?: string[];
    mood?: string;
    /** Plain strings before version 10, objects with a text after. */
    comment?: (string | { text?: string })[];
  };
  format: { duration?: number };
};

export type ParseFile = (filePath: string, options: { skipCovers: boolean; duration: boolean }) => Promise<MusicMetadataResult>;

/** The real reader, given music-metadata's `parseFile`. */
export function createMusicMetadataTagReader(parseFile: ParseFile): TagReader {
  return {
    async read(filePath) {
      // duration: work the length out when no header gives it (Ogg Vorbis, MP3 without a Xing header: UX review 7).
      const { common, format } = await parseFile(filePath, { skipCovers: true, duration: true });
      const comments = (common.comment ?? [])
        .map((comment) => (typeof comment === "string" ? comment : comment.text ?? ""))
        .filter((text) => text.trim() !== "");
      const tags = cleanTags({
        title: common.title,
        artist: common.artist ?? common.albumartist,
        album: common.album,
        trackNumber: common.track?.no,
        discNumber: common.disk?.no,
        durationMs: format.duration === undefined ? null : format.duration * 1000,
        moods: common.mood ? [common.mood] : [],
        genres: common.genre ?? [],
        comment: comments.length > 0 ? comments.join("\n") : null,
      });
      // Random bytes named .mp3 still "parse" (as frames of nothing), but have no length (UX review 3).
      return { ...tags, audio: typeof format.duration === "number" && Number.isFinite(format.duration) && format.duration > 0 };
    },
  };
}

/** The file-name part of a path, for either style of path. */
export const baseName = (filePath: string) => (/^[a-zA-Z]:[\\/]|^\\\\/.test(filePath) ? path.win32 : path.posix).basename(filePath);
