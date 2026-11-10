/**
 * The rows of Live, the same in every box (live.js trackRow, plRow, ambLine, sceneList): a track, a playlist that
 * unfolds to its tracks, a scene's ambience, and a scene's music in its play order.
 *
 * Every row has, in this order: Preview (only you hear it), Play next and Add to queue (PLY-16: right after the track
 * playing, or at the bottom of the room's list), Repeat one on a scene's track (PLY-17, saved with the scene), a
 * playlist's play order (PLY-13), and Play on air. Preview, Play next and Add to queue are always shown, greyed at rest
 * and in full colour on hover and focus (Nik, 6 Nov 13:55). With two rooms or more each name says where it plays
 * ("Play on air in Side room: …"). A track's name opens its details (titles, file, its Audio profile in this place);
 * it never plays it. DAT-14: in a scene a track shows the scene's name for it, its own name on hover.
 */
import React from "react";

import type { UsePlace } from "../../../common/domain";
import type { LibraryTrack, PlaylistInfo, SceneInfo } from "../../../common/lyre/api";
import { useLyreApi } from "../../api";
import { usePreviewKey } from "../../audio";
import type { RoomNowPlaying, TrackFrom } from "../../audio/lyreAudio";
import { DestTag } from "../../kit/DestTag";
import { ExpanderButton } from "../../kit/Expander";
import { Icon } from "../../kit/Icon";
import { EnergyMeter } from "../../kit/Pills";
import { PlayOrderButton } from "../../kit/PlayOrderButton";
import { ProfileLink } from "../../kit/ProfileLink";
import { TagStrip } from "../../kit/TagStrip";
import { trackNameAt } from "../../kit/trackName";
import { cx } from "../../kit/cx";
import { useAnnounce } from "../../shell/Announcer";
import { useSave } from "../../shell/useSave";
import { formatLength } from "../campaigns/model";
import { addToList, playOnAir, type PlayWhat } from "./liveActions";
import { playedMs, playlistInPlace, sameRef, sceneRefOf, scenePlace, sceneSteps, seedOfScene, showLibraryOf, useBoxTarget, useLive, type LiveData } from "./liveData";
import type { LiveBox } from "./liveModel";
import { touched, updateLive } from "./liveState";

const KIND_WORDS = { amb: "Ambience", fx: "FX" } as const;

/** Where a row's track sounds now, as its tag says it (Should 10: never "On air" when nobody hears it). */
function AirTag({ trackId, playlistId }: { trackId?: string; playlistId?: string }) {
  const { rooms } = useLive();
  const plays = (r: RoomNowPlaying) =>
    trackId ? r.music?.trackId === trackId || r.ambience?.trackId === trackId || r.effects.some((e) => e.trackId === trackId && !e.padKey) : r.music?.playlistId === playlistId || r.ambience?.playlistId === playlistId;
  if (!rooms.length) return <DestTag to="air" room="no room" nobody="Nobody hears it: no bot is in a voice channel" />;
  const where = rooms.filter((r) => r.room && plays(r.room));
  if (where.length && where.every((r) => r.nobody)) return <DestTag to="air" room="nobody there" nobody={`Nobody hears it: nobody is in ${where.map((r) => r.name).join(" or ")}`} />;
  return <DestTag to="air" room={rooms.length > 1 && where.length ? where.map((r) => r.name).join(" and ") : undefined} />;
}

/** Whether a track sounds in any room now (music, ambience or an effect played on its own). */
export function trackOnAir(d: LiveData, trackId: string): boolean {
  return d.now.rooms.some((r) => r.music?.trackId === trackId || r.ambience?.trackId === trackId || r.effects.some((e) => e.trackId === trackId && !e.padKey));
}

/** The row's buttons after Preview: Play next and Add to queue (music and ambience), in the box's rooms. */
function ListButtons({ box, what, dataLv }: { box: LiveBox; what: PlayWhat; dataLv: string }) {
  const d = useLive();
  const target = useBoxTarget(box);
  const { say } = useAnnounce();
  const amb = what.kind === "track" ? what.track.kind === "amb" : what.playlist.lane === "amb";
  return (
    <>
      <button
        type="button"
        className="closer lv-hov"
        data-lv={`${dataLv}-n`}
        aria-label={`Play next${target.inWhere}: ${what.name}`}
        title={`Play next${target.inWhere}${amb ? ": the next ambience, when you press Next on the ambience" : ": right after the track playing now"}`}
        onClick={() => addToList(d, "next", target.targets, what, `${dataLv}-n`, { say })}
      >
        <Icon name="next" />
      </button>
      <button
        type="button"
        className="closer lv-hov"
        data-lv={`${dataLv}-q`}
        aria-label={`Add to queue${target.inWhere}: ${what.name}`}
        title={`Add to queue${target.inWhere}${amb ? ": after the ambience waiting in Up next" : ": at the bottom of Up next"}`}
        onClick={() => addToList(d, "queue", target.targets, what, `${dataLv}-q`, { say })}
      >
        <Icon name="queue" />
      </button>
    </>
  );
}

function PlayButton({ box, what, dataLv, extra }: { box: LiveBox; what: PlayWhat; dataLv: string; extra: string }) {
  const d = useLive();
  const target = useBoxTarget(box);
  return (
    <button
      type="button"
      className="closer"
      data-lv={`${dataLv}-p`}
      aria-label={`Play on air${target.inWhere}: ${what.name}`}
      title={`Play on air${target.inWhere}${extra}`}
      onClick={() => playOnAir(d, target.targets, what)}
    >
      <Icon name="playair" />
    </button>
  );
}

/** PLY-17, Nik 6 Nov 12:30: Repeat one on a scene's track is saved with the scene (shown in the planner too). */
function RepeatOne({ scene, sceneName, trackId, name, dataLv, shown }: { scene: { campaignId: string; sessionId: string; sceneId: string }; sceneName: string; trackId: string; name: string; dataLv: string; shown: boolean }) {
  const { session, audio } = useLive();
  const api = useLyreApi();
  const save = useSave();
  const { say } = useAnnounce();
  const sc = session.scenes.find((s) => s.id === scene.sceneId);
  const on = !!sc?.repeatOnes?.includes(trackId);
  const press = async () => {
    touched();
    const done = await save(`Repeat one in ${sceneName}`, () => api.sessions.setRepeatOne(scene, trackId, !on), { key: `rep1-${scene.sceneId}-${trackId}` });
    if (!done) return;
    audio.savedRepeatOneChanged(scene, trackId);
    say(on ? `Repeat one off: ${name}` : `Repeat one on, saved with the scene: ${name}`);
  };
  return (
    <button
      type="button"
      className={cx("closer rep1", (on || shown) && "shown")}
      data-lv={`${dataLv}-r`}
      aria-pressed={on}
      aria-label={`Repeat one: ${name}`}
      title={on ? "Repeat in this scene (saved): press to stop" : "Repeat in this scene (saved): plays again when it ends, every time this scene plays"}
      onClick={() => void press()}
    >
      <Icon name="repeat1" />
      {on && <span className="ord-dot" aria-hidden="true" />}
    </button>
  );
}

export interface TrackRowProps {
  track: LibraryTrack;
  /** Unique among the screen's rows: which list, then the track ("sc2:t42"). */
  rowKey: string;
  /** Its number in a scene's list. */
  num?: number;
  /** The scene step or playlist it plays from; none: a track on its own. */
  from?: TrackFrom;
  /** Where it is shown, for its name and audio profile there. */
  place: UsePlace | null;
  playlistId: string | null;
  box: LiveBox;
  /** On air at this row (a scene's row: at its own step). */
  on: boolean;
  /** A track of an opened playlist. */
  inner?: boolean;
  /** Moods to show first (the picked ones in Find). */
  prefer?: readonly string[];
  /** Find shows a track's mood and energy on the row. */
  facts?: boolean;
  /** A scene's track: its Repeat one (saved with that scene). */
  repeatIn?: { ref: { campaignId: string; sessionId: string; sceneId: string }; name: string };
}

export function TrackRow({ track, rowKey, num, from, place, playlistId, box, on, inner, prefer, facts, repeatIn }: TrackRowProps) {
  const d = useLive();
  const { audio, names, overrides, state, rooms, tagGroups } = d;
  const target = useBoxTarget(box);
  const previewing = usePreviewKey() === track.id;
  const n = trackNameAt(track, place, names);
  const open = state.open === rowKey;
  const dataLv = `t-${rowKey}`;
  const detailsId = `lv-d-${rowKey.replace(/[^\w-]/g, "-")}`;
  const len = playedMs(track, place, playlistId, overrides);
  const queued = rooms
    .filter((r) => target.targets.some((t) => t !== "all" && t.room === r.roomId))
    .some((r) => (r.room?.upNextList ?? []).some((e) => e.kind !== "planned" && e.trackIds.length === 1 && e.trackIds[0] === track.id));
  const layered = track.kind === "amb" || track.kind === "fx";
  const moods = [...(track.tags.mood ?? [])].sort((a, b) => Number(prefer?.includes(b) ?? false) - Number(prefer?.includes(a) ?? false));
  const what: PlayWhat = { kind: "track", track, from, place, name: n.name };
  return (
    <li className={cx("lv-trk", on && "on", track.kind === "amb" && "amb", open && "open", inner && "inner")}>
      <div className="lv-trk-r">
        {num !== undefined && (
          <span className="num lv-num" aria-hidden="true">
            {num}
          </span>
        )}
        {on ? <AirTag trackId={track.id} /> : queued ? <span className="badge lv-qb">Queued</span> : null}
        {layered && (
          <>
            <span className={cx("lane-dot", track.kind)} title={KIND_WORDS[track.kind as "amb" | "fx"]} />
            <span className="sr-only">{KIND_WORDS[track.kind as "amb" | "fx"]}:</span>
          </>
        )}
        <button
          type="button"
          className="lv-trk-t"
          data-lv={`${dataLv}-t`}
          aria-expanded={open}
          aria-controls={open ? detailsId : undefined}
          title={`${n.name !== n.own ? `${n.name} (its own name: ${n.own})` : n.name} (click for details)`}
          onClick={() => updateLive({ open: open ? null : rowKey })}
        >
          <span>{n.name}</span>
        </button>
        {(open || facts) && (
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
        <span className={cx("lv-trk-acts", on && "shown")}>
          <button
            type="button"
            className={cx("closer lv-pvb", !previewing && "lv-hov")}
            data-lv={`${dataLv}-v`}
            aria-pressed={previewing}
            aria-label={`Preview: ${n.name}`}
            title={previewing ? "Stop the preview" : "Preview in your headphones (players do not hear it)"}
            onClick={() => (previewing ? audio.stopPreview() : audio.previewTrack(track.id, playlistId ? { playlistId } : undefined))}
          >
            <Icon name="headphones" />
          </button>
          {track.kind !== "fx" && <ListButtons box={box} what={what} dataLv={dataLv} />}
          {repeatIn && track.kind === "music" && <RepeatOne scene={repeatIn.ref} sceneName={repeatIn.name} trackId={track.id} name={n.name} dataLv={dataLv} shown={on} />}
          <PlayButton box={box} what={what} dataLv={dataLv} extra={track.kind === "fx" ? ", over the music" : ", crossfading from what is playing"} />
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

export interface PlaylistRowProps {
  playlist: PlaylistInfo;
  /** Unique among the screen's rows, for its open state ("ssp:p-abbess"). */
  rowKey: string;
  num?: number;
  /** The place whose play order it plays in (PLY-13). */
  place: UsePlace | null;
  box: LiveBox;
  /** On air from this row (a scene's step). Else: when a room plays from this playlist. */
  on?: boolean;
  /** "3 of 9" while it plays. */
  playingAt?: number;
  /** Its tracks in the order shown (default: its order in `place`). */
  tracks?: LibraryTrack[];
  /** A step of the running scene: Play on air plays from its first track there. */
  first?: { trackId: string; from: TrackFrom };
  /** One of its tracks, as a row. */
  trackRow: (track: LibraryTrack) => React.ReactNode;
}

export function PlaylistRow({ playlist: p, rowKey, num, place, box, on, playingAt, tracks, first, trackRow }: PlaylistRowProps) {
  const d = useLive();
  const previewKey = usePreviewKey();
  const open = !!d.state.expanded[rowKey];
  const list = tracks ?? playlistInPlace(d.index, d.orders, p.id, place);
  const air = on ?? d.now.rooms.some((r) => r.music?.playlistId === p.id || r.ambience?.playlistId === p.id);
  const previewing = previewKey === `pl:${p.id}`;
  const dataLv = `p-${rowKey}`;
  const subId = `lv-sub-${rowKey.replace(/[^\w-]/g, "-")}`;
  const what: PlayWhat = { kind: "playlist", playlist: p, place, ...(first ? { first } : {}), name: p.name };
  const kind = p.kind === "dynamic" ? "Dynamic" : "Manual";
  return (
    <li className={cx("lv-pli", air && "on")}>
      <div className="lv-trk-r">
        {num !== undefined && (
          <span className="num lv-num" aria-hidden="true">
            {num}
          </span>
        )}
        <ExpanderButton label={p.name} expanded={open} controls={subId} onToggle={() => updateLive((s) => ({ expanded: { ...s.expanded, [rowKey]: !open } }))} />
        {air && <AirTag playlistId={p.id} />}
        <Icon name="playlist" size="s" className="lv-pli-i" />
        <span className="lv-pli-n">
          <b className="ellipsis" title={`${p.name} · ${list.length} tracks · ${kind}`}>
            {p.name}
          </b>
          {playingAt !== undefined && playingAt > 0 ? <span className="faint ellipsis">{`${playingAt} of ${list.length}`}</span> : <span className="sr-only">, {list.length} tracks</span>}
        </span>
        <span className={cx("lv-ord", air && "shown")}>
          <PlayOrderButton playlistId={p.id} place={place} />
        </span>
        <span className={cx("lv-trk-acts", air && "shown")}>
          <button
            type="button"
            className={cx("closer lv-pvb", !previewing && "lv-hov")}
            data-lv={`${dataLv}-v`}
            aria-pressed={previewing}
            aria-label={`Preview: ${p.name}`}
            title={previewing ? "Stop the preview" : "Preview in your headphones"}
            onClick={() => (previewing ? d.audio.stopPreview() : d.audio.previewPlaylist(p.id))}
          >
            <Icon name="headphones" />
          </button>
          {p.lane !== "fx" && <ListButtons box={box} what={what} dataLv={dataLv} />}
          <PlayButton box={box} what={what} dataLv={dataLv} extra=", from its first track" />
        </span>
      </div>
      {open && (
        <ol className="lv-list lv-sub" id={subId} aria-label={`Tracks in ${p.name}`}>
          {list.map(trackRow)}
        </ol>
      )}
    </li>
  );
}

/**
 * A scene's ambience as a row (round 6 part 6): Preview, Play next and Add to queue (the room's next ambience, played
 * on Next on the ambience), and Play on air (the room's ambience now, crossfading).
 */
export function AmbienceRow({ scene, place, dataLv }: { scene: SceneInfo; place: UsePlace; dataLv: string }) {
  const d = useLive();
  const previewKey = usePreviewKey();
  const ref = scene.ambience;
  const id = ref?.id ?? null;
  const p = ref?.kind === "playlist" ? d.index.playlist(ref.id) : undefined;
  const t = ref?.kind === "track" ? d.index.track(ref.id) : undefined;
  const name = p ? p.name : t ? trackNameAt(t, place, d.names).name : "";
  if (!id || (!p && !t)) {
    return (
      <div className="lv-in-line">
        <span className="lane-dot amb" aria-hidden="true" />
        <span className="sr-only">Ambience: </span>
        <span className="grow ellipsis">
          <span className="faint">No ambience</span>
        </span>
      </div>
    );
  }
  const on = d.now.rooms.some((r) => (p ? r.ambience?.playlistId === p.id : r.ambience?.trackId === id));
  const previewing = previewKey === (p ? `pl:${p.id}` : id);
  const what: PlayWhat = p ? { kind: "playlist", playlist: p, place, name } : { kind: "track", track: t!, place, name };
  return (
    <div className={cx("lv-in-line lv-trk-r lv-amb-r", on && "on")} role="group" aria-label={`Ambience: ${name}`}>
      <span className="lane-dot amb" aria-hidden="true" />
      <span className="sr-only">Ambience: </span>
      <span className="grow ellipsis" title={name}>
        {name}
      </span>
      <span className={cx("lv-trk-acts", on && "shown")}>
        <button
          type="button"
          className={cx("closer lv-pvb", !previewing && "lv-hov")}
          data-lv={`${dataLv}-v`}
          aria-pressed={previewing}
          aria-label={`Preview: ${name}`}
          title={previewing ? "Stop the preview" : "Preview in your headphones (players do not hear it)"}
          onClick={() => (previewing ? d.audio.stopPreview() : p ? d.audio.previewPlaylist(p.id) : d.audio.previewTrack(t!.id))}
        >
          <Icon name="headphones" />
        </button>
        <ListButtons box="music" what={what} dataLv={dataLv} />
        <PlayButton box="music" what={what} dataLv={dataLv} extra=", as the ambience now (crossfading)" />
      </span>
    </div>
  );
}

/**
 * A scene's music in its order (live.js sceneList): tracks as rows, playlists as rows that unfold (folded at first).
 * In the running scene a row plays as a step of the scene (Next follows the scene's order) and is on air only at its
 * own step. In a scene that is not running (SHW-7), Play on air plays that item only and does not start the scene:
 * a track plays now and the room's list carries on after it; a playlist plays in the scene's order for it.
 */
export function SceneMusicList({ scene, label, running, keyPrefix }: { scene: SceneInfo; label: string; running: boolean; keyPrefix: string }) {
  const d = useLive();
  const { index, campaign, session, now, orders } = d;
  const ref = sceneRefOf(campaign.id, session.id, scene);
  const place = scenePlace(ref);
  const seed = running ? seedOfScene(now, ref) : undefined;
  const lib = showLibraryOf(index, d.campaigns, d.overrides, orders);
  const steps = sceneSteps(lib, ref, seed ?? 0);
  // The steps on air from this scene in any room.
  const onSteps = new Set(now.rooms.flatMap((r) => (r.music?.origin.kind === "scene" && sameRef(r.music.origin.scene, ref) ? [r.music.origin.at] : [])));
  const repeatIn = { ref, name: scene.name };
  const trackOn = (at: number, trackId: string) => (running ? onSteps.has(at) : trackOnAir(d, trackId));
  return (
    <ol className="lv-list lv-items" aria-label={label}>
      {scene.music.map((item, i) => {
        const first = steps.findIndex((s) => s.itemIndex === i);
        const key = `${keyPrefix}${i}`;
        if (item.kind === "track") {
          const t = index.track(item.id);
          if (!t) return null;
          return (
            <TrackRow
              key={`${i}-${t.id}`}
              track={t}
              rowKey={`${key}:${t.id}`}
              num={running ? i + 1 : undefined}
              place={place}
              playlistId={null}
              from={running && first > -1 ? { scene: ref, at: first } : undefined}
              box="music"
              on={first > -1 && trackOn(first, t.id)}
              repeatIn={repeatIn}
            />
          );
        }
        const p = index.playlist(item.id);
        if (!p) return null;
        // On air from this scene: the order the engine dealt (its own sequence); else the playlist's order here.
        const dealt =
          running && seed !== undefined
            ? steps.filter((s) => s.itemIndex === i).flatMap((s) => (index.track(s.trackId) ? [index.track(s.trackId)!] : []))
            : playlistInPlace(index, orders, p.id, place);
        const onStep = running ? [...onSteps].find((at) => steps[at]?.itemIndex === i) : undefined;
        const pos = onStep !== undefined ? dealt.findIndex((t) => t.id === steps[onStep].trackId) + 1 : 0;
        return (
          <PlaylistRow
            key={`${i}-${p.id}`}
            playlist={p}
            rowKey={key}
            num={running ? i + 1 : undefined}
            place={place}
            box="music"
            on={running ? onStep !== undefined : undefined}
            playingAt={pos}
            tracks={dealt}
            first={running && first > -1 ? { trackId: steps[first].trackId, from: { scene: ref, at: first } } : undefined}
            trackRow={(t) => {
              const at = steps.findIndex((s) => s.itemIndex === i && s.trackId === t.id);
              return (
                <TrackRow
                  key={t.id}
                  track={t}
                  rowKey={`${key}:${t.id}`}
                  place={place}
                  playlistId={p.id}
                  from={running && at > -1 ? { scene: ref, at } : { playlistId: p.id, place }}
                  box="music"
                  on={at > -1 && trackOn(at, t.id)}
                  inner
                  repeatIn={repeatIn}
                />
              );
            }}
          />
        );
      })}
    </ol>
  );
}
