/**
 * Small, real audio files for tests that run the real tag reader (music-metadata) and the bundled ffmpeg: 16-bit
 * PCM in WAV (with optional RIFF INFO tags: title, artist, album) or AIFF. The sound is a 440 Hz tone whose
 * loudness follows `level(seconds)` (0 silence to 1 full scale), so a test can say where a file is quiet or loud.
 */
import fs from "fs";
import path from "path";

export interface ToneOptions {
  seconds: number;
  sampleRate?: number;
  channels?: number;
  /** Amplitude from 0 to 1 at a moment of the file; a steady half-scale tone when left out. */
  level?: (seconds: number) => number;
}

export interface WavTags {
  title?: string;
  artist?: string;
  album?: string;
}

/** Interleaved 16-bit samples of the tone, little- or big-endian. */
function tone(options: ToneOptions, bigEndian: boolean): Buffer {
  const rate = options.sampleRate ?? 8000;
  const channels = options.channels ?? 1;
  const frames = Math.round(options.seconds * rate);
  const level = options.level ?? (() => 0.5);
  const out = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    const value = Math.round(Math.max(-1, Math.min(1, level(t) * Math.sin(2 * Math.PI * 440 * t))) * 32767);
    for (let c = 0; c < channels; c++) {
      const at = (i * channels + c) * 2;
      if (bigEndian) out.writeInt16BE(value, at);
      else out.writeInt16LE(value, at);
    }
  }
  return out;
}

function riffChunk(id: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(id, 0, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/** A LIST INFO chunk (INAM title, IART artist, IPRD album), as many tag editors write into WAV files. */
function infoChunk(tags: WavTags): Buffer {
  const fields: [string, string | undefined][] = [
    ["INAM", tags.title],
    ["IART", tags.artist],
    ["IPRD", tags.album],
  ];
  const parts = fields.filter(([, value]) => value).map(([id, value]) => riffChunk(id, Buffer.from(`${value}\0`, "utf8")));
  return riffChunk("LIST", Buffer.concat([Buffer.from("INFO", "ascii"), ...parts]));
}

export function wavBytes(options: ToneOptions, tags?: WavTags): Buffer {
  const rate = options.sampleRate ?? 8000;
  const channels = options.channels ?? 1;
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(rate * channels * 2, 8);
  fmt.writeUInt16LE(channels * 2, 12);
  fmt.writeUInt16LE(16, 14);
  const body = Buffer.concat([Buffer.from("WAVE", "ascii"), riffChunk("fmt ", fmt), riffChunk("data", tone(options, false)), ...(tags ? [infoChunk(tags)] : [])]);
  return riffChunk("RIFF", body);
}

/** An 80-bit IEEE extended number, as AIFF stores its sample rate. */
function extended(value: number): Buffer {
  const out = Buffer.alloc(10);
  const exponent = Math.floor(Math.log2(value));
  out.writeUInt16BE(exponent + 16383, 0);
  const mantissa = BigInt(Math.round((value / 2 ** exponent) * 2 ** 63));
  out.writeBigUInt64BE(mantissa, 2);
  return out;
}

function aiffChunk(id: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(id, 0, "ascii");
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

export function aiffBytes(options: ToneOptions): Buffer {
  const rate = options.sampleRate ?? 8000;
  const channels = options.channels ?? 1;
  const samples = tone(options, true);
  const comm = Buffer.alloc(8);
  comm.writeUInt16BE(channels, 0);
  comm.writeUInt32BE(samples.length / (channels * 2), 2);
  comm.writeUInt16BE(16, 6);
  const ssnd = Buffer.concat([Buffer.alloc(8), samples]);
  return aiffChunk("FORM", Buffer.concat([Buffer.from("AIFF", "ascii"), aiffChunk("COMM", Buffer.concat([comm, extended(rate)])), aiffChunk("SSND", ssnd)]));
}

/** Writes `bytes` to `folder/name` (folders made as needed) and returns the full path. */
export function writeFile(folder: string, name: string, bytes: Buffer): string {
  const file = path.join(folder, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}
