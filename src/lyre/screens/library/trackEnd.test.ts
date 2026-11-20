import { describe, expect, it } from "vitest";
import type { DomainTrack } from "../../../common/domain";
import { endIsUsual, endOf, endWords, endWrite, placeEndProfile, usesFor, usualEnd, useEndSummary } from "./trackEnd";

const track = (over: Partial<DomainTrack> = {}): DomainTrack => ({
  id: "t1",
  kind: "music",
  title: "Ashes",
  metaTitle: "",
  fileName: "ashes.flac",
  durationMs: 200_000,
  role: null,
  loop: null,
  energy: null,
  tags: {},
  ...over,
});

describe("Use it for", () => {
  it("offers the four music uses, and Sound effect or Short cue for an FX track", () => {
    expect(usesFor(track()).map((u) => u.word)).toEqual(["Background", "Scene music", "Short cue", "Lead-in"]);
    expect(usesFor(track({ kind: "fx" })).map((u) => u.word)).toEqual(["Sound effect", "Short cue"]);
  });

  it("each use has a usual end; ambience with no use loops, anything else moves on", () => {
    expect(usualEnd(track({ role: "loop_bed" }))).toBe("xloop");
    expect(usualEnd(track({ role: "underscore" }))).toBe("next");
    expect(usualEnd(track({ role: "sting" }))).toBe("stop");
    expect(usualEnd(track({ role: "transition" }))).toBe("fade");
    expect(usualEnd(track({ kind: "amb" }))).toBe("loop");
    expect(usualEnd(track())).toBe("next");
  });
});

describe("At its end, read from the settings the track has", () => {
  it("a track with nothing chosen moves on; its loop advice loops it, with a crossfade when it says so", () => {
    expect(endOf(track())).toBe("next");
    expect(endOf(track({ loop: "yes" }))).toBe("loop");
    expect(endOf(track({ loop: "crossfade" }))).toBe("xloop");
    expect(endOf(track({ kind: "amb" }))).toBe("loop");
  });

  it("follows the engine's role ends when no profile chose After, and a sting never loops", () => {
    expect(endOf(track({ role: "loop_bed" }))).toBe("loop");
    expect(endOf(track({ role: "loop_bed", loop: "crossfade" }))).toBe("xloop");
    expect(endOf(track({ role: "effect", kind: "fx" }))).toBe("stop");
    expect(endOf(track({ role: "sting", profile: { after: "loop" } }))).toBe("next");
  });

  it("the profile's After, crossfade and fade out, and the track's Follow with and Fades out", () => {
    expect(endOf(track({ profile: { after: "loop", loopCrossfadeMs: 2000 } }))).toBe("xloop");
    expect(endOf(track({ loop: "crossfade", profile: { after: "loop", loopCrossfadeMs: 0 } }))).toBe("loop");
    expect(endOf(track({ profile: { after: "stop" } }))).toBe("stop");
    expect(endOf(track({ profile: { after: "stop", fadeOut: { ms: 3000, shape: 50 } } }))).toBe("fade");
    expect(endOf(track({ fadesOut: true }))).toBe("fade");
    expect(endOf(track({ follow: { kind: "playlist", id: "p1" } }))).toBe("follow");
  });

  it("at another place only the profile counts", () => {
    const t = track({ fadesOut: true, follow: { kind: "track", id: "t2" } });
    expect(endOf(t, { after: "next" }, false)).toBe("next");
    expect(endOf(t, { after: "loop" }, false)).toBe("loop");
  });
});

describe("At its end, written to the settings the track has", () => {
  it("each end writes the loop advice, Fades out and Follow with, and the profile's After", () => {
    const own = { startMs: 1000, fadeOut: { ms: 5000, shape: 70 } };
    expect(endWrite("loop", own)).toEqual({ track: { loop: "yes", fadesOut: false, follow: null }, profile: { ...own, after: "loop", loopCrossfadeMs: 0 } });
    expect(endWrite("xloop", own).profile).toMatchObject({ after: "loop", loopCrossfadeMs: 3000 });
    expect(endWrite("xloop", { loopCrossfadeMs: 1500 }).profile.loopCrossfadeMs).toBe(1500);
    expect(endWrite("next", own).profile).toEqual({ startMs: 1000, after: "next", fadeOut: { ms: 0, shape: 70 } });
    expect(endWrite("fade", own)).toEqual({ track: { loop: "no", fadesOut: true, follow: null }, profile: { ...own, after: "next" } });
    // After Next track wrote a fade out of 0 s, Fade out gives it 4 s again (a named 0 s would silence Fades out).
    expect(endWrite("fade", endWrite("next", null).profile).profile.fadeOut).toEqual({ ms: 4000, shape: 50 });
    expect(endWrite("stop", null).profile).toEqual({ after: "stop", fadeOut: { ms: 0, shape: 50 } });
    const ref = { kind: "playlist", id: "p-crypt" } as const;
    expect(endWrite("follow", null, ref).track.follow).toEqual(ref);
  });

  it("reads back as the end that was written, for every end", () => {
    for (const end of ["loop", "xloop", "next", "fade", "stop", "follow"] as const) {
      const w = endWrite(end, null, { kind: "track", id: "t9" });
      expect(endOf(track({ ...w.track, profile: w.profile })), end).toBe(end);
    }
  });

  it("at another place Fade out gives the place a fade out of its own", () => {
    expect(placeEndProfile("fade", null)).toEqual({ after: "next", fadeOut: { ms: 4000, shape: 50 } });
    expect(placeEndProfile("fade", { fadeOut: { ms: 8000, shape: 30 } }).fadeOut).toEqual({ ms: 8000, shape: 30 });
    expect(endOf(track(), placeEndProfile("fade", null), false)).toBe("fade");
  });

  it("a use picks its usual end only while the end is still the usual one", () => {
    expect(endIsUsual(track())).toBe(true);
    expect(endIsUsual(track({ profile: { after: "stop" } }))).toBe(false);
    expect(endIsUsual(track({ role: "sting", profile: { after: "stop" } }))).toBe(true);
  });
});

describe("the summary line", () => {
  it("names the use, the end and Next time, start where it stopped", () => {
    expect(useEndSummary(track({ role: "loop_bed", loop: "crossfade", resume: true }), "", true)).toBe("Background · loops with a 3 s crossfade · starts where it stopped.");
    expect(useEndSummary(track({ follow: { kind: "playlist", id: "p" } }), "Crypt ambush", false)).toBe("Then plays Crypt ambush.");
    expect(endWords(track({ fadesOut: true }), "")).toBe("fades out");
  });
});
