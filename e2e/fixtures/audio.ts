/**
 * Small audio files for end-to-end tests, written on the fly so the tests
 * need no downloads and no binary files in the repository.
 */
import fs from "fs";
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
