/**
 * A DomainLookup over lists a screen already has from LyreApi (library.listTracks, playlists.list), so screens and
 * tests apply the shared rules in src/common/domain (playlistTracks, sceneSequence, ...) without asking again.
 */
import type { DomainLookup, DomainPlaylist, DomainTrack } from "../domain";

export function lookupFrom(tracks: readonly DomainTrack[], playlists: readonly DomainPlaylist[]): DomainLookup {
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const playlistById = new Map(playlists.map((p) => [p.id, p]));
  return {
    track: (id) => trackById.get(id),
    playlist: (id) => playlistById.get(id),
    tracks: () => tracks,
  };
}
