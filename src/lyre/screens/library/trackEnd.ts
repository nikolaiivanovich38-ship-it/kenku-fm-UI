/**
 * Round 9 (ROUND9.md §3, item 18: "Need to be have more intuitive roles than we currently do") and round 10 (prep
 * review D5): a track's use and its end in plain words, as design/prototype/src/views/r9track.js has them.
 *
 * Use it for: Background, Scene music, Short cue, Lead-in (Sound effect for FX tracks). The stored roles stay the old
 * ones (loop_bed, underscore, sting, transition, effect), so playback, dynamic rules and the FX filter are unchanged;
 * only the words are new.
 *
 * At its end: Loop, Loop with a crossfade, Next track, Fade out, Stop, Play…. One choice, read from and written to the
 * settings the app already has: the track's loop advice, Ending "Fades out", Follow with, and the audio profile's
 * After, loop crossfade and fade out (no new stored field). The Library's details write the track's own profile; the
 * Audio profile writes the place it shows.
 */
import { resolveProfile, type AudioProfileInput, type DomainTrack, type LoopAdvice, type SoundRef, type TrackRole } from "../../../common/domain";

export type TrackEnd = "loop" | "xloop" | "next" | "fade" | "stop" | "follow";

/** A use as the screens offer it: the stored role, its words, its line on hover and for screen readers, its icon. */
export interface UseChoice {
  role: TrackRole;
  word: string;
  line: string;
  icon: "loop" | "note" | "bolt" | "right" | "sfx";
}

const MUSIC_USES: readonly UseChoice[] = [
  { role: "loop_bed", word: "Background", line: "Sits under the scene and keeps going", icon: "loop" },
  { role: "underscore", word: "Scene music", line: "Plays through, then the next track", icon: "note" },
  { role: "sting", word: "Short cue", line: "A few seconds for a moment, then stops", icon: "bolt" },
  { role: "transition", word: "Lead-in", line: "Leads into the next scene or track", icon: "right" },
];
const SOUND_EFFECT: UseChoice = { role: "effect", word: "Sound effect", line: "A sound over the music", icon: "sfx" };

/** The uses a track can have: an FX track is a Sound effect or a Short cue; music and ambience the four music uses. */
export function usesFor(track: Pick<DomainTrack, "kind">): readonly UseChoice[] {
  return track.kind === "fx" ? [SOUND_EFFECT, MUSIC_USES[2]] : MUSIC_USES;
}

/** The words for a stored role, wherever a role is named (the planner's rows, Live, a picker). */
export const USE_WORDS: Record<TrackRole, string> = {
  loop_bed: "Background",
  underscore: "Scene music",
  sting: "Short cue",
  transition: "Lead-in",
  effect: "Sound effect",
};

/** The six ends, in the order and words of both the track's details and the Audio profile. */
export const ENDS: readonly (readonly [TrackEnd, string])[] = [
  ["loop", "Loop"],
  ["xloop", "Loop with a crossfade"],
  ["next", "Next track"],
  ["fade", "Fade out"],
  ["stop", "Stop"],
  ["follow", "Play…"],
];

/** The end a use picks while the game master has not picked one himself. */
const USUAL_END: Record<TrackRole, TrackEnd> = { loop_bed: "xloop", underscore: "next", sting: "stop", transition: "fade", effect: "stop" };

/** The end a track has when nothing was chosen: its use's usual end; ambience loops; anything else moves on. */
export function usualEnd(track: Pick<DomainTrack, "role" | "kind">): TrackEnd {
  if (track.role) return USUAL_END[track.role];
  return track.kind === "amb" ? "loop" : "next";
}

/** The loop crossfade Loop with a crossfade starts with when the track has none of its own (r9track.js setEnd: 3 s). */
export const DEFAULT_LOOP_CROSSFADE_MS = 3000;
/** Fade out's length when the place has no fade out of its own (the same 4 s as Ending "Fades out", round7.ts). */
export const DEFAULT_END_FADE_MS = 4000;

/** What the engine does at End when no profile chose it (src/engine/profile/trackProfile.ts AFTER_BY_ROLE). */
const AFTER_BY_ROLE: Partial<Record<TrackRole, "loop" | "next" | "stop">> = { loop_bed: "loop", sting: "next", transition: "next", effect: "stop" };

/**
 * A track's end at one place. `own` is the place's own settings (the track's own profile for the track itself);
 * `atTrack` says whether the place is the track's own, where Ending "Fades out" and Follow with apply as well.
 */
export function endOf(track: DomainTrack, own: AudioProfileInput | null | undefined = track.profile, atTrack = true): TrackEnd {
  const input = own ?? {};
  // A sting never loops (round7.ts roleProfile), whatever its profile says.
  const after = input.after ?? (track.role ? AFTER_BY_ROLE[track.role] : undefined) ?? (track.loop === "yes" || track.loop === "crossfade" ? "loop" : track.kind === "amb" && !track.loop ? "loop" : "next");
  if (after === "loop" && track.role !== "sting") {
    const crossfade = input.loopCrossfadeMs ?? (track.loop === "crossfade" ? DEFAULT_LOOP_CROSSFADE_MS : 0);
    return crossfade > 0 ? "xloop" : "loop";
  }
  if (atTrack && track.follow && after !== "stop") return "follow";
  if ((atTrack && track.fadesOut) || (input.fadeOut?.ms ?? 0) > 0) return "fade";
  return after === "stop" ? "stop" : "next";
}

/** True while the track's end is still the one its use (or no use) gives: choosing a use may then pick a new end. */
export const endIsUsual = (track: DomainTrack): boolean => endOf(track) === usualEnd(track);

/** What a choice of end writes: the track's own fields, and the profile of the place (whole, as profiles.set takes it). */
export interface EndWrite {
  track: { loop: LoopAdvice; fadesOut: boolean; follow: SoundRef | null };
  profile: AudioProfileInput;
}

/**
 * The settings an end writes at the track's own place (`own` is the track's own profile). Follow with needs `follow`.
 * Fade out keeps a fade out the profile has, else gives it 4 s: a profile that names its fade out (even 0 s) wins over
 * Ending "Fades out" in the engine (roleProfile's fadeOutChosen), so the length is always written.
 */
export function endWrite(end: TrackEnd, own: AudioProfileInput | null | undefined, follow: SoundRef | null = null): EndWrite {
  const base: AudioProfileInput = { ...(own ?? {}) };
  const fadeOff = { ms: 0, shape: base.fadeOut?.shape ?? 50 };
  switch (end) {
    case "loop":
      return { track: { loop: "yes", fadesOut: false, follow: null }, profile: { ...base, after: "loop", loopCrossfadeMs: 0 } };
    case "xloop":
      return {
        track: { loop: "crossfade", fadesOut: false, follow: null },
        profile: { ...base, after: "loop", loopCrossfadeMs: (base.loopCrossfadeMs ?? 0) > 0 ? base.loopCrossfadeMs : DEFAULT_LOOP_CROSSFADE_MS },
      };
    case "next":
      return { track: { loop: "no", fadesOut: false, follow: null }, profile: { ...base, after: "next", fadeOut: fadeOff } };
    case "fade": {
      const ms = (base.fadeOut?.ms ?? 0) > 0 ? (base.fadeOut?.ms as number) : DEFAULT_END_FADE_MS;
      return { track: { loop: "no", fadesOut: true, follow: null }, profile: { ...base, after: "next", fadeOut: { ms, shape: base.fadeOut?.shape ?? 50 } } };
    }
    case "stop":
      return { track: { loop: "no", fadesOut: false, follow: null }, profile: { ...base, after: "stop", fadeOut: fadeOff } };
    case "follow":
      return { track: { loop: "no", fadesOut: false, follow }, profile: { ...base, after: "next" } };
  }
}

/** The profile an end writes at another place (a playlist, a scene, a session), where only the profile applies. */
export function placeEndProfile(end: Exclude<TrackEnd, "follow">, own: AudioProfileInput | null | undefined): AudioProfileInput {
  return endWrite(end, own).profile;
}

/** How an end reads in a sentence: "loops with a 3 s crossfade", "then plays Crypt ambush". */
export function endWords(track: DomainTrack, followName: string): string {
  const end = endOf(track);
  if (end === "follow") return `then plays ${followName}`;
  if (end === "xloop") {
    const ms = resolveProfile(track, [], {}).profile.loopCrossfadeMs || DEFAULT_LOOP_CROSSFADE_MS;
    return `loops with a ${Math.round(ms / 100) / 10} s crossfade`;
  }
  return { loop: "loops", next: "then the next track", fade: "fades out", stop: "stops" }[end];
}

/** The one line under Use it for and At its end: "Background · loops with a 3 s crossfade · starts where it stopped." */
export function useEndSummary(track: DomainTrack, followName: string, resumeShown: boolean): string {
  const parts = [track.role ? USE_WORDS[track.role] : "", endWords(track, followName), resumeShown && track.resume ? "starts where it stopped" : ""].filter(Boolean);
  const text = parts.join(" · ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
