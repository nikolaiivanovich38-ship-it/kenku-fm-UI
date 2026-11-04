/**
 * BUG-10: the decoder Lyre converts unsupported formats with, behind an
 * interface so the cache can be tested without it (testing/fakeConverter.ts)
 * and so the real one (ffmpegConverter.ts) can be swapped.
 */

/** FLAC for lossless sources; Opus in Ogg (192 kbit/s) for lossy ones. */
export type ConvertTarget = "flac" | "opus";

export interface ConvertJob {
  /** The source file (its real path, inside a library folder). */
  input: string;
  /** Where to write: always a part file inside Lyre's cache folder. */
  output: string;
  target: ConvertTarget;
  signal: AbortSignal;
}

export interface AudioConverter {
  /** Whether the audio in `input` is stored without loss (WMA can be either). */
  isLossless(input: string, signal: AbortSignal): Promise<boolean>;
  /** Write `job.input` converted to `job.output`; rejects with a plain message on failure. */
  convert(job: ConvertJob): Promise<void>;
}

/** The file extension of a converted copy. */
export const TARGET_EXTENSION: Record<ConvertTarget, string> = { flac: ".flac", opus: ".ogg" };
