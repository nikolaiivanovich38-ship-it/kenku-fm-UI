/**
 * Scene music (live.js sceneMusic, sceneList): the scene's tracks and playlists in the order they play (the first
 * scene's on standby), or a session or campaign playlist chosen from its menu, whose single tracks the menu plays too
 * (ORG-12). Each playlist has its play order for where it is shown (PLY-13) and opens in place; Play from the top
 * plays what the box shows. Sound goes to the box's room (To:).
 */
import React from "react";

import type { UsePlace } from "../../../common/domain";
import { usePreviewKey } from "../../audio";
import { DestTag } from "../../kit/DestTag";
import { ExpanderButton } from "../../kit/Expander";
import { Icon } from "../../kit/Icon";
import { Pane } from "../../kit/Pane";
import { PlayOrderButton } from "../../kit/PlayOrderButton";
import { PopMenuButton, type PopMenuEntry } from "../../kit/PopMenu";
import { cx } from "../../kit/cx";
import { useAnnounce } from "../../shell/Announcer";
import { formatLength } from "../campaigns/model";
import { playlistInPlace, sameRef, sceneRefOf, scenePlace, sceneSteps, seedOfScene, showLibraryOf, useBoxTarget, useLive } from "./liveData";
import { playlistGroups, selectedList } from "./liveModel";
import { updateLive } from "./liveState";
import { useFoldedSummary } from "./Scenes";
import { ToChip } from "./ToChip";
import { LIVE_FADE_MS, TrackRow } from "./TrackRow";

export function SceneMusicPane() {
  const live = useLive();
  const { audio, index, campaign, session, scene, state, now } = live;
  const target = useBoxTarget("music");
  const groups = playlistGroups(scene, session, campaign, index);
  const sel = selectedList(state.list, groups, scene);
  const isScene = sel === "scene";
  const playlist = !isScene && sel ? index.playlist(sel) : undefined;
  const listPlace = playlist ? placeOfList(playlist.id, groups, campaign.id, session.id) : null;
  const ref = scene ? sceneRefOf(campaign.id, session.id, scene) : null;
  const label = state.now >= 0 ? "This scene" : "First scene";
  const items = scene?.music.length ?? 0;
  const playing = now.rooms.some((r) => {
    const o = r.music?.origin;
    return isScene ? o?.kind === "scene" && !!ref && sameRef(o.scene, ref) : !!sel && r.music?.playlistId === sel && o?.kind === "playlist";
  });

  const summary = useFoldedSummary("lv-music", true, isScene && scene ? `${scene.name}, in order` : playlist ? playlist.name : "Nothing to play");

  const playFromTop = () => {
    if (isScene && ref) {
      const lib = showLibraryOf(index, live.campaigns, live.overrides, live.orders);
      const first = sceneSteps(lib, ref, 0)[0];
      if (first) for (const t of target.targets) audio.playTrack(first.trackId, { target: t, from: { scene: ref, at: 0 }, fadeMs: LIVE_FADE_MS });
    } else if (playlist) {
      for (const t of target.targets) audio.playPlaylist(playlist.id, { target: t, fadeMs: LIVE_FADE_MS, ...(listPlace ? { place: listPlace } : {}) });
    }
  };

  const actions = (
    <>
      <ToChip box="music" />
      {playlist && <PlayOrderButton playlistId={playlist.id} place={listPlace} />}
      {(isScene ? !!scene : !!playlist) && (
        <button type="button" className="btn s" title={`Play ${isScene ? scene!.name : playlist!.name} from the top${target.inWhere}`} onClick={playFromTop}>
          <Icon name="broadcast" size="s" />
          Play from the top
        </button>
      )}
    </>
  );

  return (
    <Pane
      id="lv-music"
      title="Scene music"
      icon="music"
      kind="music"
      size="auto"
      flush
      noMax
      actions={actions}
      status={playing ? { text: "On air", tone: "live" } : undefined}
      summary={summary}
    >
      <div className="lv-pick" role="group" aria-label="What to play from">
        <button
          type="button"
          className="lv-tab"
          aria-pressed={isScene}
          disabled={!items}
          title={`${label}: its tracks and playlists in order`}
          onClick={() => updateLive({ list: "scene" })}
        >
          <span className="ellipsis">{items ? `${label} (${items})` : `${label}: nothing yet`}</span>
        </button>
        <span className="lv-pick-more">
          <ListMenu which="session" ids={groups.session} trackIds={groups.sessionTracks} sel={sel} />
          <ListMenu which="campaign" ids={groups.campaign} trackIds={groups.campaignTracks} sel={sel} />
        </span>
      </div>
      {isScene && scene && ref ? (
        <SceneList />
      ) : playlist ? (
        <ol className="lv-list" aria-label={`Tracks in ${playlist.name}`}>
          {playlistInPlace(index, live.orders, playlist.id, listPlace).map((t) => (
            <TrackRow key={t.id} track={t} rowKey={`pl:${t.id}`} place={listPlace} playlistId={playlist.id} from={{ playlistId: playlist.id, ...(listPlace ? { place: listPlace } : {}) }} box="music" on={onAirAnywhere(live, t.id)} />
          ))}
        </ol>
      ) : (
        <p className="empty">Nothing is assigned to this scene, session or campaign. Use Off script to find a track.</p>
      )}
    </Pane>
  );
}

/** The session or campaign list a chosen playlist is shown from (its play order there). */
function placeOfList(playlistId: string, groups: ReturnType<typeof playlistGroups>, campaignId: string, sessionId: string): UsePlace | null {
  if (groups.session.includes(playlistId)) return { kind: "session", campaignId, sessionId };
  if (groups.campaign.includes(playlistId)) return { kind: "campaign", campaignId };
  return null;
}

/** Whether any room plays this track now (music or ambience). */
function onAirAnywhere(live: ReturnType<typeof useLive>, trackId: string): boolean {
  return live.now.rooms.some((r) => r.music?.trackId === trackId || r.ambience?.trackId === trackId);
}

/** Session: or Campaign: with its playlists to show and its single tracks to play on air. */
function ListMenu({ which, ids, trackIds, sel }: { which: "session" | "campaign"; ids: string[]; trackIds: string[]; sel: string | null }) {
  const { index, audio } = useLive();
  const target = useBoxTarget("music");
  const { say } = useAnnounce();
  const name = which === "session" ? "Session" : "Campaign";
  if (!ids.length && !trackIds.length) return <span className="lv-pick-none faint">{name}: none</span>;
  const inGroup = !!sel && ids.includes(sel);
  const shown = inGroup ? index.playlist(sel!)?.name : ids.length ? `${ids.length} playlist${ids.length > 1 ? "s" : ""}` : `${trackIds.length} track${trackIds.length > 1 ? "s" : ""}`;
  const items = (): PopMenuEntry[] => [
    { group: which === "session" ? "This session" : "This campaign" },
    ...ids.map((id): PopMenuEntry => {
      const p = index.playlist(id)!;
      return {
        key: id,
        role: "menuitemradio",
        checked: id === sel,
        content: (
          <>
            {id === sel ? <Icon name="check" size="s" /> : <span className="lv-mi-gap" />}
            <span className="grow ellipsis">{p.name}</span> <span className="faint">{index.tracksOf(p).length}</span>
          </>
        ),
        onSelect: () => {
          updateLive({ list: id });
          say(`Showing playlist ${p.name}`);
        },
      };
    }),
    ...(trackIds.length ? [{ group: "Single tracks" } as PopMenuEntry] : []),
    ...trackIds.map((id): PopMenuEntry => {
      const t = index.track(id)!;
      const title = t.title || t.metaTitle || t.fileName;
      return {
        key: `t-${id}`,
        content: (
          <>
            <Icon name="broadcast" size="s" />
            <span className="grow ellipsis">
              Play on air{target.inWhere}: {title}
            </span>{" "}
            <span className="faint">{formatLength(t.durationMs)}</span>
          </>
        ),
        onSelect: () => target.targets.forEach((tg) => audio.playTrack(id, { target: tg, fadeMs: LIVE_FADE_MS })),
      };
    }),
  ];
  return (
    <PopMenuButton label="Playlists" className="btn s lv-pick-menu" title={`${name} playlists: ${ids.map((id) => index.playlist(id)?.name).join(", ")}`} items={items}>
      <span className="faint">{name}:</span> <span className="ellipsis">{shown}</span>
      <Icon name="chevdown" size="s" />
    </PopMenuButton>
  );
}

/** The scene's own list in order: track items as rows, playlist items with an expander (closed at first). */
function SceneList() {
  const live = useLive();
  const { index, campaign, session, scene, state, now, orders } = live;
  const target = useBoxTarget("music");
  const previewKey = usePreviewKey();
  const ref = sceneRefOf(campaign.id, session.id, scene!);
  const place = scenePlace(ref);
  const seed = seedOfScene(now, ref);
  const lib = showLibraryOf(index, live.campaigns, live.overrides, orders);
  const steps = sceneSteps(lib, ref, seed ?? 0);
  // The steps on air from this scene in any room; with none, a row is on air when its track plays anywhere.
  const onSteps = new Set(now.rooms.flatMap((r) => (r.music?.origin.kind === "scene" && sameRef(r.music.origin.scene, ref) ? [r.music.origin.at] : [])));
  const fromScene = onSteps.size > 0;
  const stepOn = (at: number, trackId: string) => (fromScene ? onSteps.has(at) : onAirAnywhere(live, trackId));
  return (
    <ol className="lv-list lv-items" aria-label={`${scene!.name}: music in the order it plays`}>
      {scene!.music.map((item, i) => {
        const first = steps.findIndex((s) => s.itemIndex === i);
        if (item.kind === "track") {
          const t = index.track(item.id);
          if (!t) return null;
          return <TrackRow key={`${i}-${t.id}`} track={t} rowKey={`sc${i}:${t.id}`} num={i + 1} place={place} playlistId={null} from={first > -1 ? { scene: ref, at: first } : undefined} box="music" on={first > -1 && stepOn(first, t.id)} />;
        }
        const p = index.playlist(item.id);
        if (!p) return null;
        const key = `${scene!.id}-${i}`;
        const open = !!state.expanded[key];
        // On air from this scene: the order the engine dealt (its own sequence); else the playlist's own order.
        const dealt =
          seed === undefined
            ? playlistInPlace(index, orders, p.id, place)
            : steps.filter((s) => s.itemIndex === i).flatMap((s) => (index.track(s.trackId) ? [index.track(s.trackId)!] : []));
        const onStep = [...onSteps].find((at) => steps[at]?.itemIndex === i);
        const on = onStep !== undefined || now.rooms.some((r) => r.music?.playlistId === p.id);
        const pos = onStep !== undefined ? dealt.findIndex((t) => t.id === steps[onStep].trackId) : -1;
        const previewing = previewKey === `pl:${p.id}`;
        const subId = `lv-sub-${key}`;
        return (
          <li key={`${i}-${p.id}`} className={cx("lv-pli", on && "on")}>
            <div className="lv-trk-r">
              <span className="num lv-num" aria-hidden="true">
                {i + 1}
              </span>
              <ExpanderButton label={p.name} expanded={open} controls={subId} onToggle={() => updateLive((s) => ({ expanded: { ...s.expanded, [key]: !open } }))} />
              {on && <DestTag to="air" />}
              <Icon name="playlist" size="s" className="lv-pli-i" />
              <span className="lv-pli-n">
                <b className="ellipsis" title={p.name}>
                  {p.name}
                </b>
                <span className="faint ellipsis">
                  {p.kind === "dynamic" ? "Dynamic" : "Manual"} · {dealt.length} tracks{pos > -1 ? ` · playing ${pos + 1} of ${dealt.length}` : ""}
                </span>
              </span>
              <span className="lv-trk-acts">
                <button
                  type="button"
                  className="closer lv-pvb"
                  aria-pressed={previewing}
                  aria-label={`Preview: ${p.name}`}
                  title={previewing ? "Stop the preview" : "Preview in your headphones"}
                  onClick={() => (previewing ? live.audio.stopPreview() : live.audio.previewPlaylist(p.id))}
                >
                  <Icon name="headphones" />
                </button>
                <PlayOrderButton playlistId={p.id} place={place} />
                <button
                  type="button"
                  className="closer"
                  aria-label={`Play on air${target.inWhere}: ${p.name}`}
                  title={`Play on air${target.inWhere}, from its first track`}
                  disabled={first < 0}
                  onClick={() => target.targets.forEach((tg) => live.audio.playTrack(steps[first].trackId, { target: tg, from: { scene: ref, at: first }, fadeMs: LIVE_FADE_MS }))}
                >
                  <Icon name="broadcast" />
                </button>
              </span>
            </div>
            {open && (
              <ol className="lv-list lv-sub" id={subId} aria-label={`Tracks in ${p.name}`}>
                {dealt.map((t) => {
                  const at = steps.findIndex((s) => s.itemIndex === i && s.trackId === t.id);
                  return <TrackRow key={t.id} track={t} rowKey={`sc${i}:${t.id}`} place={place} playlistId={p.id} from={at > -1 ? { scene: ref, at } : undefined} box="music" on={at > -1 && stepOn(at, t.id)} inner />;
                })}
              </ol>
            )}
          </li>
        );
      })}
    </ol>
  );
}
