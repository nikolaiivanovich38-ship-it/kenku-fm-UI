/**
 * Loudness peaks with ffmpeg (w3-media): the levels worked out from decoded samples, the ffmpeg arguments (plain
 * files only, nothing written), and the real bundled program on real files, while a 20 ms timer in this process
 * keeps its beat (the library's process must never be held for more than 200 ms).
 */
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { importAudio, openLibrary, PeakJobs, trackPeaks } from "../data";
import { findBundledFfmpeg } from "./bundledFfmpeg";
import { FfmpegPeakReader, PEAK_SAMPLE_RATE, peakArgs, type PeakSpawn } from "./ffmpegPeaks";
import { PeakLevels, levelByte } from "./peakLevels";
import { wavBytes, writeFile } from "./testing/wavFiles";

/** 16-bit little-endian samples, as ffmpeg writes them. */
function samples(values: number[]): Buffer {
  const out = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => out.writeInt16LE(Math.round(v * 32767), i * 2));
  return out;
}

/** Measures the longest gap between beats of a 20 ms timer while `work` runs. */
async function longestGapWhile(work: () => Promise<unknown>): Promise<number> {
  let last = performance.now();
  let longest = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 20);
  try {
    await work();
  } finally {
    clearInterval(timer);
  }
  return Math.max(longest, performance.now() - last);
}

describe("peak levels", () => {
  it("are 0 at -60 dBFS or quieter and 255 at full scale, on a decibel scale between", () => {
    expect(levelByte(1)).toBe(255);
    expect(levelByte(0)).toBe(0);
    expect(levelByte(0.001)).toBe(0); // -60 dBFS
    expect(levelByte(10 ** (-30 / 20))).toBe(128); // -30 dBFS, half way
  });

  it("take the loudest sample in each part of the file, whatever the chunk boundaries", () => {
    const levels = new PeakLevels({ points: 4, blockSamples: 4 });
    const all = samples([0.001, 0.001, 0.5, 0.001, 1, 0.001, 0.001, -1, 0.03, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001]);
    // Split mid-sample (odd byte counts) to show a half sample waits for its other byte.
    levels.add(all.subarray(0, 5));
    levels.add(all.subarray(5, 17));
    levels.add(all.subarray(17));
    expect([...levels.finish()]).toEqual([levelByte(0.5), levelByte(1), levelByte(0.03), levelByte(0.001)]);
  });

  it("give one point per block when the file is shorter than the points asked for", () => {
    const levels = new PeakLevels({ points: 1000, blockSamples: 2 });
    levels.add(samples([0.5, 0.25, 1, 0]));
    expect([...levels.finish()]).toEqual([levelByte(0.5), levelByte(1)]);
  });

  it("keep their shape for a very long file while holding a bounded number of blocks", () => {
    const levels = new PeakLevels({ points: 4, blockSamples: 1 });
    // 300,000 samples: quiet, loud, quiet, loud quarters. The blocks are merged several times on the way.
    const quarter = 75_000;
    for (let q = 0; q < 4; q++) levels.add(samples(Array.from({ length: quarter }, () => (q % 2 ? 0.9 : 0.01))));
    const asRead = (v: number) => levelByte(Math.round(v * 32767) / 32768);
    expect([...levels.finish()]).toEqual([asRead(0.01), asRead(0.9), asRead(0.01), asRead(0.9)]);
  });

  it("are none for an empty file", () => {
    expect(() => new PeakLevels({ points: 10 }).finish()).toThrow(/no sound/);
  });
});

describe("ffmpeg arguments for peaks", () => {
  it("read plain files only, the first audio stream only, as mono 16-bit samples to Lyre; nothing is written", () => {
    expect(peakArgs("C:\\Music\\Old.wma")).toEqual([
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-threads",
      "1",
      "-protocol_whitelist",
      "file",
      "-f",
      "asf",
      "-i",
      "file:C:\\Music\\Old.wma",
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
    ]);
  });

  it("run ffmpeg without a shell or window, at low priority, and stop it when cancelled", async () => {
    const proc = Object.assign(new EventEmitter(), {
      pid: 4242,
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
    const spawn: PeakSpawn = (command, args, options) => {
      calls.push({ command, options });
      return proc;
    };
    const lowered: number[] = [];
    const reader = new FfmpegPeakReader({ ffmpegPath: "/bin/ffmpeg", spawn, lowerPriority: (pid) => lowered.push(pid) });
    const controller = new AbortController();
    const reading = reader.read("/m/a.flac", controller.signal);
    controller.abort();
    await expect(reading).rejects.toThrow(/cancelled/);
    expect(proc.killed).toBe(true);
    expect(calls).toEqual([{ command: "/bin/ffmpeg", options: { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] } }]);
    expect(lowered).toEqual([4242]);
  });
});

describe("loudness peaks with the bundled ffmpeg", () => {
  const ffmpegPath = findBundledFfmpeg(process.cwd()) as string;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-peaks-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("show a quiet start and a loud end where the file has them, in 1,000 points", async () => {
    const file = writeFile(dir, "builds.wav", wavBytes({ seconds: 4, sampleRate: 44100, channels: 2, level: (t) => (t < 2 ? 0.0005 : 0.9) }));
    const levels = await new FfmpegPeakReader({ ffmpegPath }).read(file, new AbortController().signal);
    expect(levels).toHaveLength(1000);
    expect(Math.max(...levels.slice(0, 480))).toBeLessThanOrEqual(10);
    expect(Math.min(...levels.slice(520))).toBeGreaterThanOrEqual(240);
  });

  it("reject a file ffmpeg cannot read, in plain words with the file's name", async () => {
    const file = writeFile(dir, "Broken.flac", Buffer.from("not really audio"));
    await expect(new FfmpegPeakReader({ ffmpegPath }).read(file, new AbortController().signal)).rejects.toThrow(/Broken\.flac/);
  });

  it("never hold this process for more than 200 ms, even for a 20-minute file", async () => {
    const file = writeFile(dir, "long.wav", wavBytes({ seconds: 20 * 60, sampleRate: 8000, level: (t) => 0.2 + 0.5 * Math.abs(Math.sin(t / 30)) }));
    let levels: Uint8Array = new Uint8Array();
    const gap = await longestGapWhile(async () => {
      levels = await new FfmpegPeakReader({ ffmpegPath }).read(file, new AbortController().signal);
    });
    expect(levels).toHaveLength(1000);
    expect(gap, "longest gap between 20 ms beats, in ms").toBeLessThanOrEqual(200);
  }, 60_000);

  it("are worked out for a whole import in the background, without holding the library's process for more than 200 ms", async () => {
    const files = Array.from({ length: 40 }, (_, i) => writeFile(path.join(dir, "import"), `cue ${i + 1}.wav`, wavBytes({ seconds: 20, sampleRate: 22050 })));
    const library = openLibrary({ folder: path.join(dir, "library") });
    try {
      const { trackIds } = await importAudio(library.store, { paths: files });
      const ready: string[] = [];
      const jobs = new PeakJobs(library.store, new FfmpegPeakReader({ ffmpegPath }), { onReady: (ids) => ready.push(...ids) });
      const gap = await longestGapWhile(async () => {
        jobs.inBackground(trackIds);
        await jobs.idle();
      });
      jobs.close();
      expect(trackIds.map((id) => trackPeaks(library.store, id).state)).toEqual(trackIds.map(() => "ready"));
      expect(gap, "longest gap between 20 ms beats, in ms").toBeLessThanOrEqual(200);
    } finally {
      library.close();
    }
  }, 120_000);
});

describe("peaks never let ffmpeg guess the reader (security review 7)", () => {
  it("does not run ffmpeg for a file whose extension Lyre has no reader for", async () => {
    const spawn = vi.fn();
    const reader = new FfmpegPeakReader({ ffmpegPath: "f", spawn: spawn as unknown as PeakSpawn });
    await expect(reader.read("/m/list.m3u8", new AbortController().signal)).rejects.toThrow(/list\.m3u8/);
    expect(spawn).not.toHaveBeenCalled();
  });
});
