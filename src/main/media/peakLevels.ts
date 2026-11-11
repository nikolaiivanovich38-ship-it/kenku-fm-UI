/**
 * Loudness peaks from decoded samples (w3-media): the loudest sample in each small block as the samples stream in,
 * then about PEAK_POINTS levels across the whole file, each a byte on a decibel scale as a meter shows it: 0 at
 * -60 dBFS or quieter, 255 at full scale. A decibel scale shows a quiet intro or a fade as clearly as a loud chorus.
 *
 * Work per chunk is a single pass over its samples (a 64 KB chunk takes well under a millisecond). Blocks start at
 * 1 ms, so a file of a second or more gets every point; when MAX_BLOCKS are kept, neighbours are merged and blocks
 * become twice as long, so memory stays under 256 KB however long the file (a 10-hour ambience included).
 */
import { PEAK_POINTS } from "../data/repo/peaks";

/** The quietest level shown above the floor, in dBFS. */
export const FLOOR_DB = -60;
/** Blocks kept before neighbours are merged. */
export const MAX_BLOCKS = 65_536;

/** A peak (0 to 1 of full scale) as a level byte. */
export function levelByte(peak: number): number {
  if (!(peak > 0)) return 0;
  const shown = (20 * Math.log10(Math.min(1, peak)) - FLOOR_DB) / -FLOOR_DB;
  return Math.round(Math.max(0, Math.min(1, shown)) * 255);
}

export class PeakLevels {
  private readonly points: number;
  private blockSamples: number;
  private blocks = new Float32Array(MAX_BLOCKS);
  private count = 0;
  private blockPeak = 0;
  private inBlock = 0;
  /** A byte left over when a chunk ends mid-sample. */
  private carry: number | null = null;

  /** @param options.blockSamples samples per block to start with (default 8: 1 ms at 8 kHz) */
  constructor(options: { points?: number; blockSamples?: number } = {}) {
    this.points = options.points ?? PEAK_POINTS;
    this.blockSamples = options.blockSamples ?? 8;
  }

  /** More 16-bit little-endian samples (mono). */
  add(chunk: Uint8Array): void {
    let i = 0;
    if (this.carry !== null && chunk.length > 0) {
      this.sample(this.carry | (chunk[0] << 8));
      this.carry = null;
      i = 1;
    }
    for (; i + 1 < chunk.length; i += 2) this.sample(chunk[i] | (chunk[i + 1] << 8));
    if (i < chunk.length) this.carry = chunk[i];
  }

  /** The levels across the file: PEAK_POINTS of them, or one per block for a very short file. */
  finish(): Uint8Array {
    if (this.inBlock > 0) this.endBlock();
    if (this.count === 0) throw new Error("the file has no sound in it");
    const points = Math.min(this.points, this.count);
    const out = new Uint8Array(points);
    for (let p = 0; p < points; p++) {
      const from = Math.floor((p * this.count) / points);
      const to = Math.max(from + 1, Math.floor(((p + 1) * this.count) / points));
      let peak = 0;
      for (let b = from; b < to; b++) peak = Math.max(peak, this.blocks[b]);
      out[p] = levelByte(peak);
    }
    return out;
  }

  private sample(unsigned: number): void {
    const value = unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
    const peak = Math.abs(value) / 32768;
    if (peak > this.blockPeak) this.blockPeak = peak;
    if (++this.inBlock === this.blockSamples) this.endBlock();
  }

  private endBlock(): void {
    this.blocks[this.count++] = this.blockPeak;
    this.blockPeak = 0;
    this.inBlock = 0;
    if (this.count === this.blocks.length) {
      // Full: merge neighbours into half as many blocks, each twice as long, so every block stays the same length.
      for (let b = 0; b < this.count / 2; b++) this.blocks[b] = Math.max(this.blocks[2 * b], this.blocks[2 * b + 1]);
      this.count /= 2;
      this.blockSamples *= 2;
    }
  }
}
