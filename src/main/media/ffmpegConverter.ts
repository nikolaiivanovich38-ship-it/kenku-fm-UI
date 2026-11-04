/**
 * BUG-10: the real converter, running an ffmpeg program in its own process.
 *
 * ffmpeg is not bundled yet: the library request in the wave 2 report asks
 * for ffmpeg-static, which ships a ready-made ffmpeg.exe (GPL-3.0, like
 * Lyre), so no build step runs on our side. To plug it in (main process):
 *
 *   import ffmpegPath from "ffmpeg-static";
 *   const converter = new FfmpegConverter({ ffmpegPath: ffmpegPath.replace("app.asar", "app.asar.unpacked") });
 *
 * with ffmpeg-static unpacked from the asar archive in forge.config.js.
 *
 * Safety: ffmpeg runs without a shell, with each argument passed as it is;
 * it may read and write plain files only (`-protocol_whitelist file`, and
 * both paths prefixed `file:` so no name is read as another protocol); it
 * writes only the output path the cache gives it; it is stopped when the job
 * is cancelled or takes longer than `timeoutMs`.
 */
import { spawn as nodeSpawn } from "child_process";
import nodePath from "path";

import type { AudioConverter, ConvertJob, ConvertTarget } from "./converter";
import { isLossyCodec } from "./formats";

/** The parts of a child process used here. */
export interface ProcessLike {
  readonly stderr: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
  on(event: "close", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  kill(): boolean;
}

export type SpawnLike = (
  command: string,
  args: string[],
  options: { shell: false; windowsHide: true; stdio: ["ignore", "ignore", "pipe"] },
) => ProcessLike;

/** Ten minutes: an hour-long WMA converts in well under a minute on an ordinary computer. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
/** ffmpeg's messages kept for the error text. */
const MAX_STDERR = 16_000;

const COMMON = ["-hide_banner", "-nostdin"];
const FILES_ONLY = ["-protocol_whitelist", "file"];

const ENCODE: Record<ConvertTarget, string[]> = {
  flac: ["-c:a", "flac", "-compression_level", "5", "-f", "flac"],
  opus: ["-c:a", "libopus", "-b:a", "192k", "-vbr", "on", "-f", "ogg"],
};

/** Arguments to convert the first audio stream of `input` into `output`. */
export function convertArgs(input: string, output: string, target: ConvertTarget): string[] {
  return [
    ...COMMON,
    "-loglevel",
    "error",
    ...FILES_ONLY,
    "-i",
    `file:${input}`,
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    ...ENCODE[target],
    "-y",
    `file:${output}`,
  ];
}

/** Arguments that make ffmpeg describe `input` and stop (it exits with an error: no output given). */
export function probeArgs(input: string): string[] {
  return [...COMMON, ...FILES_ONLY, "-i", `file:${input}`];
}

/** The codec of the first audio stream in ffmpeg's description of a file. */
export function codecOf(description: string): string | null {
  return /Stream #\d+:\d+[^:]*: Audio: ([a-z0-9_]+)/.exec(description)?.[1] ?? null;
}

export class FfmpegConverter implements AudioConverter {
  private readonly ffmpegPath: string;
  private readonly spawn: SpawnLike;
  private readonly timeoutMs: number;

  constructor(options: { ffmpegPath: string; spawn?: SpawnLike; timeoutMs?: number }) {
    this.ffmpegPath = options.ffmpegPath;
    this.spawn = options.spawn ?? (nodeSpawn as unknown as SpawnLike);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async isLossless(input: string, signal: AbortSignal): Promise<boolean> {
    const { stderr } = await this.run(probeArgs(input), signal, input);
    const codec = codecOf(stderr);
    // Unknown: keep every detail rather than risk losing some.
    return codec === null || !isLossyCodec(codec);
  }

  async convert(job: ConvertJob): Promise<void> {
    const { code, stderr } = await this.run(convertArgs(job.input, job.output, job.target), job.signal, job.input);
    if (code !== 0) {
      throw new Error(failure(job.input, lastLine(stderr)));
    }
  }

  private run(args: string[], signal: AbortSignal, input: string): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error(failure(input, "cancelled")));
        return;
      }
      const child = this.spawn(this.ffmpegPath, args, { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
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
      child.stderr?.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-MAX_STDERR);
      });
      child.on("error", (error) => {
        finish();
        reject(new Error(failure(input, error.message)));
      });
      child.on("close", (code) => {
        finish();
        if (reason) {
          reject(new Error(failure(input, reason)));
        } else {
          resolve({ code, stderr });
        }
      });
    });
  }
}

function failure(input: string, detail: string): string {
  return `Could not convert ${nodePath.basename(input)}${detail ? ` (${detail})` : ""}`;
}

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).pop() ?? "";
}
