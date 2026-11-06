/**
 * A DomainLookup over lists a screen already has from LyreApi (library.listTracks, playlists.list), so screens and
 * tests apply the shared rules in src/common/domain (playlistTracks, sceneSequence, ...) without asking again.
 */
import type { DomainLookup, DomainPlaylist, DomainTrack, RepeatOnes, TrackNames } from "../domain";
import type { CampaignInfo } from "./api";

export function lookupFrom(tracks: readonly DomainTrack[], playlists: readonly DomainPlaylist[]): DomainLookup {
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const playlistById = new Map(playlists.map((p) => [p.id, p]));
  return {
    track: (id) => trackById.get(id),
    playlist: (id) => playlistById.get(id),
    tracks: () => tracks,
  };
}

/** DAT-14: every scene's names for its tracks, keyed by scene key as trackNameIn takes them, from the campaign trees. */
export function trackNamesOf(campaigns: readonly CampaignInfo[]): TrackNames {
  const out: TrackNames = {};
  for (const c of campaigns)
    for (const s of c.sessions)
      for (const sc of s.scenes) if (Object.keys(sc.trackNames).length) out[`sc:${c.id}:${s.id}:${sc.id}`] = { ...sc.trackNames };
  return out;
}

/** PLY-17: every scene's Repeat ones, keyed by scene key as repeatsOneIn takes them, from the campaign trees. */
export function repeatOnesOf(campaigns: readonly CampaignInfo[]): RepeatOnes {
  const out: RepeatOnes = {};
  for (const c of campaigns)
    for (const s of c.sessions)
      for (const sc of s.scenes) if (sc.repeatOnes?.length) out[`sc:${c.id}:${s.id}:${sc.id}`] = [...sc.repeatOnes];
  return out;
}
