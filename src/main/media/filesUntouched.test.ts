/**
 * Nik's rule for normalisation (6 Nov 2026): Lyre never changes your files. The level is evened out as Lyre plays
 * them (a gain in the engine, src/player/engine/voice/voice.ts), and the measurement is kept in Lyre's library
 * (track_loudness). Here a real file is imported, measured by the background job with the bundled ffmpeg (loudness
 * and peaks), and read the way the player plays it (mediaResponse, the lyre-media: scheme): its bytes, size and
 * modified time stay as they were, and nothing new appears beside it (no sidecar, no ReplayGain tags).
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { importAudio } from "../data/import";
import { openLibrary } from "../data/library";
import { PeakJobs } from "../data/peaks";
import { trackLoudness } from "../data/repo/loudness";
import { trackPeaks } from "../data/repo/peaks";
import { makeTempFolder } from "../data/test/helpers";
import { findBundledFfmpeg } from "./bundledFfmpeg";
import { FfmpegLoudnessReader, loudnessArgs } from "./ffmpegLoudness";
import { FfmpegPeakReader, peakArgs } from "./ffmpegPeaks";
import { MediaGrants, mediaResponse } from "./mediaProtocol";
import { wavBytes, writeFile } from "./testing/wavFiles";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((fn) => fn()));

/** What a file is: its bytes (by hash), size and modified time, and what else is in its folder. */
function factsOf(file: string) {
  const stat = fs.statSync(file);
  return {
    sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    folder: fs.readdirSync(path.dirname(file)).sort(),
  };
}

describe("Lyre never changes your files (PLY-15, DAT-15)", () => {
  it("ffmpeg only reads: one input, no output file, nothing written into the file's folder", () => {
    for (const args of [loudnessArgs("/m/Bells.flac"), peakArgs("/m/Bells.flac")]) {
      expect(args.filter((a) => a === "-i")).toHaveLength(1);
      // The only output is ffmpeg's null muxer or its own pipe: never a path.
      expect(args[args.length - 1]).toMatch(/^(-|pipe:1)$/);
      expect(args).not.toContain("-y");
      expect(args.join(" ")).not.toMatch(/replaygain|metadata|-map_metadata/i);
    }
  });

  it("measuring and playing a file leave its bytes, size and modified time as they were", async () => {
    const temp = makeTempFolder("lyre-untouched-");
    cleanups.push(temp.cleanup);
    const file = writeFile(path.join(temp.folder, "music"), "Tavern.wav", wavBytes({ seconds: 4, sampleRate: 44100, channels: 2, level: (t) => 0.2 + 0.3 * Math.sin(t) ** 2 }));
    // An older modified time, so a write of any kind would show.
    fs.utimesSync(file, new Date("2026-01-02T03:04:05Z"), new Date("2026-01-02T03:04:05Z"));
    const before = factsOf(file);

    const library = openLibrary({ folder: path.join(temp.folder, "library") });
    cleanups.push(() => library.close());
    const { trackIds } = await importAudio(library.store, { paths: [file] });
    const ffmpegPath = findBundledFfmpeg(process.cwd()) as string;
    const jobs = new PeakJobs(library.store, new FfmpegPeakReader({ ffmpegPath }), {
      onReady: () => undefined,
      notifyEveryMs: 0,
      loudness: new FfmpegLoudnessReader({ ffmpegPath }),
    });
    cleanups.push(() => jobs.close());
    jobs.soon(trackIds[0]);
    await vi.waitFor(() => expect(trackLoudness(library.store, trackIds[0]).state).toBe("ready"), { timeout: 20_000 });
    expect(trackPeaks(library.store, trackIds[0]).state).toBe("ready");

    // Played as the Lyre page plays it: through a lyre-media: address, in parts (seeking) and whole.
    const grants = new MediaGrants();
    const url = grants.grant(1, file);
    const part = await mediaResponse(grants, { url, headers: new Headers({ range: "bytes=0-4095" }) });
    expect(part.status).toBe(206);
    await part.arrayBuffer();
    const whole = await mediaResponse(grants, { url, headers: new Headers() });
    expect(Buffer.from(await whole.arrayBuffer()).length).toBe(before.size);

    expect(factsOf(file)).toEqual(before);
  }, 30_000);
});
