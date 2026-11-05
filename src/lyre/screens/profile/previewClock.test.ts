/**
 * The preview's clock: where the playhead is while you listen, and what happens when it reaches End (loop back, move
 * on to the next track, or stop). Ported from the prototype's play(), advance() and stop() in views/profile.js.
 */
import { describe, expect, it } from "vitest";

import type { Prof } from "./profileModel";
import { advance, initialClock, pauseClock, playClock, seekClock, stopClock, type ClockWorld } from "./previewClock";

const LOOP: Prof = {
  start: 0,
  end: 318,
  after: "loop",
  loopStart: 64,
  loopXfade: 2,
  fadeIn: { dur: 0, shape: 50 },
  fadeOut: { dur: 0, shape: 50 },
  markers: [],
};
const world = (prof: Prof): ClockWorld => ({ prof, dur: 441, next: () => ({ id: "t42", place: "sc:crown:s14:sc3", start: 3, title: "Bells" }) });

/** Runs the clock for `seconds` in steps of a frame, collecting what it said. */
function run(state: ReturnType<typeof initialClock>, w: ClockWorld, seconds: number) {
  const said: string[] = [];
  let s = state;
  for (let t = 0; t < seconds; t += 0.1) {
    const r = advance(s, 0.1, w);
    s = r.state;
    if (r.say) said.push(r.say);
  }
  return { state: s, said };
}

describe("the preview clock", () => {
  it("starts at Start, and plays from the playhead", () => {
    const s = initialClock({ ...LOOP, start: 5 });
    expect(s).toMatchObject({ pos: 5, playing: false, loops: 0 });
    const r = playClock(seekClock(s, 30, 441), "play", world(LOOP));
    expect(r.state).toMatchObject({ playing: true, pos: 30 });
    expect(r.say).toBe("Preview from 0:30");
  });

  it("plays the last 10 s before End and counts a loop when it crosses End", () => {
    const start = playClock(initialClock(LOOP), "last10", world(LOOP));
    expect(start.state.pos).toBe(308);
    expect(start.say).toBe("Preview: the last 10 seconds before End, from 5:08");
    const { state, said } = run(start.state, world(LOOP), 10.5);
    expect(state.loops).toBe(1);
    expect(state.pos).toBeCloseTo(64.4, 0);
    expect(said).toEqual(["Crossfaded over 2 s back to 1:04"]);
  });

  it("after a loop in the last 10 s, stops by itself 5 seconds later", () => {
    const start = playClock(initialClock(LOOP), "last10", world(LOOP));
    const { state, said } = run(start.state, world(LOOP), 16);
    expect(state.playing).toBe(false);
    expect(said).toContain("Preview stopped after the loop");
  });

  it("moves on to the next track and stops a few seconds into it", () => {
    const next = { ...LOOP, after: "next" as const };
    const start = playClock(initialClock(next), "last10", world(next));
    const { state, said } = run(start.state, world(next), 17);
    expect(said[0]).toBe("Moved on to the next track: Bells");
    expect(state.handover).toMatchObject({ id: "t42", place: "sc:crown:s14:sc3" });
    expect(state.playing).toBe(false);
    expect(said).toContain("Preview stopped 6 seconds into the next track");
  });

  it("stops at End when the track stops", () => {
    const stop = { ...LOOP, after: "stop" as const };
    const { state, said } = run(playClock(initialClock(stop), "last10", world(stop)).state, world(stop), 11);
    expect(state).toMatchObject({ playing: false, pos: 318 });
    expect(said).toEqual(["Stopped at End (5:18). On air, Lyre stops here."]);
  });

  it("past End, plays on to the end of the file and says players never hear it", () => {
    const s = playClock(seekClock(initialClock(LOOP), 439, 441), "play", world(LOOP)).state;
    const { state, said } = run(s, world(LOOP), 3);
    expect(state).toMatchObject({ playing: false, pos: 441 });
    expect(said).toEqual(["End of the file. Players never hear the part after End."]);
  });

  it("pauses where it is and stops back at Start", () => {
    const s = run(playClock(initialClock(LOOP), "play", world(LOOP)).state, world(LOOP), 2).state;
    const paused = pauseClock(s);
    expect(paused.playing).toBe(false);
    expect(paused.pos).toBeCloseTo(2, 0);
    expect(stopClock(paused, LOOP)).toMatchObject({ playing: false, pos: 0, loops: 0, event: null });
  });
});
