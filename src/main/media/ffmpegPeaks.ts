/**
 * Loudness peaks with ffmpeg (w3-media): the PeakReader the library's process uses (data/peaks.ts PeakJobs).
 *
 * ffmpeg decodes the file in its own process, at below-normal priority and on one thread, and sends it to Lyre as
 * mono 16-bit samples at 8,000 a second (plenty for peaks, and an hour is only 58 MB through the pipe); Lyre keeps
 * the loudest sample per block as the chunks arrive (peakLevels.ts), so this process only ever does a moment's work.
 *
 * Safety, as for the converter (ffmpegConverter.ts): no shell, each argument passed as it is, plain files only
 * (`-protocol_whitelist file`, the path prefixed `file:` so no name is read as another protocol), the first audio
 * stream only, and nothing written anywhere: the samples come back through the pipe. Stopped when cancelled or
 * after `timeoutMs`.
 */
import { spawn as nodeSpawn } from "child_process";
import os from "os";

import { baseName } from "../data/import/tagReader";
import type { PeakReader } from "../data/peaks";
import { PeakLevels } from "./peakLevels";

/** Samples a second ffmpeg sends: enough to catch every peak a wave of 1,000 points shows. */
export const PEAK_SAMPLE_RATE = 8000;
/** Ten minutes, as the converter: an hour-long file decodes in seconds. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MAX_STDERR = 16_000;

type Listener<T> = (value: T) => void;
/** The parts of a child process used here. */
export interface PeakProcess {
  readonly pid?: number;
  readonly stdout: { on(event: "data", listener: Listener<Uint8Array>): unknown } | null;
  readonly stderr: { on(event: "data", listener: Listener<Uint8Array | string>): unknown } | null;
  on(event: "close", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  kill(): boolean;
}

export type PeakSpawn = (
  command: string,
  args: string[],
  options: { shell: false; windowsHide: true; stdio: ["ignore", "pipe", "pipe"] },
) => PeakProcess;

/** Arguments that decode the first audio stream of `input` to mono 16-bit samples on ffmpeg's output pipe. */
export function peakArgs(input: string): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-threads",
    "1",
    "-protocol_whitelist",
    "file",
    "-i",
    `file:${input}`,
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-ac",
    "1",
    "-ar",
    String(PEAK_SAMPLE_RATE),
    "-f",
    "s16le",
    "-c:a",
    "pcm_s16le",
    "pipe:1",
  ];
}

/** Background work gives way to Lyre's own processes and the game master's other programs. */
function belowNormal(pid: number): void {
  try {
    os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // Not allowed on this system: it still works, only at normal priority.
  }
}

export class FfmpegPeakReader implements PeakReader {
  private readonly ffmpegPath: string;
  private readonly spawn: PeakSpawn;
  private readonly timeoutMs: number;
  private readonly lowerPriority: (pid: number) => void;

  constructor(options: { ffmpegPath: string; spawn?: PeakSpawn; timeoutMs?: number; lowerPriority?: (pid: number) => void }) {
    this.ffmpegPath = options.ffmpegPath;
    this.spawn = options.spawn ?? (nodeSpawn as unknown as PeakSpawn);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.lowerPriority = options.lowerPriority ?? belowNormal;
  }

  read(file: string, signal: AbortSignal): Promise<Uint8Array> {
    const failure = (detail: string) => new Error(`Could not work out the loudness of ${baseName(file)}${detail ? ` (${detail})` : ""}`);
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(failure("cancelled"));
        return;
      }
      const child = this.spawn(this.ffmpegPath, peakArgs(file), { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      if (child.pid !== undefined) this.lowerPriority(child.pid);
      const levels = new PeakLevels();
      let stderr = "";
      let reason: string | null = null;
      const stop = (why: string) => {
        reason ??= why;
        child.kill();
      };
      const onAbort = () => stop("cancelled");
      const timer = setTimeout(() => stop("it took too long"), this.timeoutMs);
      signal.addEventListener("abort", onAbort);
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      child.stdout?.on("data", (chunk) => {
        if (reason === null) levels.add(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-MAX_STDERR);
      });
      child.on("error", (error) => {
        finish();
        reject(failure(error.message));
      });
      child.on("close", (code) => {
        finish();
        if (reason) return reject(failure(reason));
        if (code !== 0) return reject(failure(stderr.trim().split(/\r?\n/).pop() ?? ""));
        try {
          resolve(levels.finish());
        } catch (error) {
          reject(failure((error as Error).message));
        }
      });
    });
  }
}
