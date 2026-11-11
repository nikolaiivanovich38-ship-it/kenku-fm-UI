/**
 * Test builds only (CUE_DESK_LYRE_SEED=prototype): the seeded library keeps the prototype's file paths
 * (`H:\Audio\…`, which the specs show), but those files do not exist on the test machine. So that Preview and Play
 * on air can be tested, a file that cannot be prepared plays a stand-in instead: a quiet 440 Hz tone, written
 * once into the test build's data folder. startLibrary.ts applies this only to a seeded test library.
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

import type { MediaPreparer } from "../media/mediaIpc";

/**
 * Six minutes: longer than every start and marker the specs use (Low swell at 3:10, End at 5:18 on t13), with a
 * margin, so a play from a marker starts there (a start past the file's end is moved back: BUG-22). Mono at 8 kHz
 * keeps it about 5.5 MB.
 */
const SAMPLE_RATE = 8000;
const SECONDS = 6 * 60;
const TONE_HZ = 440;
/** About -12 dBFS: clearly heard in a room's mix, nowhere near clipping. */
const AMPLITUDE = 0.25;

/** Writes `lyre-seed-tone.wav` in `folder` if it is not there yet; returns its path. */
export function writeStandInTone(folder: string): string {
  const file = path.join(folder, "lyre-seed-tone.wav");
  if (fs.existsSync(file)) return file;
  const samples = SAMPLE_RATE * SECONDS;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16); // format block size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28); // bytes per second
  wav.writeUInt16LE(2, 32); // bytes per sample
  wav.writeUInt16LE(16, 34); // bits per sample
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * TONE_HZ * i) / SAMPLE_RATE) * AMPLITUDE * 32767), 44 + i * 2);
  }
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, wav);
  return file;
}

/** A preparer that answers `standInFile` whenever `preparer` cannot prepare the file asked for. */
export function standInForMissingFiles(preparer: MediaPreparer, standInFile: string): MediaPreparer {
  return {
    async prepare(address, options) {
      const answer = await preparer.prepare(address, options);
      return "error" in answer ? { url: pathToFileURL(standInFile).href } : answer;
    },
  };
}
