/**
 * PLY-15, DAT-15: volume normalisation rules, as design/prototype/src/core.js (L.normDecision, L.normaliseGain,
 * L.normLine, L.normHover) and design/prototype/ROUND5.md "Volume normalisation" give them.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIBRARY_NORMALISE,
  dbToGain,
  formatGainDb,
  MAX_BOOST_DB,
  normaliseDecision,
  normaliseGain,
  normaliseHover,
  normaliseLine,
  normalisedGainDb,
  NORMALISE_TARGET_LUFS,
  PEAK_CEILING_DBTP,
  playlistNormaliseLine,
  type NormalisedTrack,
} from "./normalise";

const loud = (lufs: number, truePeakDb: number) => ({ lufs, truePeakDb });
const OFF = DEFAULT_LIBRARY_NORMALISE;
const ON = { on: true, target: "standard" } as const;

describe("the library's setting", () => {
  it("is off at first, with Standard (-18 LUFS) as the target", () => {
    expect(DEFAULT_LIBRARY_NORMALISE).toEqual({ on: false, target: "standard" });
    expect(NORMALISE_TARGET_LUFS).toEqual({ quiet: -23, standard: -18, loud: -14 });
    expect(MAX_BOOST_DB).toBe(12);
    expect(PEAK_CEILING_DBTP).toBe(-1);
  });
});

describe("normaliseDecision: the most specific choice wins", () => {
  it("the track's own choice comes first, wherever it plays", () => {
    expect(normaliseDecision("off", "on", ON)).toEqual({ on: false, from: "track" });
    expect(normaliseDecision("on", "off", OFF)).toEqual({ on: true, from: "track" });
  });
  it("then the playlist it plays from", () => {
    expect(normaliseDecision(null, "on", OFF)).toEqual({ on: true, from: "playlist" });
    expect(normaliseDecision(undefined, "off", ON)).toEqual({ on: false, from: "playlist" });
  });
  it("then the library", () => {
    expect(normaliseDecision(null, null, OFF)).toEqual({ on: false, from: "library" });
    expect(normaliseDecision(null, undefined, ON)).toEqual({ on: true, from: "library" });
  });
});

describe("normaliseGain: target minus measured, at most +12 dB, true peak kept at or below -1 dBTP", () => {
  it("brings a track to the target", () => {
    expect(normaliseGain(loud(-22.6, -8.0), -18)).toEqual({ gainDb: 4.6, limit: null });
    expect(normaliseGain(loud(-13.1, -0.3), -18)).toEqual({ gainDb: -4.9, limit: null });
  });
  it("lowers a boost that would push the true peak above -1 dBTP", () => {
    expect(normaliseGain(loud(-26.4, -9.1), -18)).toEqual({ gainDb: 8.1, limit: "peak" });
    expect(normaliseGain(loud(-22.6, -8.0), -14)).toEqual({ gainDb: 7, limit: "peak" });
  });
  it("turns a track down when its peak is already above -1 dBTP, so nothing evened out goes past it", () => {
    expect(normaliseGain(loud(-18.5, 0.4), -18)).toEqual({ gainDb: -1.4, limit: "peak" });
  });
  it("adds no more than +12 dB", () => {
    expect(normaliseGain(loud(-31.5, -14.2), -18)).toEqual({ gainDb: 12, limit: "cap" });
  });
  it("gives the gain to a tenth of a decibel", () => {
    expect(normaliseGain(loud(-20.04, -10), -18)!.gainDb).toBe(2);
    expect(normaliseGain(loud(-20.06, -10), -18)!.gainDb).toBe(2.1);
  });
  it("has nothing for a track not measured yet", () => {
    expect(normaliseGain(null, -18)).toBeNull();
    expect(normaliseGain(undefined, -18)).toBeNull();
  });
});

describe("normalisedGainDb: what the engine applies", () => {
  const track = (normalise: "on" | "off" | null, loudness = loud(-22.6, -8.0)) => ({ normalise, loudness });
  it("is the gain when normalising is on where it plays, at the library's target", () => {
    expect(normalisedGainDb(track("on"), null, OFF)).toBe(4.6);
    expect(normalisedGainDb(track(null), { normalise: "on" }, { on: false, target: "loud" })).toBe(7);
    expect(normalisedGainDb(track(null), null, { on: true, target: "quiet" })).toBe(-0.4);
  });
  it("is 0 when it is off there, or the track is not measured yet (it plays as it is)", () => {
    expect(normalisedGainDb(track(null), null, OFF)).toBe(0);
    expect(normalisedGainDb(track("off"), { normalise: "on" }, ON)).toBe(0);
    expect(normalisedGainDb({ normalise: "on", loudness: null }, null, ON)).toBe(0);
    expect(normalisedGainDb(undefined, null, ON)).toBe(0);
  });
  it("turns decibels into the factor a gain node takes", () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
    expect(dbToGain(12)).toBeCloseTo(3.981, 3);
  });
});

describe("the words the screens show", () => {
  it("writes a gain with its sign", () => {
    expect(formatGainDb(4.6)).toBe("+4.6 dB");
    expect(formatGainDb(-2.25)).toBe("-2.3 dB");
    expect(formatGainDb(0)).toBe("0.0 dB");
    expect(formatGainDb(-0.04)).toBe("0.0 dB");
  });
  it("the measured line: loudness and the gain there", () => {
    expect(normaliseLine({ normalise: "on", loudness: loud(-22.6, -8.0) }, null, OFF)).toBe("-22.6 LUFS · +4.6 dB");
    expect(normaliseLine({ normalise: null, loudness: loud(-22.6, -8.0) }, null, OFF)).toBe("-22.6 LUFS · plays as it is");
    expect(normaliseLine({ normalise: "on", loudness: loud(-26.4, -9.1) }, null, OFF)).toBe("-26.4 LUFS · +8.1 dB (kept under -1 dBTP)");
    expect(normaliseLine({ normalise: "on", loudness: loud(-31.5, -14.2) }, null, OFF)).toBe("-31.5 LUFS · +12.0 dB (the most Lyre adds)");
    expect(normaliseLine({ normalise: "on", loudness: null }, null, OFF)).toBe("Not measured yet: plays as it is");
  });
  it("the hover where it plays", () => {
    expect(normaliseHover({ normalise: null, loudness: loud(-15.8, -0.9) }, { normalise: "on" }, OFF)).toBe("Volume evened out: -2.2 dB (-15.8 LUFS measured)");
    expect(normaliseHover({ normalise: null, loudness: loud(-15.8, -0.9) }, null, OFF)).toBe("Volume not evened out");
    expect(normaliseHover({ normalise: "on", loudness: null }, null, OFF)).toBe("Volume not evened out: not measured yet");
  });
  it("a playlist's line: the range its tracks get there", () => {
    const tracks: NormalisedTrack[] = [
      { normalise: null, loudness: loud(-15.8, -0.9) },
      { normalise: null, loudness: loud(-19.1, -4.9) },
      { normalise: "off", loudness: loud(-22.7, -10.6) },
      { normalise: null, loudness: loud(-20.7, -9.1) },
    ];
    expect(playlistNormaliseLine(tracks, { normalise: "on" }, OFF)).toBe("Its tracks get -2.2 dB to +2.7 dB here; 1 plays as it is");
    expect(playlistNormaliseLine(tracks, { normalise: null }, OFF)).toBe("Its tracks play as they are");
    expect(playlistNormaliseLine(tracks.slice(0, 1), { normalise: "on" }, OFF)).toBe("Its tracks get -2.2 dB here");
    expect(playlistNormaliseLine([{ normalise: null, loudness: null }, tracks[2], tracks[2]], { normalise: "on" }, OFF)).toBe("2 play as they are; 1 not measured yet");
  });
});
