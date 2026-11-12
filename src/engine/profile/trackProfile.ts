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
 * The profile a lane plays a track with: ambience always loops (as the
 * prototype's ambience does), an effect plays once, music follows the track.
 */
export function laneProfile(
  track: DomainTrack,
  lane: PlayLane,
  places: readonly ProfilePlace[],
  overrides: ProfileOverrides,
): AudioProfile {
  const { profile } = trackProfile(track, places, overrides);
  if (lane === "ambience") {
    return { ...profile, after: "loop" };
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
