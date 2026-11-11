import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { standInForMissingFiles, writeStandInTone } from "./seedAudio";

const folders: string[] = [];
const tempFolder = () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-seed-audio-"));
  folders.push(folder);
  return folder;
};
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

describe("writeStandInTone (test builds: the seeded library's files do not exist on the test machine)", () => {
  it("writes a playable WAV of a quiet tone, once", () => {
    const folder = tempFolder();
    const file = writeStandInTone(folder);
    const wav = fs.readFileSync(file);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    const sampleRate = wav.readUInt32LE(24);
    const dataBytes = wav.readUInt32LE(40);
    // Long enough for every start and marker the specs use (Low swell at 3:10, End at 5:18 on t13), with a margin:
    // a start past the file's end would be moved back to the start (BUG-22).
    expect(dataBytes / 2 / sampleRate).toBeGreaterThanOrEqual(6 * 60);
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(fs.statSync(file).size).toBeLessThan(6 * 1024 * 1024); // small: a low sample rate
    const peak = Math.max(...Array.from({ length: 2000 }, (_, i) => Math.abs(wav.readInt16LE(44 + i * 2))));
    expect(peak).toBeGreaterThan(1000); // audible, so Play on air reaches a room
    expect(peak).toBeLessThan(16384); // and quiet
    const written = fs.statSync(file).mtimeMs;
    expect(writeStandInTone(folder)).toBe(file);
    expect(fs.statSync(file).mtimeMs).toBe(written);
  });
});

describe("standInForMissingFiles", () => {
  it("answers the stand-in tone when the real file cannot be prepared", async () => {
    const standIn = path.join(tempFolder(), "tone.wav");
    const preparer = { prepare: vi.fn(async () => ({ error: "This file could not be found." })) };
    const answer = await standInForMissingFiles(preparer, standIn).prepare("file:///H:/Audio/ashes.mp3", { keepLocal: false });
    expect(answer).toEqual({ url: pathToFileURL(standIn).href });
  });

  it("passes a file that can be prepared straight through", async () => {
    const preparer = { prepare: vi.fn(async () => ({ url: "file:///music/real.mp3" })) };
    const wrapped = standInForMissingFiles(preparer, "/tmp/tone.wav");
    expect(await wrapped.prepare("file:///music/real.mp3", { keepLocal: true })).toEqual({ url: "file:///music/real.mp3" });
    expect(preparer.prepare).toHaveBeenCalledWith("file:///music/real.mp3", { keepLocal: true });
  });
});
