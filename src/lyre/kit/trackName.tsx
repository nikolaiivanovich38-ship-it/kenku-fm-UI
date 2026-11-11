/**
 * DAT-14 a track's name where it plays (core.js L.nameIn): in a scene that gives it a name, that name, with its own
 * name on hover and for screen readers; everywhere else its own name (the game master's title, else the title in the
 * file, else the file name). The rule is the domain's trackNameIn; this is how every screen words and shows it.
 */
import React, { useMemo } from "react";

import { trackNameIn, type DomainTrack, type TrackNames, type UsePlace } from "../../common/domain";
import { trackNamesOf } from "../../common/lyre/lookup";
import { useCampaigns } from "../api";

export { trackNameIn, trackNamesOf };

type NamedTrack = Pick<DomainTrack, "id" | "title" | "metaTitle" | "fileName">;

/** Every scene's names for its tracks, from the campaign trees (reloaded when campaigns change). */
export function useTrackNames(): TrackNames {
  const campaigns = useCampaigns().data;
  return useMemo(() => (campaigns ? trackNamesOf(campaigns) : {}), [campaigns]);
}

/** A track's name in a place; only a scene can give it another name. */
export function trackNameAt(track: NamedTrack, place: UsePlace | null, names: TrackNames) {
  return trackNameIn(track, place?.kind === "scene" ? place : null, names);
}

/** The hover text for a track's name: "Its own name: …" where the scene calls it something else, else its name. */
export function ownNameTitle(n: { name: string; own: string }): string {
  return n.name !== n.own ? `Its own name: ${n.own}` : n.own;
}

/**
 * A track's name in a place, with its own name on hover (and read out) where the scene calls it something else.
 * `hover`: more words for the hover, after the name (the Now playing bar's normalising, PLY-15).
 */
export function TrackName({ track, place, names, className, hover }: { track: NamedTrack; place: UsePlace | null; names: TrackNames; className?: string; hover?: string }) {
  const n = trackNameAt(track, place, names);
  return (
    <span className={className} title={hover ? `${ownNameTitle(n)} · ${hover}` : ownNameTitle(n)}>
      {n.name}
      {n.name !== n.own && <span className="sr-only"> (its own name: {n.own})</span>}
      {hover && <span className="sr-only"> · {hover}</span>}
    </span>
  );
}
