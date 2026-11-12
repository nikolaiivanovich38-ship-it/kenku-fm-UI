/**
 * How each pass of a voice plays: where it starts and ends in the media, where
 * a loop goes back to, how long two passes overlap, and the gain of a pass at
 * any position. The voice turns `points()` into gain ramps on the audio
 * timeline, so fades are scheduled ahead of time instead of being stepped by a
 * timer (PERF-1) and land on the exact sample.
 *
 * Two kinds of plan:
 * - `plainPlan`: the original options (straight fades, a loop over the whole
 *   media whose cross-fade is the fade-out).
 * - `profilePlan` (PLY-12): a track's audio profile. Gains come from the
 *   design's `envelopeAt` (fade in after Start, not again after a loop; fade out
 *   before End), times a straight loop crossfade between passes.
 */
import { AudioProfile, envelopeAt } from "../../common/domain";

export interface PassPlan {
  /** Where the first pass starts, in seconds of media. */
  readonly startAt: number;
  /** Where every pass stops, in seconds of media; Infinity: at the end of the media. */
  readonly endAt: number;
  readonly loop: boolean;
  /** Where each pass after the first starts. */
  readonly loopFrom: number;
  /** How long a loop pass starts before the one before it reaches End. */
  readonly overlap: number;
  /** A loop over the whole media with no shaping per pass: the layer can loop by itself (gapless). */
  readonly native: boolean;
  /** The gain of a pass at `position`; `looped` for every pass after the first. */
  gainAt(position: number, looped: boolean): number;
  /** Positions where the gain changes the way it moves (fade edges), for sampling. */
  readonly edges: readonly number[];
}

export interface GainPoint {
  position: number;
  gain: number;
}

/** Curved stretches are drawn as this many straight ramps (Web Audio ramps are straight). */
const CURVE_STEPS = 24;

/**
 * The gain of a pass from `from` to `to` as a list of points to ramp between.
 * Straight stretches get their two ends only; curved ones are sampled.
 */
export function points(plan: PassPlan, from: number, to: number, looped: boolean): GainPoint[] {
  const at = (position: number): GainPoint => ({ position, gain: plan.gainAt(position, looped) });
  if (!(to > from)) {
    return [at(from)];
  }
  const cuts = [from, ...plan.edges.filter((edge) => edge > from && edge < to), to];
  const out: GainPoint[] = [at(from)];
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1];
    const b = cuts[i];
    if (!Number.isFinite(b)) {
      break;
    }
    if (isStraight(plan, a, b, looped)) {
      out.push(at(b));
      continue;
    }
    for (let step = 1; step <= CURVE_STEPS; step++) {
      out.push(at(a + ((b - a) * step) / CURVE_STEPS));
    }
  }
  return out;
}

function isStraight(plan: PassPlan, a: number, b: number, looped: boolean): boolean {
  const ga = plan.gainAt(a, looped);
  const gb = plan.gainAt(b, looped);
  return [0.25, 0.5, 0.75].every((f) => Math.abs(plan.gainAt(a + (b - a) * f, looped) - (ga + (gb - ga) * f)) < 1e-4);
}

/** The original options: straight fades over the whole media. */
export function plainPlan(
  options: { loop: boolean; fadeInSeconds: number; fadeOutSeconds: number; startAt: number },
  duration: number,
): PassPlan {
  const known = Number.isFinite(duration);
  const endAt = known ? duration : Infinity;
  // A loop's cross-fade can be at most half a pass, so no more than two passes ever sound together.
  const fadeOut = known ? Math.min(options.fadeOutSeconds, options.loop ? duration / 2 : duration) : 0;
  const { fadeInSeconds, loop, startAt } = options;
  const ramp = (x: number) => Math.max(0, Math.min(1, x));
  return {
    startAt,
    endAt,
    loop,
    loopFrom: 0,
    overlap: loop ? fadeOut : 0,
    native: loop && options.fadeOutSeconds <= 0,
    edges: [startAt + fadeInSeconds, fadeInSeconds, endAt - fadeOut],
    gainAt(position, looped) {
      const from = looped ? 0 : startAt;
      let gain = fadeInSeconds > 0 ? ramp((position - from) / fadeInSeconds) : 1;
      if (fadeOut > 0 && position > endAt - fadeOut) {
        gain *= ramp((endAt - position) / fadeOut);
      }
      return gain;
    },
  };
}

/**
 * A track's audio profile (milliseconds) as a pass plan (seconds), fitted to
 * the media's real length when it is known. `startAt` (seconds) starts the
 * first pass elsewhere, e.g. where a scene was when Undo brings it back.
 */
export function profilePlan(input: AudioProfile, duration: number, startAt?: number): PassPlan {
  const lengthMs = Number.isFinite(duration) ? duration * 1000 : Infinity;
  const endMs = Math.min(input.endMs, lengthMs);
  const startMs = Math.min(input.startMs, endMs);
  const span = endMs - startMs;
  const profile: AudioProfile = {
    ...input,
    startMs,
    endMs,
    loopStartMs: Math.min(Math.max(input.loopStartMs, startMs), endMs),
    fadeIn: { ...input.fadeIn, ms: Math.min(input.fadeIn.ms, span) },
    fadeOut: { ...input.fadeOut, ms: Math.min(input.fadeOut.ms, span) },
  };
  const endAt = endMs / 1000;
  const loopFrom = profile.loopStartMs / 1000;
  const loop = profile.after === "loop" && endAt > loopFrom;
  // Two passes at most: the crossfade is never more than half the looped part.
  const overlap = loop ? Math.min(profile.loopCrossfadeMs / 1000, (endAt - loopFrom) / 2) : 0;
  // BUG-22: a file shorter than the profile's End (it was replaced, and Lyre still has the old length). A start at or
  // past the file's real end keeps its distance before End ("the last 10 s" are the file's last 10 s), so the preview
  // never starts at the end and goes round its loop with no sound.
  const asked = Math.max(startAt ?? startMs / 1000, 0);
  const shortBy = input.endMs / 1000 - endAt;
  const shifted = shortBy > 0 && asked >= endAt ? Math.max(startMs / 1000, asked - shortBy) : asked;
  const first = Math.min(shifted, endAt);
  const fadeInEnd = (startMs + profile.fadeIn.ms) / 1000;
  const fadeOutStart = (endMs - profile.fadeOut.ms) / 1000;
  return {
    startAt: first,
    endAt,
    loop,
    loopFrom,
    overlap,
    native: loop && overlap <= 0 && loopFrom <= 0 && endMs >= lengthMs && profile.fadeOut.ms <= 0,
    edges: [fadeInEnd, fadeOutStart, loopFrom + overlap, endAt - overlap],
    gainAt(position, looped) {
      let gain = envelopeAt(profile, position * 1000, looped);
      if (overlap > 0) {
        if (looped && position < loopFrom + overlap) {
          gain *= Math.max(0, (position - loopFrom) / overlap);
        }
        if (position > endAt - overlap) {
          gain *= Math.max(0, (endAt - position) / overlap);
        }
      }
      return gain;
    },
  };
}
