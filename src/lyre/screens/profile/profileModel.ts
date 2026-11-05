/**
 * The Audio profile's rules in the screen's own units (seconds), ported from the prototype
 * (design/prototype/src/views/profile.js: fmt1, parse, write, range, movePoint, envAt, sketchPath, apreset, addMarker).
 *
 * The library keeps profiles in milliseconds (src/common/domain AudioProfile); the screen works in seconds because
 * every handle moves in whole seconds and every fade in half seconds. `fromDomain` and `toInput` convert.
 */
import { fadeInGain, fadeOutGain, type AfterEnd, type AudioProfile, type AudioProfileInput } from "../../../common/domain";

export interface FadeSec {
  /** Length in seconds. */
  dur: number;
  /** Intensity 0 (gentle) to 100 (sharp); 36-64 is even. */
  shape: number;
}

/** A profile in seconds: what the screen shows and edits. */
export interface Prof {
  start: number;
  end: number;
  after: AfterEnd;
  loopStart: number;
  loopXfade: number;
  fadeIn: FadeSec;
  fadeOut: FadeSec;
  markers: { at: number; label: string }[];
}

/** The points and lengths the handles, fields and steppers change. */
export type Which = "start" | "end" | "loop" | "fadein" | "fadeout" | "xfade";

/** Each point's name in announcements and field labels. */
export const POINT: Record<Which, string> = {
  start: "Start",
  end: "End",
  loop: "Loop start",
  fadein: "Fade in",
  fadeout: "Fade out",
  xfade: "Loop crossfade",
};

/** The loop crossfade is at most this long (the prototype's limit). */
const MAX_XFADE = 10;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** A length rather than a point in the track: moves in half seconds and reads as "4 s". */
export function isLength(which: Which): boolean {
  return which === "fadein" || which === "fadeout" || which === "xfade";
}

/* ---------- times in words ---------- */

/** "5:18": minutes and seconds, rounded (the prototype's L.fmt). */
export function fmt(s: number): string {
  const r = Math.max(0, Math.round(s));
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
}

/** "5:18.0": with tenths, for the position readouts. */
export function fmt1(s: number): string {
  const tenths = Math.floor(Math.max(0, s) * 10 + 1e-6);
  const m = Math.floor(tenths / 600);
  const sec = Math.floor((tenths % 600) / 10);
  return `${m}:${sec < 10 ? "0" : ""}${sec}.${tenths % 10}`;
}

/** A typed time: "4:30", or a bare number of seconds. Lengths (secsOnly) are seconds with at most one decimal. */
export function parseTime(text: string, secsOnly: boolean): number | null {
  const s = String(text).trim();
  if (secsOnly) return /^\d{1,3}(\.\d)?$/.test(s) ? Number(s) : null;
  const m = s.match(/^(\d{1,3})(?::(\d{1,2}))?$/);
  if (!m) return null;
  if (m[2] === undefined) return Number(m[1]);
  return Number(m[2]) > 59 ? null : Number(m[1]) * 60 + Number(m[2]);
}

export function times(n: number): string {
  return n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
}

/** "2.5 s" */
export function secs(n: number): string {
  return `${Math.round(n * 10) / 10} s`;
}

/** A point as words: a time for points, seconds for lengths. */
export function pointText(which: Which, v: number): string {
  return isLength(which) ? secs(v) : fmt(v);
}

/* ---------- conversion ---------- */

export function fromDomain(p: AudioProfile): Prof {
  return {
    start: p.startMs / 1000,
    end: p.endMs / 1000,
    after: p.after,
    loopStart: p.loopStartMs / 1000,
    loopXfade: p.loopCrossfadeMs / 1000,
    fadeIn: { dur: p.fadeIn.ms / 1000, shape: p.fadeIn.shape },
    fadeOut: { dur: p.fadeOut.ms / 1000, shape: p.fadeOut.shape },
    markers: p.markers.map((m) => ({ at: m.atMs / 1000, label: m.label })),
  };
}

const ms = (s: number) => Math.round(s * 1000);

/** The whole profile as the library stores it. */
export function toInput(p: Prof): Required<AudioProfileInput> {
  return {
    startMs: ms(p.start),
    endMs: ms(p.end),
    after: p.after,
    loopStartMs: ms(p.loopStart),
    loopCrossfadeMs: ms(p.loopXfade),
    fadeIn: { ms: ms(p.fadeIn.dur), shape: p.fadeIn.shape },
    fadeOut: { ms: ms(p.fadeOut.dur), shape: p.fadeOut.shape },
    markers: p.markers.map((m) => ({ atMs: ms(m.at), label: m.label })),
  };
}

/* ---------- limits ---------- */

function maxXfade(p: Pick<Prof, "end" | "loopStart">): number {
  // The library keeps it to half the looped part, so no more than two copies of the track sound at once.
  return Math.max(0, Math.min(MAX_XFADE, p.end - p.loopStart - 1, (p.end - p.loopStart) / 2));
}

/** After any change: the loop start between Start and End, both fades inside the played part, the crossfade short enough. */
export function normalise(p: Prof): Prof {
  const span = p.end - p.start;
  const loopStart = clamp(p.loopStart, p.start, p.end - 1);
  const fadeOutDur = clamp(p.fadeOut.dur, 0, span);
  const fadeInDur = clamp(p.fadeIn.dur, 0, span - fadeOutDur);
  const next = { ...p, loopStart, fadeIn: { ...p.fadeIn, dur: fadeInDur }, fadeOut: { ...p.fadeOut, dur: fadeOutDur } };
  return { ...next, loopXfade: clamp(p.loopXfade, 0, maxXfade(next)) };
}

export function valueOf(p: Prof, which: Which): number {
  switch (which) {
    case "start":
      return p.start;
    case "end":
      return p.end;
    case "loop":
      return p.loopStart;
    case "fadein":
      return p.fadeIn.dur;
    case "fadeout":
      return p.fadeOut.dur;
    case "xfade":
      return p.loopXfade;
  }
}

/** The lowest and highest value a point can take now. */
export function rangeOf(p: Prof, dur: number, which: Which): [number, number] {
  const span = p.end - p.start;
  switch (which) {
    case "start":
      return [0, p.end - 1];
    case "end":
      return [p.start + 1, dur];
    case "loop":
      return [p.start, p.end - 1];
    case "fadein":
      return [0, span - p.fadeOut.dur];
    case "fadeout":
      return [0, span - p.fadeIn.dur];
    case "xfade":
      return [0, maxXfade(p)];
  }
}

/** Move one point or length (whole seconds; lengths in half seconds), keeping everything else in order. */
export function movePoint(p: Prof, dur: number, which: Which, v: number): Prof {
  const step = isLength(which) ? 2 : 1;
  const [lo, hi] = rangeOf(p, dur, which);
  const value = clamp(Math.round(v * step) / step, lo, hi);
  switch (which) {
    case "start":
      return normalise({ ...p, start: value });
    case "end":
      return normalise({ ...p, end: value });
    case "loop":
      return normalise({ ...p, loopStart: value });
    case "xfade":
      return normalise({ ...p, loopXfade: value });
    case "fadein":
      return normalise({ ...p, fadeIn: { ...p.fadeIn, dur: value } });
    case "fadeout":
      return normalise({ ...p, fadeOut: { ...p.fadeOut, dur: value } });
  }
}

/** Reset to whole track: Start at 0:00, End at the end of the file, no fades, no crossfade. Markers stay. */
export function wholeTrack(p: Prof, dur: number): Prof {
  return { ...p, start: 0, end: dur, loopStart: 0, loopXfade: 0, fadeIn: { dur: 0, shape: 50 }, fadeOut: { dur: 0, shape: 50 } };
}

/** A marker at the playhead (tenths of a second), named "Marker <n>", in time order. */
export function addMarker(p: Prof, pos: number): { profile: Prof; index: number } {
  const at = Math.round(pos * 10) / 10;
  const markers = [...p.markers.map((m) => ({ ...m })), { at, label: `Marker ${p.markers.length + 1}` }].sort((a, b) => a.at - b.at);
  return { profile: { ...p, markers }, index: markers.findIndex((m) => m.at === at) };
}

/* ---------- the volume line ---------- */

/** The volume at a position: the fade in after Start (not again after a loop) and the fade out before End. */
export function envAt(p: Prof, pos: number, looped: boolean): number {
  if (pos < p.start || pos > p.end) return 1;
  let v = 1;
  if (!looped && p.fadeIn.dur > 0 && pos < p.start + p.fadeIn.dur) v *= fadeInGain((pos - p.start) / p.fadeIn.dur, p.fadeIn.shape);
  if (p.fadeOut.dur > 0 && pos > p.end - p.fadeOut.dur) v *= fadeOutGain((pos - (p.end - p.fadeOut.dur)) / p.fadeOut.dur, p.fadeOut.shape);
  return v;
}

/** The fade's curve, for the small sketch beside the Intensity slider (a 64 × 28 box). */
export function sketchPath(kind: "in" | "out", shape: number): string {
  let d = "";
  for (let i = 0; i <= 30; i++) {
    const u = i / 30;
    const v = kind === "in" ? fadeInGain(u, shape) : fadeOutGain(u, shape);
    d += `${i ? "L" : "M"}${(2 + u * 60).toFixed(1)} ${(3 + (1 - v) * 22).toFixed(1)}`;
  }
  return d;
}
