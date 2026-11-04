/**
 * A converter for tests: writes a short text instead of audio, so the cache
 * can be tested without ffmpeg. Records what it was asked and how many jobs
 * ran at once.
 */
import fs from "fs";
import nodePath from "path";

import type { AudioConverter, ConvertJob } from "../converter";

export class FakeConverter implements AudioConverter {
  readonly probes: string[] = [];
  readonly conversions: ConvertJob[] = [];
  /** File names (not paths) whose conversion fails after writing part of the output. */
  readonly failing = new Set<string>();
  /** The most conversions that ran at the same time. */
  mostAtOnce = 0;
  private running = 0;
  private readonly losslessInputs: readonly string[];

  constructor(options: { losslessInputs?: readonly string[] } = {}) {
    this.losslessInputs = options.losslessInputs ?? [];
  }

  async isLossless(input: string): Promise<boolean> {
    this.probes.push(input);
    return this.losslessInputs.includes(nodePath.basename(input));
  }

  async convert(job: ConvertJob): Promise<void> {
    this.conversions.push(job);
    this.running++;
    this.mostAtOnce = Math.max(this.mostAtOnce, this.running);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const name = nodePath.basename(job.input);
      if (this.failing.has(name)) {
        await fs.promises.writeFile(job.output, "half a file");
        throw new Error(`Could not convert ${name} (fake failure)`);
      }
      await fs.promises.writeFile(job.output, `${job.target} from ${name}`);
    } finally {
      this.running--;
    }
  }
}
