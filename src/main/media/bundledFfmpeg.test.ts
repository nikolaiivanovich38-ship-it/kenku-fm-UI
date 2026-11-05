/**
 * BUG-10 (w3-media): where Lyre finds the ffmpeg that ffmpeg-static bundles, and that the real program converts the
 * formats the player cannot play. The packaged build is checked end to end by e2e/lyreMedia.spec.ts.
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

import { bundledFfmpegPath, findBundledFfmpeg } from "./bundledFfmpeg";
import { FfmpegConverter } from "./ffmpegConverter";
import { aiffBytes, wavBytes, writeFile } from "./testing/wavFiles";

describe("bundledFfmpegPath (BUG-10)", () => {
  it("looks beside app.asar, in app.asar.unpacked, in a packaged app on Windows", () => {
    expect(bundledFfmpegPath("C:\\Users\\nik\\AppData\\Local\\lyre\\app-0.3.0\\resources\\app.asar", "win32")).toBe(
      "C:\\Users\\nik\\AppData\\Local\\lyre\\app-0.3.0\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe",
    );
  });

  it("looks in app.asar.unpacked on Linux and macOS, with no .exe", () => {
    expect(bundledFfmpegPath("/opt/Lyre/resources/app.asar", "linux")).toBe("/opt/Lyre/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg");
  });

  it("looks in the project's node_modules when the app runs from its folder (yarn start)", () => {
    expect(bundledFfmpegPath("/home/nik/lyre", "linux")).toBe("/home/nik/lyre/node_modules/ffmpeg-static/ffmpeg");
  });

  it("answers null, not a path to nothing, when the program is missing", () => {
    expect(findBundledFfmpeg("/nowhere/app.asar", "linux", () => false)).toBeNull();
    expect(findBundledFfmpeg("/opt/Lyre/resources/app.asar", "linux", (p) => p.endsWith("ffmpeg-static/ffmpeg"))).toBe(
      "/opt/Lyre/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg",
    );
  });
});

describe("the bundled ffmpeg itself (BUG-10)", () => {
  const ffmpegPath = findBundledFfmpeg(process.cwd(), process.platform);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-ffmpeg-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("is installed with the app's libraries for this computer", () => {
    expect(ffmpegPath, "node_modules/ffmpeg-static/ffmpeg (yarn install downloads it)").not.toBeNull();
  });

  it("converts AIFF (lossless) to FLAC", async () => {
    const converter = new FfmpegConverter({ ffmpegPath: ffmpegPath as string });
    const input = writeFile(dir, "Bells.aiff", aiffBytes({ seconds: 1 }));
    const signal = new AbortController().signal;
    expect(await converter.isLossless(input, signal)).toBe(true);
    const output = path.join(dir, "bells.flac.part");
    await converter.convert({ input, output, target: "flac", signal });
    expect(fs.readFileSync(output).subarray(0, 4).toString("ascii")).toBe("fLaC");
  });

  it("converts lossy WMA to Opus in Ogg", async () => {
    const converter = new FfmpegConverter({ ffmpegPath: ffmpegPath as string });
    // A real WMA file, made by the same program from a WAV.
    const wav = writeFile(dir, "source.wav", wavBytes({ seconds: 1, sampleRate: 44100, channels: 2 }));
    const wma = path.join(dir, "Old.wma");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath as string, ["-hide_banner", "-loglevel", "error", "-i", wav, "-c:a", "wmav2", "-y", wma], { stdio: "ignore" });
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    });
    const signal = new AbortController().signal;
    expect(await converter.isLossless(wma, signal)).toBe(false);
    const output = path.join(dir, "old.ogg.part");
    await converter.convert({ input: wma, output, target: "opus", signal });
    expect(fs.readFileSync(output).subarray(0, 4).toString("ascii")).toBe("OggS");
  });
});
