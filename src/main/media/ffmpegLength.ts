/**
 * UX review 3: ffmpeg's second opinion at import. When the tag reader (music-metadata) cannot read a file or finds
 * no length in it, ffmpeg describes the file; a file with an audio stream and a length is audio, anything else is
 * refused. Runs in the library's process, with the same limits as the converter's probe (ffmpegConverter.ts):
 * no shell, plain files only, the reader named from the extension, nothing written, stopped after `timeoutMs`.
 */
import { spawn as nodeSpawn } from "child_process";

import { probeArgs } from "./ffmpegConverter";
import { demuxerArgs } from "./formats";

type LengthSpawn = (
  command: string,
  args: string[],
  options: { shell: false; windowsHide: true; stdio: ["ignore", "ignore", "pipe"] },
) => {
  readonly stderr: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
  on(event: "close", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  kill(): boolean;
};

/** The length in ms in ffmpeg's description of a file, or null without one or without an audio stream. */
export function lengthOf(description: string): number | null {
  if (!/Stream #\d+:\d+[^:]*: Audio: /.test(description)) return null;
  const match = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(description);
  if (!match) return null;
  const ms = Math.round(((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000);
  return ms > 0 ? ms : null;
}

/** The file's length by ffmpeg, or null when it finds no audio (or cannot run). Never rejects. */
export function ffmpegLength(ffmpegPath: string, file: string, options: { spawn?: LengthSpawn; timeoutMs?: number } = {}): Promise<number | null> {
  if (!demuxerArgs(file)) return Promise.resolve(null);
  const spawn = options.spawn ?? (nodeSpawn as unknown as LengthSpawn);
  return new Promise((resolve) => {
    let stderr = "";
    let child: ReturnType<LengthSpawn>;
    try {
      child = spawn(ffmpegPath, probeArgs(file), { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 30_000);
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-16_000);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(lengthOf(stderr));
    });
  });
}
