/**
 * DAT-14 a track's name where it plays (core.js L.nameIn): in a scene that gives it a name, that name, with its own
 * name on hover and for screen readers; everywhere else its own name (the game master's title, else the title in the
 * file, else the file name). The rule is the domain's trackNameIn; this is how every screen words and shows it.
 */
import React, { useMemo } from "react";

import { trackNameIn, type DomainTrack, type TrackNames, type UsePlace } from "../../common/domain";
import { trackNamesOf } from "../../common/lyre/lookup";
import { useCampaigns } from "../api";
import { useOpenTrackPanel } from "./SidePanel";

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
export function TrackName({ track, place, names, className, hover, link }: { track: NamedTrack; place: UsePlace | null; names: TrackNames; className?: string; hover?: string; link?: boolean }) {
  const n = trackNameAt(track, place, names);
  const inside = (
    <>
      {n.name}
      {n.name !== n.own && <span className="sr-only"> (its own name: {n.own})</span>}
      {hover && <span className="sr-only"> · {hover}</span>}
    </>
  );
  const title = hover ? `${ownNameTitle(n)} · ${hover}` : ownNameTitle(n);
  // 0.5.2 (Nik's items 3 and 11): `link`: the name leads to the track's details in the Library.
  if (link)
    return (
      <TrackNameLink trackId={track.id} className={className} title={title}>
        {inside}
      </TrackNameLink>
    );
  return (
    <span className={className} title={title}>
      {inside}
    </span>
  );
}

/** 0.5.2 (Nik's items 3 and 11): where a track's name leads: the Library with the track's details shown. */
export const trackDetailsHref = (trackId: string): string => `#/library/${trackId}`;

/**
 * 0.5.2 (Nik's items 3 and 11): a track's name as a link to its details in the Library (LibraryScreen opens Details on
 * arrival). Only where the name is not itself a play or unfold button: in Live a name never takes a play action's place.
 */
export function TrackNameLink({ trackId, className, title, children }: { trackId: string; className?: string; title?: string; children: React.ReactNode }) {
  // --- r10-tracks --- Round 9 and 10 (rows 13, 38): a plain click opens the Track panel beside the screen (on the
  // Track library and the Audio profile it goes to the Library's details); the address stays the Library's, so a
  // middle click or Ctrl+click still opens the Library.
  const openTrackPanel = useOpenTrackPanel();
  return (
    <a
      className={className ? `track-link ${className}` : "track-link"}
      href={trackDetailsHref(trackId)}
      title={title ?? "Open its details"}
      onClick={(event) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openTrackPanel(trackId, event.currentTarget);
      }}
    >
      {children}
    </a>
  );
}
