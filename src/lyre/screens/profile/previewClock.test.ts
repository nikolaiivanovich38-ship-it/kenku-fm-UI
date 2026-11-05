/**
 * The preview's clock: where the playhead is while you listen, and what happens when it reaches End (loop back, move
 * on to the next track, or stop). Ported from the prototype's play(), advance() and stop() in views/profile.js.
 */
import { describe, expect, it } from "vitest";

import type { Prof } from "./profileModel";
import { advance, finishClock, follow, initialClock, pauseClock, playClock, seekClock, stopClock, type ClockWorld } from "./previewClock";

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

describe("the clock following the real preview (its position from the audio host)", () => {
  const playing = (prof: Prof, pos: number) => playClock(seekClock(initialClock(prof), pos, 441), "play", world(prof)).state;

  it("moves the playhead to where the sound is", () => {
    const r = follow(playing(LOOP, 30), 31.2, world(LOOP));
    expect(r.state).toMatchObject({ pos: 31.2, playing: true, loops: 0 });
    expect(r.say).toBeUndefined();
  });

  it("counts a loop when the sound jumps back to Loop start, and says how it went back", () => {
    let s = follow(playing(LOOP, 316), 317.95, world(LOOP)).state;
    expect(s).toMatchObject({ pos: 317.95, loops: 0 });
    const r = follow(s, 64.3, world(LOOP));
    expect(r.state).toMatchObject({ pos: 64.3, loops: 1, event: { type: "loop" } });
    expect(r.say).toBe("Crossfaded over 2 s back to 1:04");
    s = follow(follow(r.state, 317.9, world(LOOP)).state, 64.1, world(LOOP)).state;
    expect(s.loops).toBe(2);
  });

  it("does not loop by itself just past End: it waits for the sound to go back", () => {
    const r = follow(playing(LOOP, 317), 318.04, world(LOOP));
    expect(r.state).toMatchObject({ loops: 0, event: null });
    expect(r.state.pos).toBeLessThan(318);
  });

  it("stops at End when the profile stops there", () => {
    const stop = { ...LOOP, after: "stop" as const };
    const r = follow(playing(stop, 317), 318.02, world(stop));
    expect(r.state).toMatchObject({ playing: false, pos: 318, event: { type: "stop" } });
  });

  it("follows the next track during the hand-over, and stops a few seconds into it", () => {
    const next = { ...LOOP, after: "next" as const };
    const handed = follow(playing(next, 317.5), 318.01, world(next)).state;
    expect(handed.handover).toMatchObject({ id: "t42", pos: 3 });
    const r = follow(handed, 7, world(next));
    expect(r.state.handover?.pos).toBe(7);
    expect(r.state.playing).toBe(true);
    const done = follow(r.state, 13.5, world(next));
    expect(done.state.playing).toBe(false);
    expect(done.say).toBe("Preview stopped 10 seconds into the next track");
  });

  it("when the sound ends by itself, the clock goes to End (or the end of the file) and does what the profile says", () => {
    const next = { ...LOOP, after: "next" as const };
    expect(finishClock(playing(next, 317.9), world(next)).state.handover?.id).toBe("t42");
    const stop = { ...LOOP, after: "stop" as const };
    expect(finishClock(playing(stop, 317.9), world(stop)).state).toMatchObject({ playing: false, event: { type: "stop" } });
    expect(finishClock(playing(LOOP, 400), world(LOOP)).state).toMatchObject({ playing: false, pos: 441, event: { type: "eof" } });
  });

  it("does nothing while paused", () => {
    const paused = pauseClock(playing(LOOP, 30));
    expect(follow(paused, 40, world(LOOP)).state).toBe(paused);
  });
});

describe("the first position after the sound starts (review w3-polish 2)", () => {
  const short = { ...LOOP, end: 10, loopStart: 3, loopXfade: 0 };
  const w = { prof: short, dur: 20, next: () => null };
  const ranAhead = (prof: Prof) => {
    let s = playClock({ ...initialClock(prof), pos: 5 }, "play", { ...w, prof }).state;
    for (let i = 0; i < 48; i++) s = advance(s, 1 / 60, { ...w, prof }).state; // 0.8 s of frames while the file loads
    return s;
  };

  it("is where the playhead goes, without counting a loop, though the clock ran ahead while the file loaded", () => {
    const s = ranAhead(short);
    expect(s.pos).toBeCloseTo(5.8, 1);
    const r = follow(s, 5.0, w, { first: true });
    expect(r.state).toMatchObject({ pos: 5, loops: 0, event: null });
    expect(r.say).toBeUndefined();
  });

  it("puts the playhead back for a profile that stops too, so it does not freeze until the sound catches up", () => {
    const stop = { ...short, after: "stop" as const };
    const s = ranAhead(stop);
    expect(follow(s, 5.0, { ...w, prof: stop }, { first: true }).state.pos).toBe(5);
  });
});

