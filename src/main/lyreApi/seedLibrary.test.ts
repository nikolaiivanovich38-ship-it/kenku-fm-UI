/**
 * Test builds seed the prototype's sample library; DAT-13 shapes are suggested from peaks, so the seeded library
 * also gets the prototype's made-up loudness for every track (its files are not on the test machine).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

import { prototypeSeed } from "../../common/lyre/seed";
import { getDomainLookup, openLibrary, trackPeaks } from "../data";
import { seedLibrary, seedPrototypePeaks } from "./seedLibrary";

describe("seedPrototypePeaks (test builds only)", () => {
  it("keeps the prototype's loudness as each seeded track's peaks, so Lyre suggests the design's shapes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-seed-"));
    const library = openLibrary({ folder: path.join(dir, "library") });
    try {
      const seed = prototypeSeed();
      await seedLibrary(library, seed);
      seedPrototypePeaks(library, seed);
      expect(trackPeaks(library.store, "t02").state).toBe("ready");
      const lookup = getDomainLookup(library.store);
      expect(lookup.track("t02")).toMatchObject({ shape: null, suggestedShape: "peaksThenFalls" });
      // The game master's choice still wins.
      expect(lookup.track("t06")?.shape).toBe("builds");
      expect(library.store.get<{ n: number }>("SELECT count(*) AS n FROM track_peaks")?.n).toBe(seed.tracks.length);
    } finally {
      library.close();
    }
  });
});
