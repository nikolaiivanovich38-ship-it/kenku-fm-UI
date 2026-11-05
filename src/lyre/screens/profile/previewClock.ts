/**
 * The Audio profile's preview clock: where the playhead is while you listen, and what happens when it reaches End.
 * Ported from the prototype (design/prototype/src/views/profile.js: play, pause, stop, seek, advance).
 *
 * The preview plays the real file from the playhead with the profile shown (LyreAudio.previewTrack with startAtMs and
 * profile), and the clock follows where the audio host says it is (`follow`, from its "preview-position" events;
 * `finishClock` when the sound ends by itself). Until the first position arrives (or with no sound at all, as in
 * tests) the clock runs on its own (`advance`, on animation frames). Each step returns the new state and, when
 * something happened, a sentence for the screen reader's live region.
 *
 * BUG-17: Play loops until it is stopped: the loop when the track has one, else Start to End (`heardProfile`). "The
 * last 10 s before End" plays what the players hear after End: a loop goes round until stopped; moving on and
 * stopping are heard once.
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

/** The sound going back by more than this is a loop (positions arrive about every 50 ms). */
const LOOP_JUMP_SECONDS = 0.5;
/** Following a looping sound, the playhead stays this short of End until the sound goes back. */
const BEFORE_END_SECONDS = 0.001;

/** What the live region says when the preview loops back. */
function loopText(p: Prof, loops: number): string {
  return `${p.loopXfade ? `Crossfaded over ${secs(p.loopXfade)} back to ` : "Looped back to "}${fmt(p.loopStart)}${loops > 1 ? ` (${times(loops)})` : ""}`;
}

/**
 * The profile the preview plays in a mode. Play goes round until stopped: a track that loops keeps its loop; any other
 * loops from Start to End, without a crossfade. The last 10 s play the profile as the players hear it.
 */
export function heardProfile(prof: Prof, mode: ClockMode): Prof {
  if (mode === "last10" || prof.after === "loop") return prof;
  return { ...prof, after: "loop", loopStart: prof.start, loopXfade: 0 };
}

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
  const before = s.pos;
  const pos = s.pos + dt;
  if (before < p.end && pos >= p.end) {
    if (p.after === "loop") {
      const loops = s.loops + 1;
      const text = loopText(p, loops);
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

/**
 * Move the clock to where the preview's sound is (`real`, seconds in the file it plays: the next track's during the
 * hand-over). A jump back while looping is a loop; a looping sound is never looped by the clock itself.
 *
 * `first`: the first position after the sound started. Until then the clock ran on its own while the file loaded, so
 * it may be ahead; the playhead goes to where the sound really is, and nothing is counted.
 */
export function follow(s: ClockState, real: number, w: ClockWorld, { first = false }: { first?: boolean } = {}): ClockStep {
  if (!s.playing) return { state: s };
  if (first) {
    return s.handover ? { state: { ...s, handover: { ...s.handover, pos: real } } } : { state: { ...s, pos: Math.min(real, w.dur) } };
  }
  if (s.handover) return advance(s, Math.max(0, real - s.handover.pos), w);
  const p = w.prof;
  if (p.after === "loop" && s.pos < p.end) {
    if (real < s.pos - LOOP_JUMP_SECONDS) {
      const loops = s.loops + 1;
      const text = loopText(p, loops);
      return { state: { ...s, pos: real, loops, since: 0, event: { type: "loop", text } }, say: text };
    }
    real = Math.min(real, p.end - BEFORE_END_SECONDS);
  }
  return advance(s, Math.max(0, real - s.pos), w);
}

/**
 * The preview's sound ended by itself (at End, or the end of the file): the clock goes there and does what the
 * profile says (stop, or move on to the next track). During the hand-over, or a loop that ended, it just stops.
 */
export function finishClock(s: ClockState, w: ClockWorld): ClockStep {
  if (!s.playing) return { state: s };
  const p = w.prof;
  if (s.handover || (p.after === "loop" && s.pos < p.end)) return { state: { ...s, playing: false } };
  const to = s.pos < p.end ? p.end : w.dur;
  return advance(s, to - s.pos + BEFORE_END_SECONDS, w);
}
