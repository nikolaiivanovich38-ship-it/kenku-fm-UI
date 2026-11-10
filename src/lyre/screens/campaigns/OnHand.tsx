/**
 * Playlists and pad boards kept on hand in every session of a campaign, or every scene of a session: compact rows
 * with an expander (closed), Preview, Play on air for playlists and a ⋯ menu (Open, Remove). They are only assigned
 * here; they are made on the Playlists and Pad boards pages. (views/campaigns.js assigned(), assignedPane, cpadd, cprm.)
 */
import React, { useState } from "react";

import { keyOfPlace, type UsePlace } from "../../../common/domain";
import type { LibraryTrack, Owner, PadBoard, PlaylistInfo } from "../../../common/lyre/api";
import { useLyreApi, useTagGroups } from "../../api";
import { PlayOrderButton } from "../../kit/PlayOrderButton";
import { TagStrip } from "../../kit/TagStrip";
import { IconButton } from "../../kit/Button";
import { ExpanderButton } from "../../kit/Expander";
import { Pane } from "../../kit/Pane";
import { useAnnounce } from "../../shell/Announcer";
import { useSave } from "../../shell/useSave";
import { boardInfo, playlistInfo, plural, trackInfo, type ItemInfo, type LibraryIndex } from "./model";
import { PlayOnAirButton, PreviewButton } from "../../kit/SoundButtons";
import { Contents, RowMenu, useFocusLater, useWrite } from "./parts";
import { LibraryPicker } from "./pickers";
import { TrackUseInDialog } from "./trackDialogs";

type Kind = "playlists" | "boards";

interface ListProps {
  ids: readonly string[];
  /** ORG-12: single tracks kept on hand here, listed after the playlists. */
  trackIds?: readonly string[];
  kind: Kind;
  index: LibraryIndex;
  /** A short word making each row's keys unique on the page ("c" campaign, "s" session, "r" the reminder). */
  scope: string;
  /** Read only (the reminder of the campaign's playlists on a session page): no ⋯ menu. */
  onRemove?: (id: string, kind: "playlists" | "boards" | "tracks") => void;
  removeLabel?: string;
  /** The session or campaign list this is, so Play on air uses its play order and the Now playing bar names it. */
  place?: UsePlace;
  /** ORG-13: Alt+Up or Alt+Down on a playlist's row moves it in this list (from, to). */
  onMove?: (from: number, to: number) => void;
}

/** The session or campaign whose list it is. */
export function placeOfOwner(owner: Owner): UsePlace {
  return owner.sessionId ? { kind: "session", campaignId: owner.campaignId, sessionId: owner.sessionId } : { kind: "campaign", campaignId: owner.campaignId };
}

/** The rows; "No playlists yet." when there are none. */
export function OnHandList({ ids, trackIds = [], kind, index, scope, onRemove, removeLabel, place, onMove }: ListProps) {
  const groups = useTagGroups().data ?? [];
  const [usingIn, setUsingIn] = useState<string | null>(null);
  const tracks = kind === "playlists" ? trackIds.map((id) => index.track(id)).filter((t): t is LibraryTrack => !!t) : [];
  const rows = ids.flatMap((id): Omit<RowProps, "index" | "scope">[] => {
    if (kind === "playlists") {
      const p = index.playlist(id);
      return p ? [{ info: playlistInfo(p, index), playlist: p }] : [];
    }
    const b = index.board(id);
    return b ? [{ info: boardInfo(b), board: b }] : [];
  });
  if (rows.length === 0 && tracks.length === 0) return <p className="cp-none">{kind === "playlists" ? "No playlists yet." : "No pad boards yet."}</p>;
  const usedTrack = usingIn ? index.track(usingIn) : undefined;
  return (
    <>
      <ul className="list cp-alist">
        {rows.map((row, i) => (
          <OnHandRow
            key={row.info.id}
            {...row}
            index={index}
            scope={scope}
            onRemove={onRemove}
            removeLabel={removeLabel}
            place={place}
            onMove={onMove && ((by) => onMove(i, i + by))}
          />
        ))}
        {tracks.map((t) => (
          <SingleTrackRow key={t.id} track={t} groups={groups} scope={scope} onRemove={onRemove} removeLabel={removeLabel} place={place} onUseIn={setUsingIn} />
        ))}
      </ul>
      {usedTrack && <TrackUseInDialog track={usedTrack} index={index} onClose={() => setUsingIn(null)} />}
    </>
  );
}

/**
 * ORG-12: a single track kept on hand, after the playlists ("Single track" and its tags under the name), with Preview,
 * Play on air and ⋯: Open, its waveform, end and fades in this session (PLY-14), Use in… and Remove.
 */
function SingleTrackRow({
  track,
  groups,
  scope,
  onRemove,
  removeLabel,
  place,
  onUseIn,
}: {
  track: LibraryTrack;
  groups: Parameters<typeof TagStrip>[0]["groups"];
  scope: string;
  onRemove?: ListProps["onRemove"];
  removeLabel?: string;
  place?: UsePlace;
  onUseIn: (trackId: string) => void;
}) {
  const info = trackInfo(track);
  const session = place?.kind === "session" ? place : null;
  return (
    <li className="cp-arow-wrap">
      <div className="cp-arow">
        <span className="cp-xpgap" aria-hidden="true" />
        <span className={`lane-dot ${info.lane}`} aria-hidden="true" />
        <span className="cp-it-main">
          <a className="ellipsis grow cp-aname" href={info.href} data-k={`open-${scope}tr${track.id}`} title={`${info.name} · ${info.label} · ${info.sub}`}>
            {info.name}{" "}
            <span className="sr-only">(single track)</span>
          </a>
          <span className="cp-it-sub">
            <span className="faint">Single track</span>
            <TagStrip track={track} groups={groups} />
          </span>
        </span>
        <PreviewButton target={{ kind: "track", id: track.id }} name={info.name} />
        <PlayOnAirButton target={{ kind: "track", id: track.id }} name={info.name} />
        {onRemove && (
          <RowMenu
            label={`More for ${info.name}`}
            k={`more-${scope}tr${track.id}`}
            items={[
              { label: "Open", icon: "right", onSelect: () => (window.location.hash = info.href) },
              ...(session
                ? [{ label: "Waveform, end and fades in this session", icon: "wave" as const, onSelect: () => (window.location.hash = `#/profile/${track.id}/ss:${session.campaignId}:${session.sessionId}`) }]
                : []),
              { label: "Use in…", icon: "link", onSelect: () => onUseIn(track.id) },
              { separator: true },
              { label: removeLabel ?? "Remove", icon: "close", onSelect: () => onRemove(track.id, "tracks") },
            ]}
          />
        )}
      </div>
    </li>
  );
}

interface RowProps {
  info: ItemInfo;
  playlist?: PlaylistInfo;
  board?: PadBoard;
  index: LibraryIndex;
  scope: string;
  onRemove?: ListProps["onRemove"];
  removeLabel?: string;
  place?: UsePlace;
  onMove?: (by: -1 | 1) => void;
}

function OnHandRow({ info, playlist, board, index, scope, onRemove, removeLabel, place, onMove }: RowProps) {
  const [open, setOpen] = useState(false);
  const kindKey = playlist ? "pl" : "bd";
  // ORG-13: Alt+Up or Alt+Down on the row's link or buttons moves it in the list (its own contents keep their keys).
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onMove || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    onMove(event.key === "ArrowUp" ? -1 : 1);
  };
  return (
    <li className="cp-arow-wrap">
      <div className="cp-arow" onKeyDown={onKeyDown}>
        <ExpanderButton label={info.name} expanded={open} onToggle={() => setOpen(!open)} />
        <span className={`lane-dot ${info.lane}`} aria-hidden="true" />
        <a className="ellipsis grow cp-aname" href={info.href} data-k={`open-${scope}${kindKey}${info.id}`} title={`${info.name} · ${info.listSub}${onMove ? " (Alt+Up or Alt+Down moves it)" : ""}`}>
          {info.name}
        </a>
        {playlist ? <PreviewButton target={{ kind: "playlist", id: playlist.id }} name={info.name} /> : board && <PreviewButton target={{ kind: "board", board }} name={info.name} />}
        {playlist && <PlayOnAirButton target={{ kind: "playlist", id: playlist.id, place }} name={info.name} />}
        {playlist && place && <PlayOrderButton playlistId={playlist.id} place={place} />}
        {onRemove && (
          <RowMenu
            label={`More for ${info.name}`}
            k={`more-${scope}${kindKey}${info.id}`}
            items={[
              { label: "Open", icon: "right", onSelect: () => (window.location.hash = info.href) },
              { separator: true },
              { label: removeLabel ?? "Remove", icon: "close", onSelect: () => onRemove(info.id, playlist ? "playlists" : "boards") },
            ]}
          />
        )}
      </div>
      {open && (
        <div className="xp-body cp-xp">
          {playlist ? (
            // PLY-14: a session playlist's tracks open the session's own settings; ORG-13: the order is this list's own.
            <Contents item={{ kind: "playlist", playlist }} index={index} place={place ? keyOfPlace(place) : undefined} />
          ) : (
            board && <Contents item={{ kind: "board", board }} index={index} />
          )}
        </div>
      )}
    </li>
  );
}

export interface OnHandPaneProps {
  /** The box's id (remembered open or closed). */
  paneId: string;
  title: string;
  kind: Kind;
  owner: Owner;
  ids: readonly string[];
  /** ORG-12: single tracks kept on hand (playlists boxes only). */
  trackIds?: readonly string[];
  index: LibraryIndex;
  /** "In every session." */
  why: string;
  /** "every session of The Sunken Crown" */
  where: string;
  /** "campaign" or "session", for "Remove from this campaign". */
  ownerWord: "campaign" | "session";
}

/** A box of playlists or pad boards on hand, with Add playlists… (a picker of the whole library). */
export function OnHandPane({ paneId, title, kind, owner, ids, trackIds = [], index, why, where, ownerWord }: OnHandPaneProps) {
  const api = useLyreApi();
  const write = useWrite();
  const { say, toast } = useAnnounce();
  const focusLater = useFocusLater();
  const [picking, setPicking] = useState(false);
  const scope = ownerWord === "campaign" ? "c" : "s";
  const kindKey = kind === "playlists" ? "pl" : "bd";
  const kindWords = kind === "playlists" ? "playlists" : "pad boards";
  const addKey = `add-${scope}${kindKey}`;

  const save = async (next: string[]) => write(api.campaigns.setOnHand(owner, kind, next));

  const choose = async (chosen: string[]) => {
    setPicking(false);
    const keep = ids.filter((id) => chosen.includes(id));
    const added = chosen.filter((id) => !ids.includes(id));
    const next = [...keep, ...added];
    focusLater(addKey);
    if (next.length === ids.length && next.every((id, i) => id === ids[i])) return;
    if ((await save(next)) !== undefined) say(`${plural(next.length, kind === "playlists" ? "playlist" : "pad board")} now on hand in ${where}`);
  };

  /** ORG-13: the list's own order (Alt+Up / Alt+Down on a row), with the Saved pop-up. */
  const saveWith = useSave();
  const move = async (from: number, to: number) => {
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id);
    focusLater(`open-${scope}${kindKey}${id}`);
    const name = kind === "playlists" ? index.playlist(id)?.name : index.board(id)?.name;
    say(`${name ?? "It"} is now ${to + 1} of ${next.length} in this ${ownerWord}`);
    await saveWith(`order of ${where.replace(/^every (session|scene) of /, "")} ${kind === "playlists" ? "playlists" : "pads"}`, () => api.campaigns.setOnHand(owner, kind, next), {
      key: `apl-${scope}${kindKey}`,
    });
  };

  const remove = async (id: string, what: "playlists" | "boards" | "tracks") => {
    if (what === "tracks") {
      if ((await write(api.campaigns.setOnHand(owner, "tracks", trackIds.filter((x) => x !== id)))) === undefined) return;
      focusLater(addKey);
      const t = index.track(id);
      toast(`Removed "${t ? trackInfo(t).name : "the track"}" from this ${ownerWord}. It is still in the Library.`);
      return;
    }
    const at = ids.indexOf(id);
    const next = ids.filter((x) => x !== id);
    const name = kind === "playlists" ? index.playlist(id)?.name : index.board(id)?.name;
    if ((await save(next)) === undefined) return;
    focusLater(next.length ? `more-${scope}${kindKey}${next[Math.min(at, next.length - 1)]}` : addKey);
    toast(`Removed "${name}" from this ${ownerWord}. It is still on the ${kind === "playlists" ? "Playlists" : "Pad boards"} page.`);
  };

  return (
    <Pane
      id={paneId}
      title={title}
      icon={kind === "playlists" ? "playlist" : "grid"}
      size="auto"
      kind={kind === "playlists" ? "music" : "fx"}
      status={{ text: ids.length + trackIds.length ? String(ids.length + trackIds.length) : "Empty" }}
      // Round 6: "In every session." is read out, not shown (the title says Campaign or Session); new ones are made from the rail.
      description={why}
      actions={
        <IconButton
          icon="plus"
          size="s"
          label={`Add ${kindWords}…`}
          hint={`Add ${kindWords} from your library (${why.replace(/\.$/, "").toLowerCase()})`}
          data-k={addKey}
          onClick={() => setPicking(true)}
        />
      }
    >
      <OnHandList
        ids={ids}
        trackIds={kind === "playlists" ? trackIds : []}
        kind={kind}
        index={index}
        scope={scope}
        onMove={(from, to) => void move(from, to)}
        onRemove={(id, what) => void remove(id, what)}
        removeLabel={`Remove from this ${ownerWord}`}
        place={placeOfOwner(owner)}
      />
      <LibraryPicker
        open={picking}
        kind={kind}
        index={index}
        title={`${kind === "playlists" ? "Playlists" : "Pad boards"} on hand in ${where}`}
        intro={`Tick the ${kindWords} to keep on hand in ${where}.`}
        selected={ids}
        onDone={choose}
        onClose={() => setPicking(false)}
      />
    </Pane>
  );
}
