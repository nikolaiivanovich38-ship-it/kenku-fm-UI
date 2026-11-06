/**
 * DAT-15: a track's loudness with ffmpeg, the LoudnessReader the library's process uses (data/peaks.ts PeakJobs).
 *
 * ffmpeg decodes the file in its own process, at below-normal priority on one thread, through its EBU R128 meter
 * with true peaks (`ebur128=peak=true`), and writes nothing: the figures come back in its report on the error
 * stream, which LoudnessReport reads line by line as it arrives (about ten short lines a second of audio), keeping
 * only the loudest momentary loudness and the summary.
 *
 * - Integrated loudness (LUFS) and true peak (dBTP) come from the summary.
 * - A sound shorter than 3 s (SHORT_SOUND_MS) is measured by its loudest momentary loudness (400 ms windows):
 *   integrated loudness gates and averages over too little to mean much that short.
 * - Silence (no loudness above the meter's floor) gives null: Lyre leaves it as it is.
 *
 * Safety, as for the peaks (ffmpegPeaks.ts): no shell, each argument passed as it is, plain files only, the reader
 * fixed by the extension, the first audio stream only, nothing written. Stopped when cancelled or after `timeoutMs`.
 */
import { spawn as nodeSpawn } from "child_process";

import { SHORT_SOUND_MS, type TrackLoudness } from "../../common/domain";
import { baseName } from "../data/import/tagReader";
import type { LoudnessReader } from "../data/peaks";
import { belowNormal, type PeakSpawn } from "./ffmpegPeaks";
import { demuxerArgs } from "./formats";

/** Ten minutes, as the peaks: an hour-long file is measured in well under that. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
/** The meter's floor: anything at or below it is silence. */
const SILENT_LUFS = -70;
/** The range the library keeps (schema step 4's CHECKs). */
const MAX_LUFS = 0;
const PEAK_RANGE = [-100, 12] as const;

/** Arguments that measure the first audio stream of `input` with the EBU R128 meter, writing nothing. */
export function loudnessArgs(input: string): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    // The meter's lines and summary are at the "info" level.
    "-loglevel",
    "info",
    "-threads",
    "1",
    "-protocol_whitelist",
    "file",
    // Security review 7: the reader comes from the extension, never from the file's content.
    ...(demuxerArgs(input) ?? []),
    "-i",
    `file:${input}`,
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-af",
    "ebur128=peak=true",
    "-f",
    "null",
    "-",
  ];
}

const FRAME = /\bt:\s*([\d.]+)\s+TARGET:.*?\bM:\s*(-?[\d.]+|-?inf)/;
const INTEGRATED = /^\s*I:\s*(-?[\d.]+|-?inf)\s+LUFS/;
const PEAK = /^\s*Peak:\s*(-?[\d.]+|-?inf)\s+dB/;

const toNumber = (text: string) => (/inf/.test(text) ? (text.startsWith("-") ? -Infinity : Infinity) : Number(text));

/** Reads ffmpeg's ebur128 report as it arrives, chunk by chunk. */
export class LoudnessReport {
  private partial = "";
  private lastTime = 0;
  private loudestMomentary = -Infinity;
  private inSummary = false;
  private integrated: number | null = null;
  private truePeak: number | null = null;

  add(chunk: string): void {
    const lines = (this.partial + chunk).split(/\r?\n/);
    this.partial = lines.pop() ?? "";
    for (const line of lines) this.line(line);
  }

  private line(line: string): void {
    if (this.inSummary) {
      const integrated = INTEGRATED.exec(line);
      if (integrated) this.integrated = toNumber(integrated[1]);
      const peak = PEAK.exec(line);
      if (peak) this.truePeak = toNumber(peak[1]);
      return;
    }
    if (/\bSummary:/.test(line)) {
      this.inSummary = true;
      return;
    }
    const frame = FRAME.exec(line);
    if (frame) {
      this.lastTime = Number(frame[1]);
      this.loudestMomentary = Math.max(this.loudestMomentary, toNumber(frame[2]));
    }
  }

  /** The figures; null for silence. Throws when ffmpeg gave no summary (it could not read the file). */
  finish(): TrackLoudness | null {
    if (this.partial) this.line(this.partial);
    this.partial = "";
    if (this.integrated === null || this.truePeak === null) throw new Error("ffmpeg gave no loudness");
    const short = this.lastTime * 1000 < SHORT_SOUND_MS;
    const lufs = short ? this.loudestMomentary : this.integrated;
    if (!Number.isFinite(lufs) || lufs <= SILENT_LUFS || !Number.isFinite(this.truePeak)) return null;
    const tenth = (x: number) => Math.round(x * 10) / 10;
    return {
      lufs: tenth(Math.min(MAX_LUFS, lufs)),
      truePeakDb: tenth(Math.min(PEAK_RANGE[1], Math.max(PEAK_RANGE[0], this.truePeak))),
    };
  }
}

export class FfmpegLoudnessReader implements LoudnessReader {
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

  measure(file: string, signal: AbortSignal): Promise<TrackLoudness | null> {
    const failure = (detail: string) => new Error(`Could not measure how loud ${baseName(file)} is${detail ? ` (${detail})` : ""}`);
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(failure("cancelled"));
        return;
      }
      if (!demuxerArgs(file)) {
        reject(failure("not a kind of audio file Lyre reads"));
        return;
      }
      const child = this.spawn(this.ffmpegPath, loudnessArgs(file), { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      if (child.pid !== undefined) this.lowerPriority(child.pid);
      const report = new LoudnessReport();
      let lastError = "";
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
        const text = chunk.toString();
        report.add(text);
        const lines = text.trim().split(/\r?\n/);
        lastError = lines[lines.length - 1] ?? lastError;
      });
      child.on("error", (error) => {
        finish();
        reject(failure(error.message));
      });
      child.on("close", (code) => {
        finish();
        if (reason) return reject(failure(reason));
        if (code !== 0) return reject(failure(lastError.trim().slice(0, 300)));
        try {
          resolve(report.finish());
        } catch (error) {
          reject(failure((error as Error).message));
        }
      });
    });
  }
}
