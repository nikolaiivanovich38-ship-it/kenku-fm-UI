/**
 * PLY-12, PLY-4: the audio profile a track plays with in a place, and what its
 * role means when nobody chose what happens at its end.
 *
 * `resolveProfile` (src/common/domain) picks the settings (scene, then
 * playlist, then the track's own) and fills in the rest; when "after" was
 * never chosen it decides from the track's loop advice only. Here the track's
 * role comes first, as the design describes the roles:
 *   loop bed    loops
 *   sting       plays once and hands over to what comes next
 *   transition  plays once and hands over
 *   effect      plays once and stops
 *   underscore, or no role: the loop advice ("yes" or "crossfade" loops), else next.
 */
import {
  AfterEnd,
  AudioProfile,
  AudioProfileInput,
  DomainTrack,
  placeKey,
  ProfileOverrides,
  ProfilePlace,
  ProfileSource,
  resolveProfile,
  TrackRole,
} from "../../common/domain";

const AFTER_BY_ROLE: Partial<Record<TrackRole, AfterEnd>> = {
  loop_bed: "loop",
  sting: "next",
  transition: "next",
  effect: "stop",
};

/** The profile of `track` in `places` (most specific first: the scene, then the playlist). */
export function trackProfile(
  track: DomainTrack,
  places: readonly ProfilePlace[],
  overrides: ProfileOverrides,
): { profile: AudioProfile; source: ProfileSource } {
  const resolved = resolveProfile(track, [...places], overrides);
  const chosen = chosenInput(track, places, overrides);
  const byRole = track.role ? AFTER_BY_ROLE[track.role] : undefined;
  if (chosen.after === undefined && byRole) {
    return { ...resolved, profile: { ...resolved.profile, after: byRole } };
  }
  return resolved;
}

/** The lanes a room plays: music, ambience and effects. */
export type PlayLane = "music" | "ambience" | "effects";

/**
 * The profile a lane plays a track with: ambience loops unless its settings say otherwise (43; the prototype's
 * ambience always looped), an effect plays once, music follows the track.
 */
export function laneProfile(
  track: DomainTrack,
  lane: PlayLane,
  places: readonly ProfilePlace[],
  overrides: ProfileOverrides,
): AudioProfile {
  const { profile } = trackProfile(track, places, overrides);
  if (lane === "ambience") {
    // 43: ambience loops unless its settings for the place, or the track's own, say what happens at its end.
    return chosenInput(track, places, overrides).after === undefined ? { ...profile, after: "loop" } : profile;
  }
  if (lane === "effects") {
    return { ...profile, after: "stop" };
  }
  return profile;
}

/** The settings resolveProfile used: the first place with its own, else the track's. */
export function profileInputFor(track: DomainTrack, places: readonly ProfilePlace[], overrides: ProfileOverrides): AudioProfileInput {
  return chosenInput(track, places, overrides);
}
function chosenInput(track: DomainTrack, places: readonly ProfilePlace[], overrides: ProfileOverrides): AudioProfileInput {
  for (const place of places) {
    const own = overrides[placeKey(place)]?.[track.id];
    if (own) {
      return own;
    }
  }
  return track.profile ?? {};
}

/**
 * 52: whether a profile's End is the end of the track (its length as the library has it, or past it). Then End means
 * the end of the file (VoiceOptions.endAtFileEnd), because the library's length can be wrong: an MP3 whose header
 * counts too few frames is read as a few seconds long. A track with no length known (0) also plays its whole file.
 */
export function endsAtFileEnd(track: Pick<DomainTrack, "durationMs">, profile: Pick<AudioProfile, "endMs">): boolean {
  return profile.endMs >= Math.max(0, track.durationMs || 0);
}

/** 37: the loop crossfade Repeat one uses for a track whose loop setting is "Crossfade the loop" and has none of its own. */
export const REPEAT_CROSSFADE_MS = 2000;

/**
 * 37: how a track goes round when Repeat one applies to it, by its loop setting, with its profile where it plays:
 * "Do not loop" starts it again from Start (null: play it again); otherwise it goes back to Loop start at End in the
 * same play, with its loop crossfade ("Crossfade the loop" without one of its own crossfades over REPEAT_CROSSFADE_MS,
 * at most half the looped part).
 */
export function repeatProfile(track: Pick<DomainTrack, "loop">, profile: AudioProfile): AudioProfile | null {
  if (track.loop === "no") return null;
  const half = Math.max(0, (profile.endMs - profile.loopStartMs) / 2);
  const crossfade = profile.loopCrossfadeMs > 0 || track.loop !== "crossfade" ? profile.loopCrossfadeMs : Math.min(REPEAT_CROSSFADE_MS, half);
  return { ...profile, after: "loop", loopCrossfadeMs: crossfade };
}
