/**
 * UX review 3: ffmpeg's second opinion on a file the tag reader found no audio in (the import's lengthProbe).
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { findBundledFfmpeg } from "./bundledFfmpeg";
import { ffmpegLength, lengthOf } from "./ffmpegLength";

describe("lengthOf (ffmpeg's description of a file)", () => {
  it("reads the length of a file with an audio stream", () => {
    expect(lengthOf("Input #0, ogg, from 'file:a.ogg':\n  Duration: 00:01:35.04, start: 0.000000\n  Stream #0:0: Audio: vorbis, 44100 Hz")).toBe(95_040);
  });
  it("finds none without a length or without audio", () => {
    expect(lengthOf("Input #0, mp3, from 'x':\n  Duration: N/A, start: 0.000000\n  Stream #0:0: Audio: mp3, 0 channels")).toBeNull();
    expect(lengthOf("Input #0, image2, from 'x':\n  Duration: 00:00:00.04\n  Stream #0:0: Video: png")).toBeNull();
  });
});

describe("ffmpegLength with the real ffmpeg", () => {
  const ffmpeg = findBundledFfmpeg(process.cwd());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-length-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it.runIf(ffmpeg)("gives a real Ogg its length and random bytes named .mp3 none", async () => {
    const ogg = path.join(dir, "rain.ogg");
    execFileSync(ffmpeg as string, ["-loglevel", "error", "-f", "lavfi", "-i", "sine=duration=3", "-c:a", "libvorbis", ogg]);
    const broken = path.join(dir, "Broken file.mp3");
    fs.writeFileSync(broken, Buffer.from(Array.from({ length: 200_000 }, (_, i) => (i * 7919 + 13) % 251)));
    expect(await ffmpegLength(ffmpeg as string, ogg)).toBeGreaterThan(2_900);
    expect(await ffmpegLength(ffmpeg as string, broken)).toBeNull();
  });

  it("does not run ffmpeg for a file it has no reader for", async () => {
    const spawn = vi.fn();
    expect(await ffmpegLength("ffmpeg", "/m/list.m3u8", { spawn: spawn as never })).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });
});
