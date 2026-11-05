/**
 * A track row in Scene music and Off script (live.js trackRow): its number in the scene, On air or Queued, the
 * track's name there (the scene's name for it, DAT-14), its length as it plays there, and always Preview, Play next,
 * Play on air in that order, named with the room when there are two or more. The name opens its details (titles,
 * file, its Audio profile in this place, its tags); it never plays the track.
 */
import React from "react";

import type { UsePlace } from "../../../common/domain";
import type { LibraryTrack } from "../../../common/lyre/api";
import { usePreviewKey } from "../../audio";
import type { TrackFrom } from "../../audio/lyreAudio";
import { DestTag } from "../../kit/DestTag";
import { Icon } from "../../kit/Icon";
import { EnergyMeter } from "../../kit/Pills";
import { ProfileLink } from "../../kit/ProfileLink";
import { TagStrip } from "../../kit/TagStrip";
import { trackNameAt } from "../../kit/trackName";
import { cx } from "../../kit/cx";
import { formatLength } from "../campaigns/model";
import { playedMs, useBoxTarget, useLive } from "./liveData";
import type { LiveBox } from "./liveModel";
import { updateLive } from "./liveState";

/** Play on air and Next crossfade over this long (the prototype's fade: 3). */
export const LIVE_FADE_MS = 3000;

const KIND_WORDS = { amb: "Ambience", fx: "FX" } as const;

export interface TrackRowProps {
  track: LibraryTrack;
  /** Unique among the screen's rows: which list, then the track ("sc2:t42"). */
  rowKey: string;
  /** Its number in the scene's list. */
  num?: number;
  /** The scene step or playlist it plays from (none: off script). */
  from?: TrackFrom;
  /** Where it is shown, for its name and audio profile there. */
  place: UsePlace | null;
  playlistId: string | null;
  box: LiveBox;
  on: boolean;
  /** A track of an opened playlist. */
  inner?: boolean;
  /** Moods to show first (the picked ones). */
  prefer?: readonly string[];
}

export function TrackRow({ track, rowKey, num, from, place, playlistId, box, on, inner, prefer }: TrackRowProps) {
  const { audio, names, overrides, state, rooms, tagGroups } = useLive();
  const target = useBoxTarget(box);
  const previewing = usePreviewKey() === track.id;
  const n = trackNameAt(track, place, names);
  const open = state.open === rowKey;
  const detailsId = `lv-d-${rowKey.replace(/[^\w-]/g, "-")}`;
  const len = playedMs(track, place, playlistId, overrides);
  const queuedAt = rooms
    .filter((r) => target.targets.some((t) => t !== "all" && t.room === r.roomId))
    .flatMap((r) => r.room?.queued ?? [])
    .findIndex((q) => q.trackId === track.id);
  const layered = track.kind === "amb" || track.kind === "fx";
  const moods = [...(track.tags.mood ?? [])].sort((a, b) => Number(prefer?.includes(b) ?? false) - Number(prefer?.includes(a) ?? false));
  const onRoom = rooms.length > 1 ? rooms.filter((r) => r.room?.music?.trackId === track.id || r.room?.ambience?.trackId === track.id).map((r) => r.name).join(" and ") : "";

  const playNow = () => {
    for (const t of target.targets) {
      if (track.kind === "fx") audio.playTrack(track.id, { target: t });
      else audio.playTrack(track.id, { target: t, from, fadeMs: LIVE_FADE_MS });
    }
  };
  const playNext = () => {
    for (const t of target.targets) audio.playTrack(track.id, { target: t, from, when: "next", fadeMs: LIVE_FADE_MS });
  };

  return (
    <li className={cx("lv-trk", on && "on", track.kind === "amb" && "amb", open && "open", inner && "inner")}>
      <div className="lv-trk-r">
        {num !== undefined && (
          <span className="num lv-num" aria-hidden="true">
            {num}
          </span>
        )}
        {on ? <DestTag to="air" room={onRoom || undefined} /> : queuedAt > -1 ? <span className="badge lv-qb">Queued {queuedAt + 1}</span> : null}
        {layered && (
          <>
            <span className={cx("lane-dot", track.kind)} title={KIND_WORDS[track.kind as "amb" | "fx"]} />
            <span className="sr-only">{KIND_WORDS[track.kind as "amb" | "fx"]}:</span>
          </>
        )}
        <button
          type="button"
          className="lv-trk-t"
          aria-expanded={open}
          aria-controls={open ? detailsId : undefined}
          title={`${n.name !== n.own ? `${n.name} (its own name: ${n.own})` : n.name} (click for details)`}
          onClick={() => updateLive({ open: open ? null : rowKey })}
        >
          <span>{n.name}</span>
        </button>
        {(on || open) && (
          <>
            {moods[0] && (
              <span className="chips lv-trk-chips">
                <span className="chip lv-mood" title="Mood">
                  {moods[0]}
                </span>
              </span>
            )}
            {!layered && track.energy !== null && <EnergyMeter value={track.energy} />}
          </>
        )}
        <span className="num lv-dur" title={Math.round(len / 1000) !== Math.round(track.durationMs / 1000) ? `Plays ${formatLength(len)} of the file's ${formatLength(track.durationMs)}` : `Length ${formatLength(track.durationMs)}`}>
          {formatLength(len)}
        </span>
        <span className="lv-trk-acts">
          <button
            type="button"
            className="closer lv-pvb"
            aria-pressed={previewing}
            aria-label={`Preview: ${n.name}`}
            title={previewing ? "Stop the preview" : "Preview in your headphones (players do not hear it)"}
            onClick={() => (previewing ? audio.stopPreview() : audio.previewTrack(track.id))}
          >
            <Icon name="headphones" />
          </button>
          {layered ? (
            <span className="lv-gap" aria-hidden="true" />
          ) : (
            <button type="button" className="closer" aria-label={`Play next${target.inWhere}: ${n.name}`} title={`Play next${target.inWhere}, after the current track`} onClick={playNext}>
              <Icon name="queue" />
            </button>
          )}
          <button
            type="button"
            className="closer"
            aria-label={`Play on air${target.inWhere}: ${n.name}`}
            title={`Play on air${target.inWhere}${track.kind === "fx" ? ", over the music" : ", crossfading from what is playing"}`}
            onClick={playNow}
          >
            <Icon name="broadcast" />
          </button>
        </span>
      </div>
      {open && (
        <div className="lv-trk-d" id={detailsId}>
          <dl>
            {n.name !== n.own && (
              <>
                <dt>Name in this scene</dt>
                <dd>{n.name}</dd>
              </>
            )}
            <dt>Your title</dt>
            <dd>{track.title || <span className="faint">none yet</span>}</dd>
            <dt>Title in the file</dt>
            <dd>{track.metaTitle || "–"}</dd>
            <dt>File name</dt>
            <dd>{track.fileName}</dd>
            <dt>From</dt>
            <dd>{[track.artist, track.album].filter(Boolean).join(", ") || "–"}</dd>
          </dl>
          <div className="lv-trk-ap">
            <ProfileLink trackId={track.id} title={n.name} place={profileKey(place, playlistId)} placeName={place?.kind === "scene" ? "in this scene" : playlistId ? "in this playlist" : undefined} />
            <TagStrip track={track} groups={tagGroups} />
          </div>
        </div>
      )}
    </li>
  );
}

/** The Audio profile's place for a row: the scene, else the playlist; none for a track on its own. */
function profileKey(place: UsePlace | null, playlistId: string | null): string | undefined {
  if (place?.kind === "scene") return `sc:${place.campaignId}:${place.sessionId}:${place.sceneId}`;
  return playlistId ? `pl:${playlistId}` : undefined;
}
