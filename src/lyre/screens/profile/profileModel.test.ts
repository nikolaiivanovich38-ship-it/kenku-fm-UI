/**
 * The Audio profile's rules, ported from the prototype (design/prototype/src/views/profile.js): times as the screen
 * writes them, the limits on each point, and how a change keeps Start before End and the fades inside.
 */
import { describe, expect, it } from "vitest";

import {
  addMarker,
  envAt,
  fmt,
  fmt1,
  fromDomain,
  movePoint,
  normalise,
  parseTime,
  rangeOf,
  secs,
  sketchPath,
  times,
  toInput,
  wholeTrack,
  type Prof,
} from "./profileModel";

/** t13's own profile in the sample data: loops from 1:04 to 5:18 with a 2 s crossfade; the file is 7:21 long. */
const T13: Prof = {
  startAt: null,
  start: 0,
  end: 318,
  after: "loop",
  loopStart: 64,
  loopXfade: 2,
  fadeIn: { dur: 0, shape: 50 },
  fadeOut: { dur: 0, shape: 50 },
  markers: [
    { at: 64, label: "Choir enters" },
    { at: 190, label: "Low swell" },
    { at: 318, label: "Loop back" },
  ],
};
const DUR = 441;

describe("times in words", () => {
  it("writes minutes and seconds, rounded, as the prototype's L.fmt", () => {
    expect(fmt(0)).toBe("0:00");
    expect(fmt(64)).toBe("1:04");
    expect(fmt(318.4)).toBe("5:18");
    expect(fmt(441)).toBe("7:21");
  });

  it("writes tenths for the position readout", () => {
    expect(fmt1(0)).toBe("0:00.0");
    expect(fmt1(318)).toBe("5:18.0");
    expect(fmt1(62.37)).toBe("1:02.3");
  });

  it("reads typed times: minutes and seconds, or a bare number of seconds", () => {
    expect(parseTime("4:30", false)).toBe(270);
    expect(parseTime(" 0:08 ", false)).toBe(8);
    expect(parseTime("95", false)).toBe(95);
    expect(parseTime("4:75", false)).toBeNull();
    expect(parseTime("four", false)).toBeNull();
  });

  it("reads lengths as seconds with at most one decimal", () => {
    expect(parseTime("6", true)).toBe(6);
    expect(parseTime("2.5", true)).toBe(2.5);
    expect(parseTime("1:00", true)).toBeNull();
    expect(parseTime("2.25", true)).toBeNull();
  });

  it("counts loops and lengths in plain words", () => {
    expect(times(1)).toBe("once");
    expect(times(2)).toBe("twice");
    expect(times(5)).toBe("5 times");
    expect(secs(2)).toBe("2 s");
    expect(secs(2.54)).toBe("2.5 s");
  });
});

describe("the profile in seconds", () => {
  it("comes from the domain's milliseconds and goes back unchanged", () => {
    const domain = {
      startMs: 0,
      endMs: 318000,
      after: "loop" as const,
      loopStartMs: 64000,
      loopCrossfadeMs: 2000,
      fadeIn: { ms: 0, shape: 50 },
      fadeOut: { ms: 1500, shape: 30 },
      markers: [{ atMs: 64000, label: "Choir enters" }],
      // 0.5.1 Start at.
      startAtMs: 64000,
    };
    const p = fromDomain(domain);
    expect(p.startAt).toBe(64);
    expect(p).toMatchObject({ end: 318, loopStart: 64, loopXfade: 2, fadeOut: { dur: 1.5, shape: 30 }, markers: [{ at: 64, label: "Choir enters" }] });
    expect(toInput(p)).toEqual(domain);
  });
});

describe("moving a point", () => {
  it("keeps End after Start, inside the file, in whole seconds", () => {
    expect(rangeOf(T13, DUR, "end")).toEqual([1, 441]);
    expect(movePoint(T13, DUR, "end", 300.4).end).toBe(300);
    expect(movePoint(T13, DUR, "end", 900).end).toBe(441);
    expect(movePoint({ ...T13, start: 20 }, DUR, "end", 3).end).toBe(21);
  });

  it("keeps the loop start between Start and End when End moves before it", () => {
    const p = movePoint(T13, DUR, "end", 50);
    expect(p.end).toBe(50);
    expect(p.loopStart).toBe(49);
  });

  it("changes fade lengths in half seconds and keeps both fades inside the played part", () => {
    expect(movePoint(T13, DUR, "fadeout", 4.3).fadeOut).toEqual({ dur: 4.5, shape: 50 });
    const short = { ...T13, end: 10, fadeOut: { dur: 6, shape: 50 } };
    expect(rangeOf(short, DUR, "fadein")).toEqual([0, 4]);
    expect(movePoint(short, DUR, "fadein", 9).fadeIn.dur).toBe(4);
  });

  it("keeps the loop crossfade to at most 10 s and half the looped part", () => {
    expect(rangeOf(T13, DUR, "xfade")).toEqual([0, 10]);
    expect(normalise({ ...T13, loopStart: 314 }).loopXfade).toBe(2);
    expect(normalise({ ...T13, loopStart: 315 }).loopXfade).toBe(1.5);
  });

  it("Reset to whole track: 0:00 to the end of the file, no fades", () => {
    const p = wholeTrack({ ...T13, fadeIn: { dur: 3, shape: 20 } }, DUR);
    expect(p).toMatchObject({ start: 0, end: 441, loopStart: 0, loopXfade: 0, fadeIn: { dur: 0, shape: 50 }, fadeOut: { dur: 0, shape: 50 } });
    expect(p.after).toBe("loop");
    expect(p.markers).toHaveLength(3);
  });
});

describe("markers", () => {
  it("adds a marker at the playhead, numbered, in time order, and says where it went", () => {
    const { profile, index } = addMarker(T13, 2.04);
    expect(index).toBe(0);
    expect(profile.markers[0]).toEqual({ at: 2, label: "Marker 4" });
    expect(profile.markers).toHaveLength(4);
  });
});

describe("the volume after fades", () => {
  it("is full outside the fades, rises after Start and falls before End", () => {
    const p = { ...T13, fadeIn: { dur: 4, shape: 50 }, fadeOut: { dur: 8, shape: 50 } };
    expect(envAt(p, 100, false)).toBe(1);
    expect(envAt(p, 2, false)).toBeCloseTo(0.5);
    expect(envAt(p, 2, true)).toBe(1);
    expect(envAt(p, 314, false)).toBeCloseTo(0.5);
  });

  it("draws the fade's curve for the sketch beside the intensity slider", () => {
    expect(sketchPath("out", 50)).toMatch(/^M2\.0 3\.0L/);
    expect(sketchPath("out", 50).endsWith("L62.0 25.0")).toBe(true);
    expect(sketchPath("in", 50).endsWith("L62.0 3.0")).toBe(true);
  });
});
