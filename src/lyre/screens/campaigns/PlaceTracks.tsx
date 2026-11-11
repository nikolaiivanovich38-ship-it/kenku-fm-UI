/**
 * A playlist's tracks in one place, a scene, a session's or a campaign's list (views/_shared.js contentsHTML with an
 * orderKey). ORG-13 (round 6): the order can be changed for this place only: drag a track, or press Alt+Up or
 * Alt+Down on any of its buttons; the Reorder switch (round 6 review Must 3, WCAG 2.5.7; Nik 6 Nov 13:51) shows Move
 * up and Move down on each row while it is on, so a single click does what a drag does. "Back to the playlist's
 * order" shows once the order differs. Each track has Preview and Play on air (0.5.1). In a scene or session each track shows its name there (DAT-14), its tags
 * (ORG-11) and its waveform, end and fades there (PLY-14); in a scene a music track has Repeat one (PLY-17).
 */
import React, { useEffect, useRef, useState } from "react";
import { keyOfPlace, placeOrderToKeep, tracksInPlaceOrder, type UsePlace } from "../../../common/domain";
import type { LibraryTrack } from "../../../common/lyre/api";
import { shownTitle } from "../../../common/lyre/text";
import { useCampaigns, useLyreApi, useTagGroups, useTrackOrders } from "../../api";
import { Button } from "../../kit/Button";
import { Icon } from "../../kit/Icon";
import { ProfileLink } from "../../kit/ProfileLink";
import { RepeatOneButton } from "../../kit/RepeatOneButton";
import { PlayOnAirButton, PreviewButton } from "../../kit/SoundButtons";
import { TagStrip } from "../../kit/TagStrip";
import { ownNameTitle, trackNameAt, useTrackNames } from "../../kit/trackName";
import { useAnnounce } from "../../shell/Announcer";
import { useSave } from "../../shell/useSave";
import { formatLength } from "./model";

/** "in this scene", "in this session", "in this campaign". */
export function placeWords(place: UsePlace): string {
  return `in this ${place.kind}`;
}

/** The Reorder switch of each list, kept while the page is open (it shows the buttons; it changes nothing). */
const reordering = new Set<string>();

export function PlaceTracks({ name, playlistId, lane, tracks, place }: { name: string; playlistId: string; lane: string; tracks: readonly LibraryTrack[]; place: UsePlace }) {
  const api = useLyreApi();
  const save = useSave();
  const { say } = useAnnounce();
  const groups = useTagGroups().data ?? [];
  const orders = useTrackOrders().data;
  const campaigns = useCampaigns().data;
  const names = useTrackNames();
  const key = keyOfPlace(place);
  const group = `${key}|${playlistId}`;
  const [on, setOn] = useState(() => reordering.has(group));
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const focusAfter = useRef<{ trackId: string; control: string } | null>(null);
  // While a new order is being saved it shows at once; the library's answer then takes over.
  const [shown, setShown] = useState<string[] | null>(null);
  const saved = orders?.[key]?.[playlistId];
  useEffect(() => setShown(null), [saved]);
  const ordered = shown ? tracksInPlaceOrder(tracks, shown) : tracksInPlaceOrder(tracks, saved);
  const own = !!saved?.length && placeOrderToKeep(tracks.map((t) => t.id), saved) !== null;
  const words = placeWords(place);
  const descId = `ro-d-${group.replace(/[^\w-]/g, "_")}`;
  const scene = place.kind === "scene" ? campaigns?.find((c) => c.id === place.campaignId)?.sessions.find((s) => s.id === place.sessionId)?.scenes.find((x) => x.id === place.sceneId) : undefined;

  useEffect(() => {
    const want = focusAfter.current;
    if (!want) return;
    const box = listRef.current?.querySelector<HTMLElement>(`[data-tid="${CSS.escape(want.trackId)}"] [data-ctl="${want.control}"]`);
    const el = box?.matches("button, a") ? box : box?.querySelector<HTMLElement>("button, a");
    if (el) {
      focusAfter.current = null;
      el.focus();
    }
  });

  const move = async (from: number, to: number, control?: string) => {
    if (to < 0 || to >= ordered.length || from === to) return;
    const ids = ordered.map((t) => t.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    setShown(ids);
    if (control) focusAfter.current = { trackId: id, control };
    const t = ordered[from];
    say(`${shownTitle(t)} is now ${to + 1} of ${ids.length} ${words}`);
    await save(`order of ${name} ${words}`, () => api.playlists.setTrackOrder(playlistId, place, ids), { key: `tro-${group}` });
  };
  const backToOwn = async () => {
    setShown(null);
    await save(`order of ${name} ${words}`, () => api.playlists.clearTrackOrder(playlistId, place), { key: `tro-${group}` });
    say(`${name} plays in its own order ${words}`);
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const control = (event.target as HTMLElement).closest<HTMLElement>("[data-ctl]")?.dataset.ctl ?? "preview";
    void move(index, index + (event.key === "ArrowUp" ? -1 : 1), control);
  };

  return (
    <>
      <div className="ro-own">
        <Button
          size="s"
          icon="drag"
          className="ghost ro-tog"
          pressed={on}
          title={on ? "Done reordering" : "Show Move up and Move down on each track (or drag a track)"}
          onClick={() => {
            if (on) reordering.delete(group);
            else reordering.add(group);
            setOn(!on);
          }}
        >
          Reorder
        </Button>
        {own && (
          <>
            <span className="ro-own-t">Order {words}</span>
            <Button size="s" icon="restart" className="ghost" onClick={() => void backToOwn()}>
              Back to the playlist&apos;s order
            </Button>
          </>
        )}
      </div>
      <p className="sr-only" id={descId}>
        Drag a track, or press Alt+Up or Alt+Down on it, to change the order {words} only.
      </p>
      <ol ref={listRef} className="list ro-list" aria-label={`Tracks in ${name}, in the order ${words}`} aria-describedby={descId}>
        {ordered.map((t, i) => {
          const n = trackNameAt(t, place.kind === "campaign" ? null : place, names);
          return (
            <li
              key={t.id}
              className={dragFrom === i ? "xp-row ro-dragging" : "xp-row"}
              data-tid={t.id}
              onKeyDown={(e) => onKeyDown(e, i)}
              onDragOver={(e) => {
                if (dragFrom === null) return;
                // Handled here: the page's drop guard (SEC-7) would otherwise refuse the drop.
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                e.stopPropagation();
                const from = dragFrom;
                setDragFrom(null);
                void move(from, i);
              }}
            >
              <span
                className="ro-handle"
                draggable
                title={`Drag to change the order ${words} (or Alt+Up / Alt+Down)`}
                aria-hidden="true"
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.effectAllowed = "move";
                  setDragFrom(i);
                }}
                onDragEnd={() => setDragFrom(null)}
              >
                <Icon name="drag" size="s" />
              </span>
              <span className="faint num">{i + 1}</span>
              <span className="grow ellipsis" title={ownNameTitle(n)}>
                {n.name}
              </span>
              {place.kind !== "campaign" && <TagStrip track={t} groups={groups} />}
              <span className="num faint">{formatLength(t.durationMs)}</span>
              {place.kind === "campaign" ? (
                <span data-ctl="profile">
                  <ProfileLink trackId={t.id} title={n.name} place={`pl:${playlistId}`} placeName={`the playlist ${name}`} iconOnly />
                </span>
              ) : (
                <a
                  className="btn s icon cp-prof"
                  data-ctl="profile"
                  href={`#/profile/${t.id}/${key}`}
                  title={`Waveform, end and fades of ${n.name} in this ${place.kind}`}
                  aria-label={`Waveform, end and fades in this ${place.kind}: ${n.name}`}
                >
                  <Icon name="wave" size="s" />
                </a>
              )}
              <span data-ctl="preview">
                <PreviewButton target={{ kind: "track", id: t.id, playlistId }} name={n.name} />
              </span>
              {/* 0.5.1 (Nik, 11 Nov): Play on air for each track, as the playlist's row has. */}
              <span data-ctl="air">
                <PlayOnAirButton target={{ kind: "track", id: t.id, playlistId }} name={n.name} />
              </span>
              {place.kind === "scene" && lane === "music" && (
                <span data-ctl="rep1">
                  <RepeatOneButton scene={place} sceneName={scene?.name || "the scene"} trackId={t.id} name={n.name} on={!!scene?.repeatOnes.includes(t.id)} />
                </span>
              )}
              {on && (
                <span className="ro-btns">
                  <button type="button" className="closer" data-ctl="up" aria-label={`Move up: ${n.name}`} title="Move up (Alt+Up)" disabled={i === 0} onClick={() => void move(i, i - 1, "up")}>
                    <Icon name="chevup" size="s" />
                  </button>
                  <button
                    type="button"
                    className="closer"
                    data-ctl="down"
                    aria-label={`Move down: ${n.name}`}
                    title="Move down (Alt+Down)"
                    disabled={i === ordered.length - 1}
                    onClick={() => void move(i, i + 1, "down")}
                  >
                    <Icon name="chevdown" size="s" />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
