/**
 * 52: a line in Lyre's log (Help › Save diagnostics, log.txt) when a track does not play as long as the library says:
 * it failed, its file ran out early, or its file is not the length the library has (an MP3 whose header counts too
 * few frames is read as a few seconds long). The line names the track, its file, where it played, where it stopped
 * and why, so a track that "only plays a few seconds" can be told apart from one whose End was moved.
 * Nothing is logged for a track that played as long as the library says, stopped at an End, or was stopped.
 */
import type { VoiceEnding } from "../../engine/voice/voice";

export interface EndingFacts {
  title: string;
  fileName: string;
  /** The track's length in the library, in ms (0: not known). */
  libraryMs: number;
  ending: VoiceEnding;
  /** Where it played, in words: "Table, music" or "preview". */
  where: string;
  /** Decoded into memory, or streamed from its file. */
  sourceKind: "buffer" | "stream" | null;
}

/** A file that ends more than this before the library's length ended early. */
const EARLY_SECONDS = 2;
/** A file whose length differs from the library's by more than this has the wrong length in the library. */
const DIFFERS_SECONDS = 1;

/** "2:28.4": minutes and seconds to a tenth. */
export function clock(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = ((tenths - minutes * 600) / 10).toFixed(1).padStart(4, "0");
  return `${minutes}:${rest}`;
}

/** The log line for how a track finished, or null when there is nothing to say. */
export function endingLine(f: EndingFacts): string | null {
  const { ending } = f;
  const library = f.libraryMs > 0 ? f.libraryMs / 1000 : null;
  const what = `"${f.title}" (${f.fileName}, ${f.sourceKind === "buffer" ? "in memory" : "streamed"}) in ${f.where}`;
  const lengths = `the file says ${ending.fileSeconds === null ? "nothing of its length" : clock(ending.fileSeconds)}, the library has ${library === null ? "no length" : clock(library)}`;
  if (ending.how === "failed") {
    return `Lyre playback: ${what} failed at ${clock(ending.atSeconds)}: ${ending.message ?? "no reason given"}; ${lengths}.`;
  }
  if (ending.how === "stopped" || ending.how === "end") return null;
  if (library !== null && ending.atSeconds < library - EARLY_SECONDS) {
    return `Lyre playback: ${what} ended early, at ${clock(ending.atSeconds)}: the file ran out; ${lengths}.`;
  }
  if (library !== null && ending.fileSeconds !== null && Math.abs(ending.fileSeconds - library) > DIFFERS_SECONDS) {
    return `Lyre playback: ${what} played to the end of its file at ${clock(ending.atSeconds)}; ${lengths}, so the library's length is wrong.`;
  }
  return null;
}
