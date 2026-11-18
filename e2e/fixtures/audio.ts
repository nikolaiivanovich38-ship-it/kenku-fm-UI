/**
 * Small audio files for end-to-end tests, written on the fly so the tests
 * need no downloads and no binary files in the repository.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const SAMPLE_RATE = 22_050;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

/**
 * Write a mono 16-bit PCM WAV file holding a sine tone and return its path.
 * About 44 KB per second, so a few seconds stay tiny.
 */
export function writeSineWav(
  folder: string,
  fileName: string,
  { seconds = 2, frequency = 440, volume = 0.2 }: { seconds?: number; frequency?: number; volume?: number } = {},
): string {
  const sampleCount = Math.round(seconds * SAMPLE_RATE);
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const dataSize = sampleCount * bytesPerSample * CHANNELS;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  // "fmt " chunk: plain PCM
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * bytesPerSample, 28);
  buffer.writeUInt16LE(CHANNELS * bytesPerSample, 32);
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
  // "data" chunk
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  const amplitude = Math.round(volume * 0x7fff);
  for (let i = 0; i < sampleCount; i++) {
    const sample = Math.round(amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE));
    buffer.writeInt16LE(sample, 44 + i * bytesPerSample);
  }

  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Write a short, real audio file in the format its name says (.wav, .mp3, .flac, .ogg, …) and return its path.
 * Lyre refuses a file that is not audio whatever its name (UX review 3), and its converter reads each file as the
 * format its extension names (security review 7), so tests that add files need real ones. Formats other than WAV
 * are encoded once per extension with the ffmpeg the app ships (ffmpeg-static) and copied after that.
 */
export function writeAudioFile(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (extension === ".wav") return writeSineWav(path.dirname(filePath), path.basename(filePath), { seconds: 0.5 });
  const cached = path.join(audioCache(), `tone${extension}`);
  if (!fs.existsSync(cached)) {
    const source = writeSineWav(audioCache(), "tone-source.wav", { seconds: 0.5 });
    const part = `${cached}.part${extension}`;
    execFileSync(ffmpegPath(), ["-v", "error", "-y", "-i", source, part]);
    fs.renameSync(part, cached);
  }
  fs.copyFileSync(cached, filePath);
  return filePath;
}

/**
 * 52: an MP3 like a file that was cut or joined: a 3 s VBR MP3 whose Xing header counts its own frames, followed by
 * 17 s more without a header, so the header says 3 s and the file plays 20 s. music-metadata reads 3 s from it;
 * Chromium guesses about 18 s from the bit rate and plays all 20 s. Made with the ffmpeg the app ships.
 */
export function writeJoinedMp3(folder: string, fileName: string, title: string): string {
  fs.mkdirSync(folder, { recursive: true });
  const part = (name: string, args: string[]) => {
    const out = path.join(audioCache(), name);
    execFileSync(ffmpegPath(), ["-v", "error", "-y", "-f", "lavfi", ...args, "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-q:a", "4", out]);
    return out;
  };
  const head = part("head.mp3", ["-i", "sine=f=440:d=3", "-metadata", `title=${title}`]);
  const tail = part("tail.mp3", ["-i", "sine=f=660:d=17", "-write_xing", "0", "-id3v2_version", "0"]);
  const filePath = path.join(folder, fileName);
  fs.writeFileSync(filePath, Buffer.concat([fs.readFileSync(head), fs.readFileSync(tail)]));
  return filePath;
}

let cacheFolder: string | null = null;
function audioCache(): string {
  cacheFolder ??= fs.mkdtempSync(path.join(os.tmpdir(), "lyre-test-audio-"));
  return cacheFolder;
}

function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const found = require("ffmpeg-static") as string | null;
  if (!found) throw new Error("ffmpeg-static has no ffmpeg for this platform; run yarn install");
  return found;
}
