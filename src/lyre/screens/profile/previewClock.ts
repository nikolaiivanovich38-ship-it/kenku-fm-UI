/**
 * The Audio profile's preview clock: where the playhead is while you listen, and what happens when it reaches End.
 * Ported from the prototype (design/prototype/src/views/profile.js: play, pause, stop, seek, advance).
 *
 * The clock is the screen's own: the audio host cannot yet say where its preview is, nor play from a point with a
 * profile (see the w3-profile section in docs/ARCHITECTURE.md). Each step returns the new state and, when something
 * happened, a sentence for the screen reader's live region.
 */
import { clamp, fmt, secs, times, type Prof } from "./profileModel";

export type ClockMode = "play" | "last10";

export interface ClockEvent {
  type: "loop" | "next" | "stop" | "eof";
  text: string;
}

/** After End, when the track moves on: the next track, and how far into it the preview is. */
export interface Handover {
  id: string;
  place: string;
  title: string;
  pos: number;
  /** The preview stops this many seconds into the next track. */
  limit: number;
}

export interface ClockState {
  pos: number;
  playing: boolean;
  mode: ClockMode;
  loops: number;
  event: ClockEvent | null;
  handover: Handover | null;
  /** Seconds since the last event (a loop or the hand-over). */
  since: number;
}

/** What the clock needs to know: the profile being heard, the file's length, and what plays next. */
export interface ClockWorld {
  prof: Prof;
  dur: number;
  next(): { id: string; place: string; start: number; title: string } | null;
}

export interface ClockStep {
  state: ClockState;
  say?: string;
}

/** After a loop in "the last 10 s", the preview goes on this long, then stops. */
const AFTER_LOOP_SECONDS = 5;

export function initialClock(prof: Prof): ClockState {
  return { pos: prof.start, playing: false, mode: "play", loops: 0, event: null, handover: null, since: 0 };
}

export function playClock(s: ClockState, mode: ClockMode, w: ClockWorld): ClockStep {
  const next: ClockState = { ...s, mode, event: null, handover: null, since: 0, playing: true };
  if (mode === "last10") {
    next.pos = Math.max(w.prof.start, w.prof.end - 10);
    next.loops = 0;
  } else if (s.pos >= w.dur - 0.05) {
    next.pos = w.prof.start;
    next.loops = 0;
  }
  return {
    state: next,
    say: mode === "last10" ? `Preview: the last 10 seconds before End, from ${fmt(next.pos)}` : `Preview from ${fmt(next.pos)}`,
  };
}

export function pauseClock(s: ClockState): ClockState {
  return { ...s, playing: false };
}

/** Stop and go back to Start. */
export function stopClock(s: ClockState, prof: Prof): ClockState {
  return { ...s, playing: false, handover: null, event: null, mode: "play", loops: 0, pos: prof.start };
}

export function seekClock(s: ClockState, v: number, dur: number): ClockState {
  return { ...s, pos: clamp(v, 0, dur), handover: null, event: null };
}

/** Move the clock on by dt seconds. */
export function advance(s: ClockState, dt: number, w: ClockWorld): ClockStep {
  const p = w.prof;
  if (!s.playing) return { state: s };
  if (s.handover) {
    const handover = { ...s.handover, pos: s.handover.pos + dt };
    const since = s.since + dt;
    if (since >= handover.limit) {
      return { state: { ...s, handover, since, playing: false }, say: `Preview stopped ${Math.round(handover.limit)} seconds into the next track` };
    }
    return { state: { ...s, handover, since } };
  }
  if (s.event?.type === "loop" && s.mode === "last10") {
    const since = s.since + dt;
    if (since >= AFTER_LOOP_SECONDS) return { state: { ...s, since, pos: s.pos + dt, playing: false }, say: "Preview stopped after the loop" };
    s = { ...s, since };
  }
  const before = s.pos;
  const pos = s.pos + dt;
  if (before < p.end && pos >= p.end) {
    if (p.after === "loop") {
      const loops = s.loops + 1;
      const text = `${p.loopXfade ? `Crossfaded over ${secs(p.loopXfade)} back to ` : "Looped back to "}${fmt(p.loopStart)}${loops > 1 ? ` (${times(loops)})` : ""}`;
      return { state: { ...s, pos: p.loopStart + (pos - p.end), loops, since: 0, event: { type: "loop", text } }, say: text };
    }
    const n = p.after === "next" ? w.next() : null;
    if (n) {
      const text = `Moved on to the next track: ${n.title}`;
      return {
        state: { ...s, pos: p.end, since: 0, handover: { id: n.id, place: n.place, title: n.title, pos: n.start, limit: s.mode === "last10" ? 6 : 10 }, event: { type: "next", text } },
        say: text,
      };
    }
    const text = `Stopped at End (${fmt(p.end)}). On air, Lyre stops here.`;
    return { state: { ...s, pos: p.end, playing: false, event: { type: "stop", text } }, say: text };
  }
  if (pos >= w.dur) {
    const text = "End of the file. Players never hear the part after End.";
    return { state: { ...s, pos: w.dur, playing: false, event: { type: "eof", text } }, say: text };
  }
  return { state: { ...s, pos } };
}
