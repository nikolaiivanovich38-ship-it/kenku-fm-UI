import React from "react";

import { Icon } from "../../kit/Icon";
import { cx } from "../../kit/cx";

export interface ProfileLinkProps {
  trackId: string;
  /** The track's name as shown, for the hover text and the icon-only name. */
  title: string;
  /** A place ("pl:<playlist>" or "sc:<campaign>:<session>:<scene>"); the track's own settings when left out. */
  place?: string;
  /** In words, for the hover text: "the playlist Gothic dread". */
  placeName?: string;
  /** This track (or place) has settings of its own: a dot beside the words. */
  hasOwn?: boolean;
  iconOnly?: boolean;
}

/**
 * The compact "Audio profile" link-button (the prototype's L.profileLink in views/profile.js), for the Audio profile's
 * hand-over line and for other screens (Library, Playlists, Campaigns) when they add it. Candidate for src/lyre/kit.
 */
export function ProfileLink({ trackId, title, place, placeName, hasOwn, iconOnly }: ProfileLinkProps) {
  const tip = `Audio profile: where ${title} starts, ends, fades, loops or moves on${place && placeName ? ` (${placeName})` : ""}`;
  return (
    <a
      className={cx("btn", "s", iconOnly && "icon", "ap-link")}
      href={`#/profile/${trackId}${place ? `/${place}` : ""}`}
      title={tip}
      aria-label={iconOnly ? `Audio profile of ${title}` : undefined}
    >
      <Icon name="wave" size="s" />
      {!iconOnly && "Audio profile"}
      {hasOwn && !iconOnly && (
        <>
          <span className="ap-link-dot" aria-hidden="true" />
          <span className="sr-only"> (has settings)</span>
        </>
      )}
    </a>
  );
}
