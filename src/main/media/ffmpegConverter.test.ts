import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

import { codecOf, convertArgs, FfmpegConverter, probeArgs, SpawnLike } from "./ffmpegConverter";

/** A scripted ffmpeg process: the test says what it writes and how it exits. */
class FakeProcess extends EventEmitter {
  readonly stderr = new EventEmitter();
  killed = false;
  kill() {
    this.killed = true;
    queueMicrotask(() => this.emit("close", null));
    return true;
  }
}

function fakeSpawn(script: (proc: FakeProcess, args: string[]) => void) {
  const calls: { command: string; args: string[]; options: unknown }[] = [];
  const spawn: SpawnLike = (command, args, options) => {
    const proc = new FakeProcess();
    calls.push({ command, args, options });
    queueMicrotask(() => script(proc, args));
    return proc;
  };
  return { spawn, calls };
}

describe("ffmpeg arguments (BUG-10)", () => {
  it("reads and writes plain files only, the first audio stream only, overwriting a stale part file", () => {
    const args = convertArgs("C:\\Music\\Old.wma", "C:\\Cache\\abc.flac.part", "flac");
    expect(args).toEqual([
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-protocol_whitelist",
      "file",
      "-i",
      "file:C:\\Music\\Old.wma",
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-c:a",
      "flac",
      "-compression_level",
      "5",
      "-f",
      "flac",
      "-y",
      "file:C:\\Cache\\abc.flac.part",
    ]);
  });

  it("writes lossy sources as high-quality Opus in Ogg", () => {
    const args = convertArgs("/m/a.wma", "/c/a.ogg.part", "opus");
    expect(args.slice(args.indexOf("-c:a"), args.indexOf("-y"))).toEqual(["-c:a", "libopus", "-b:a", "192k", "-vbr", "on", "-f", "ogg"]);
  });

  it("probes without writing anything", () => {
    expect(probeArgs("/m/a.wma")).toEqual(["-hide_banner", "-nostdin", "-protocol_whitelist", "file", "-i", "file:/m/a.wma"]);
  });

  it("reads the audio codec from ffmpeg's description of the file", () => {
    const stderr = [
      "Input #0, asf, from 'file:/m/a.wma':",
      "  Duration: 00:03:12.00, start: 0.000000, bitrate: 900 kb/s",
      "  Stream #0:0(eng): Audio: wmalossless (a1[0][0] / 0x00A1), 44100 Hz, stereo, s16p, 900 kb/s",
      "At least one output file must be specified",
    ].join("\n");
    expect(codecOf(stderr)).toBe("wmalossless");
    expect(codecOf("Stream #0:1: Audio: wmav2 (a[1][0][0] / 0x0161), 44100 Hz")).toBe("wmav2");
    expect(codecOf("nothing useful")).toBeNull();
  });
});

describe("FfmpegConverter (BUG-10)", () => {
  it("runs ffmpeg without a shell and with no window", async () => {
    const { spawn, calls } = fakeSpawn((proc) => proc.emit("close", 0));
    await new FfmpegConverter({ ffmpegPath: "/bin/ffmpeg", spawn }).convert({
      input: "/m/a.wma",
      output: "/c/a.flac.part",
      target: "flac",
      signal: new AbortController().signal,
    });
    expect(calls[0].command).toBe("/bin/ffmpeg");
    expect(calls[0].options).toMatchObject({ shell: false, windowsHide: true });
  });

  it("decides lossless from the probe, and lossless when the codec is not recognised", async () => {
    const answer = (codec: string) =>
      fakeSpawn((proc) => {
        proc.stderr.emit("data", Buffer.from(`Stream #0:0: Audio: ${codec}, 44100 Hz`));
        proc.emit("close", 1); // ffmpeg exits with an error when given no output
      }).spawn;
    const signal = new AbortController().signal;
    expect(await new FfmpegConverter({ ffmpegPath: "f", spawn: answer("wmalossless") }).isLossless("/m/a.wma", signal)).toBe(true);
    expect(await new FfmpegConverter({ ffmpegPath: "f", spawn: answer("wmav2") }).isLossless("/m/a.wma", signal)).toBe(false);
    expect(await new FfmpegConverter({ ffmpegPath: "f", spawn: answer("mystery") }).isLossless("/m/a.wma", signal)).toBe(true);
  });

  it("reports a failed conversion in plain words, keeping ffmpeg's reason for the log", async () => {
    const { spawn } = fakeSpawn((proc) => {
      proc.stderr.emit("data", Buffer.from("Invalid data found when processing input"));
      proc.emit("close", 1);
    });
    const job = { input: "/m/Broken.wma", output: "/c/x.part", target: "flac" as const, signal: new AbortController().signal };
    await expect(new FfmpegConverter({ ffmpegPath: "f", spawn }).convert(job)).rejects.toThrow(
      "Could not convert Broken.wma (Invalid data found when processing input)",
    );
  });

  it("reports a missing ffmpeg as an error, not a crash", async () => {
    const { spawn } = fakeSpawn((proc) => proc.emit("error", new Error("spawn ENOENT")));
    const job = { input: "/m/a.wma", output: "/c/x.part", target: "flac" as const, signal: new AbortController().signal };
    await expect(new FfmpegConverter({ ffmpegPath: "f", spawn }).convert(job)).rejects.toThrow(/Could not convert a\.wma/);
  });

  it("stops ffmpeg when the job is cancelled or takes too long", async () => {
    vi.useFakeTimers();
    try {
      const procs: FakeProcess[] = [];
      const { spawn } = fakeSpawn((proc) => procs.push(proc));
      const converter = new FfmpegConverter({ ffmpegPath: "f", spawn, timeoutMs: 1000 });
      const controller = new AbortController();
      const cancelled = converter.convert({ input: "/m/a.wma", output: "/c/a", target: "flac", signal: controller.signal });
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await expect(cancelled).rejects.toThrow(/Could not convert/);
      expect(procs[0].killed).toBe(true);

      const slow = converter.convert({ input: "/m/b.wma", output: "/c/b", target: "flac", signal: new AbortController().signal });
      const settled = expect(slow).rejects.toThrow(/took too long/);
      await vi.advanceTimersByTimeAsync(1001);
      await settled;
      expect(procs[1].killed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
