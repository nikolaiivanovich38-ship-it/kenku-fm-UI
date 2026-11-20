/**
 * Round 9 and round 10 (ROUND9.md §1, R10-FIX §3; Nik, 18 Nov, items 16 and 22: "I want to be able to see and edit
 * track details in the playlist view"): the Track panel. A track title outside the Track library opens the Library's
 * own details (TrackDetails: the same words and controls) beside the screen, in the side-panel host (kit/SidePanel).
 * Its head: × at the left (round 10: clear of the window's buttons), Track, Open in Track library, and the track's title
 * as its heading. Esc closes it; focus goes into it and back to the title that opened it. r9nav.js.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ProfileOverrides } from "../../../common/domain";
import { shownTitle } from "../../../common/lyre/text";
import { useCampaigns, useLyreApi, useMissingTracks, usePlaylists, useProfileOverrides, useTagGroups } from "../../api";
import { useNowPlaying } from "../../audio";
import { Icon } from "../../kit/Icon";
import { trackDetailsHref } from "../../kit/trackName";
import { useAnnounce } from "../../shell/Announcer";
import { TrackDetails } from "../library/TrackDetails";
import { useTrackList } from "../library/trackStore";
import { useNormaliseSettings } from "../library/normalise";
import { UseInDialog } from "../library/UseInDialog";
import { useWriteResult } from "../library/shared";
import { soundName } from "../library/playlistParts";
import { usePlaylistData } from "../library/playlistData";
import "../library/library.css";
import "../library/round9.css";
import "./trackPanel.css";

const NONE: never[] = [];
const NO_OVERRIDES: ProfileOverrides = {};

export function TrackPanel({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const api = useLyreApi();
  const accept = useWriteResult();
  const { say } = useAnnounce();
  const { byId, store, tracks } = useTrackList();
  const groups = useTagGroups().data ?? NONE;
  const playlists = usePlaylists().data ?? NONE;
  const campaigns = useCampaigns().data ?? NONE;
  const overrides = useProfileOverrides().data ?? NO_OVERRIDES;
  const normalise = useNormaliseSettings();
  const now = useNowPlaying();
  const missingList = useMissingTracks().data;
  const missing = useMemo(() => new Set((missingList ?? NONE).map((m: { id: string }) => m.id)), [missingList]);
  const data = usePlaylistData();
  const [useIn, setUseIn] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const t = byId.get(trackId);
  const title = t ? shownTitle(t) : "";

  // Focus goes into the panel (its heading) when it opens or shows another track.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (title) say(`Track details: ${title}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per track shown
  }, [trackId, !!t]);

  return (
    <aside
      className="r9-tp"
      aria-labelledby="r9-tp-title"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented || document.querySelector(".menu, [role=dialog]")) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <header className="r9-tp-head">
        <div className="r9-tp-bar">
          <button type="button" className="closer" title="Close (Esc)" aria-label="Close the track details" onClick={onClose}>
            <Icon name="close" />
          </button>
          <span className="r9-tp-kicker">Track</span>
          <span className="grow" />
          {t && (
            <a className="btn s" href={trackDetailsHref(t.id)} title="Open it in the Track library, with its filters and the whole list" onClick={onClose}>
              <Icon name="library" size="s" />
              Open in Track library
            </a>
          )}
        </div>
        <h2 id="r9-tp-title" ref={heading} tabIndex={-1} className="ellipsis" title={title}>
          {t ? title : tracks === undefined ? "Opening…" : "This track is no longer in your library"}
        </h2>
      </header>
      <div className="r9-tp-body">
        {t && (
          <TrackDetails
            key={t.id}
            t={t}
            store={store}
            groups={groups}
            playlists={playlists}
            campaigns={campaigns}
            overrides={overrides}
            previewing={now.preview?.key ?? null}
            missing={missing.has(t.id)}
            normalise={normalise}
            onNewPlaylist={async (ids) => {
              let n = 1;
              while (playlists.some((p) => p.name === `New playlist ${n}`)) n++;
              const made = accept(await api.playlists.create({ name: `New playlist ${n}`, kind: "manual", lane: t.kind, trackIds: ids }));
              if (made) say(`Made the playlist ${made.name}`);
            }}
            onUseIn={() => setUseIn(true)}
          />
        )}
      </div>
      {useIn && t && <UseInDialog track={t} campaigns={campaigns} nameOf={soundName(data)} onClose={() => setUseIn(false)} />}
    </aside>
  );
}
