/**
 * DAT-15: measuring a track's loudness with ffmpeg's EBU R128 meter (ebur128=peak=true): what Lyre reads from its
 * report, the arguments (plain files only, nothing written), and the real bundled program on real files: tones of
 * known loudness, the demo kit's sounds (mastered to a known loudness by scripts/demo-kit), a short effect measured
 * by its loudest moment, silence, and a file that is not audio.
 */
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

import { findBundledFfmpeg } from "./bundledFfmpeg";
import { FfmpegLoudnessReader, loudnessArgs, LoudnessReport } from "./ffmpegLoudness";
import type { PeakSpawn } from "./ffmpegPeaks";
import { pathToFileURL } from "url";
import { wavBytes, writeFile } from "./testing/wavFiles";

type Sound = { channels: Float32Array[]; rate: number };
/** The demo kit's own synthesis and mastering (scripts/demo-kit, plain Node modules): the files Nik tries each release with. */
const kit = async (file: string): Promise<Record<string, (...args: never[]) => unknown>> =>
  import(/* @vite-ignore */ pathToFileURL(path.join(process.cwd(), "scripts", "demo-kit", file)).href);

const frame = (t: number, m: number, i: number) =>
  `[Parsed_ebur128_0 @ 0x1] t: ${t.toFixed(6)}   TARGET:-23 LUFS    M: ${m.toFixed(1)} S: -30.0     I: ${i.toFixed(1)} LUFS       LRA:   0.0 LU  FTPK: -9.0 dBFS  TPK: -8.0 dBFS\n`;
const summary = (i: string, peak: string) =>
  `[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         ${i} LUFS\n    Threshold: -33.0 LUFS\n\n  Loudness range:\n    LRA:         5.3 LU\n    Threshold: -43.0 LUFS\n    LRA low:   -27.0 LUFS\n    LRA high:  -21.7 LUFS\n\n  True peak:\n    Peak:      ${peak} dBFS\n`;

describe("reading ffmpeg's loudness report", () => {
  it("takes the integrated loudness and the true peak from the summary", () => {
    const report = new LoudnessReport();
    for (let k = 1; k <= 50; k++) report.add(frame(k / 10, -20 - (k % 7), -22.6));
    report.add(summary("-22.6", "-8.0"));
    expect(report.finish()).toEqual({ lufs: -22.6, truePeakDb: -8 });
  });

  it("measures a sound shorter than 3 s by its loudest moment (momentary loudness), as integrated loudness is unreliable that short", () => {
    const report = new LoudnessReport();
    for (let k = 1; k <= 15; k++) report.add(frame(k / 10, k === 6 ? -9.8 : -30, -24));
    report.add(summary("-24.0", "-0.2"));
    expect(report.finish()).toEqual({ lufs: -9.8, truePeakDb: -0.2 });
  });

  it("reads lines however the output is cut into chunks", () => {
    const text = [frame(0.1, -21, -21), frame(3.4, -19, -20.5), summary("-20.5", "-3.4")].join("");
    const report = new LoudnessReport();
    for (let at = 0; at < text.length; at += 7) report.add(text.slice(at, at + 7));
    expect(report.finish()).toEqual({ lufs: -20.5, truePeakDb: -3.4 });
  });

  it("has nothing for silence (no loudness to measure), and fails without a summary", () => {
    const silent = new LoudnessReport();
    silent.add(frame(4, -120.7, -70));
    silent.add(summary("-70.0", "-inf"));
    expect(silent.finish()).toBeNull();
    expect(() => new LoudnessReport().finish()).toThrow(/no loudness/);
  });

  it("keeps the figures in the range the library stores", () => {
    const report = new LoudnessReport();
    report.add(frame(5, 2, 1.2));
    report.add(summary("1.2", "13.5"));
    expect(report.finish()).toEqual({ lufs: 0, truePeakDb: 12 });
  });
});

describe("ffmpeg arguments for loudness", () => {
  it("read plain files only, the first audio stream only, through the EBU R128 meter with true peaks; nothing is written", () => {
    expect(loudnessArgs("/m/a.flac")).toEqual([
      "-hide_banner",
      "-nostdin",
      "-nostats",
      "-loglevel",
      "info",
      "-threads",
      "1",
      "-protocol_whitelist",
      "file",
      "-f",
      "flac",
      "-i",
      "file:/m/a.flac",
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
    ]);
  });

  it("run ffmpeg without a shell or window, at low priority, and stop it when cancelled", async () => {
    const proc = Object.assign(new EventEmitter(), {
      pid: 77,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      killed: false,
      kill() {
        this.killed = true;
        queueMicrotask(() => proc.emit("close", null));
        return true;
      },
    });
    const calls: unknown[] = [];
    const spawn: PeakSpawn = (command, _args, options) => {
      calls.push({ command, options });
      return proc;
    };
    const lowered: number[] = [];
    const reader = new FfmpegLoudnessReader({ ffmpegPath: "/bin/ffmpeg", spawn, lowerPriority: (pid) => lowered.push(pid) });
    const controller = new AbortController();
    const measuring = reader.measure("/m/a.flac", controller.signal);
    controller.abort();
    await expect(measuring).rejects.toThrow(/cancelled/);
    expect(proc.killed).toBe(true);
    expect(calls).toEqual([{ command: "/bin/ffmpeg", options: { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] } }]);
    expect(lowered).toEqual([77]);
  });

  it("does not run ffmpeg for a file whose extension Lyre has no reader for (security review 7)", async () => {
    let ran = false;
    const reader = new FfmpegLoudnessReader({
      ffmpegPath: "/bin/ffmpeg",
      spawn: () => {
        ran = true;
        throw new Error("should not run");
      },
    });
    await expect(reader.measure("/m/readme.txt", new AbortController().signal)).rejects.toThrow(/not a kind of audio file/);
    expect(ran).toBe(false);
  });
});

describe("loudness with the bundled ffmpeg", () => {
  const ffmpegPath = findBundledFfmpeg(process.cwd()) as string;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-loudness-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const measure = (file: string) => new FfmpegLoudnessReader({ ffmpegPath }).measure(file, new AbortController().signal);
  /** A demo kit sound (its module and maker), mastered as the kit masters it, written as WAV. */
  const kitSound = async (name: string, module: string, maker: string, lufs: number) => {
    const audio = await kit("audio.mjs");
    const { channels, rate } = (await kit(module))[maker]() as Sound;
    (audio.master as (c: Float32Array[], r: number, l: number) => void)(channels, rate, lufs);
    return writeFile(dir, name, (audio.encodeWav as (c: Float32Array[], r: number) => Buffer)(channels, rate));
  };

  it("measures a steady 1 kHz-like tone at the loudness the standard gives it", async () => {
    // A 440 Hz tone at half scale in stereo: about -3 LUFS per channel at full scale, so near -6 LUFS here.
    const file = writeFile(dir, "tone.wav", wavBytes({ seconds: 5, sampleRate: 48000, channels: 2, level: () => 0.5 }));
    const result = await measure(file);
    expect(result!.lufs).toBeGreaterThan(-7.5);
    expect(result!.lufs).toBeLessThan(-4.5);
    expect(result!.truePeakDb).toBeCloseTo(-6, 0);
  });

  it("measures the demo kit's music and ambience within 1 LU of the loudness they are mastered to", async () => {
    const music = await measure(await kitSound("Tavern Warmth.wav", "music.mjs", "tavernWarmth", -16));
    expect(Math.abs(music!.lufs + 16)).toBeLessThan(1);
    expect(music!.truePeakDb).toBeLessThan(-0.5);
    const rain = await measure(await kitSound("Rain and Wind.wav", "sounds.mjs", "rainAndWind", -22));
    expect(Math.abs(rain!.lufs + 22)).toBeLessThan(1);
    const longEffect = await measure(await kitSound("Thunder.wav", "sounds.mjs", "thunder", -18));
    expect(Math.abs(longEffect!.lufs + 18)).toBeLessThan(1);
  }, 60_000);

  it("measures a short effect (under 3 s) by its loudest moment, louder than its integrated loudness", async () => {
    const clash = await measure(await kitSound("Sword Clash.wav", "sounds.mjs", "swordClash", -18));
    expect(clash!.lufs).toBeGreaterThan(-18);
    expect(clash!.lufs).toBeLessThan(-6);
  });

  it("has nothing for a silent file, and rejects a file that is not audio, in plain words with its name", async () => {
    expect(await measure(writeFile(dir, "silence.wav", wavBytes({ seconds: 4, level: () => 0 })))).toBeNull();
    await expect(measure(writeFile(dir, "Broken.flac", Buffer.from("not really audio")))).rejects.toThrow(/Broken\.flac/);
  });
});
