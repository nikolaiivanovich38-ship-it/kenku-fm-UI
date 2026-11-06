import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { shapeFromPeaks } from "../domain";
import { prototypeLevels } from "./prototypeLevels";
import { prototypeSeed } from "./seed";

const seed = prototypeSeed();
const suggested = (id: string) => shapeFromPeaks(prototypeLevels(seed.tracks.find((t) => t.id === id)!));
const titled = (part: string) => seed.tracks.find((t) => t.title.includes(part))!;

describe("the prototype's made-up loudness (core.js L.levels)", () => {
  it("suggests the shapes the approved design shows", () => {
    // t02 has a marker named Peak.
    expect(suggested("t02")).toBe("peaksThenFalls");
    expect(shapeFromPeaks(prototypeLevels(titled("long build to full war")))).toBe("builds");
    expect(shapeFromPeaks(prototypeLevels(titled("Fragile melancholy strings, slow swell")))).not.toBe("builds");
    expect(shapeFromPeaks(prototypeLevels(titled("ethereal voice, resolves")))).toBe("fallsAway");
  });

  it("has the library's thousand levels, the same each time", () => {
    const t = seed.tracks[0];
    expect(prototypeLevels(t)).toHaveLength(1000);
    expect(prototypeLevels(t)).toEqual(prototypeLevels(t));
    expect(prototypeLevels(t).every((v) => v >= 0.05 && v <= 1)).toBe(true);
  });
});

describe("FND-17: one copy of the prototype's loudness", () => {
  it("the seed's peaks are prototypeLevels, at the library's one-byte precision, so the fake and a seeded library agree", () => {
    for (const t of seed.tracks.slice(0, 5)) {
      expect(seed.peaks![t.id]).toEqual(prototypeLevels(t));
      expect(prototypeLevels(t).every((v) => Math.abs(Math.round(v * 255) / 255 - v) < 0.0006)).toBe(true);
    }
  });

  it("src/common/lyre/seed.ts has no curve of its own", () => {
    const source = fs.readFileSync(path.join(__dirname, "seed.ts"), "utf8");
    expect(source).not.toMatch(/function curveOf|0\.28 \+ 0\.62/);
  });
});
