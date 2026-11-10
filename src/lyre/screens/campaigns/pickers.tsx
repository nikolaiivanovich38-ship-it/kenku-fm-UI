/**
 * The pickers the Campaigns screens open (the prototype's _shared.js pickPlaylists, pickBoards, pickSceneMusic and
 * pickAmbience), on the kit's PickerDialog: every row has Preview, and playlists and boards an expander (closed)
 * showing what is inside, so the game master can listen and look before adding.
 */
import React, { useEffect, useMemo, useRef } from "react";

import { isFx, ruleText } from "../../../common/domain";
import type { LibraryTrack, PlaylistInfo } from "../../../common/lyre/api";
import { shownTitle } from "../../../common/lyre/text";
import { useTagGroups } from "../../api";
import { useLyreAudio } from "../../audio/LyreAudioProvider";
import { PickerDialog, type PickerFilter, type PickerItem, type PickerTicks } from "../../kit/Picker";
import { TagStrip } from "../../kit/TagStrip";
import { boardPads, formatLength, laneWord, roleWord, type LibraryIndex } from "./model";
import { PreviewButton } from "../../kit/SoundButtons";
import { Contents } from "./parts";

export type PickerKind = "playlists" | "boards" | "music" | "ambience";

/** Picker item ids: tracks and playlists share one list in the music and ambience pickers. */
export const trackKey = (id: string) => `track:${id}`;
export const playlistKey = (id: string) => `playlist:${id}`;
/** The track or playlist an item id names. */
export function refOfKey(key: string): { kind: "track" | "playlist"; id: string } {
  const at = key.indexOf(":");
  return { kind: key.slice(0, at) as "track" | "playlist", id: key.slice(at + 1) };
}

interface Entry {
  item: PickerItem;
  playlist?: PlaylistInfo;
  track?: LibraryTrack;
  boardId?: string;
}

export interface LibraryPickerProps {
  open: boolean;
  kind: PickerKind;
  index: LibraryIndex;
  title: string;
  intro?: string;
  /** Item ids (boards: board ids; playlists: playlist ids; music and ambience: trackKey or playlistKey). */
  selected: readonly string[];
  onDone: (ids: string[]) => void;
  onClose: () => void;
}


export function LibraryPicker({ open, kind, index, title, intro, selected, onDone, onClose }: LibraryPickerProps) {
  const audio = useLyreAudio();
  // Leaving a picker stops a preview started in it, so nothing it began keeps playing in the headphones afterwards.
  // A preview that was already playing when the picker opened is the game master's own: preparing never stops it
  // (BUG-12).
  const previewAtOpen = useRef<string | null>(null);
  useEffect(() => {
    if (open) previewAtOpen.current = audio.getNowPlaying().preview?.key ?? null;
  }, [open, audio]);
  const stopPreview = () => {
    const playing = audio.getNowPlaying().preview?.key ?? null;
    if (playing !== null && playing !== previewAtOpen.current) audio.stopPreview();
  };
  const groups = useTagGroups().data;
  const groupNames = useMemo(() => Object.fromEntries((groups ?? []).map((g) => [g.id, g.name])), [groups]);

  const entries = useMemo(() => {
    const playlistEntry = (p: PlaylistInfo, group: string, id = p.id): Entry => {
      const tracks = index.tracksOf(p);
      const kindWord = p.kind === "dynamic" ? "Dynamic" : "Manual";
      return {
        playlist: p,
        item: {
          id,
          label: p.name,
          group,
          search: tracks.map(shownTitle).join(" "),
          sub: `${kindWord} · ${laneWord(p.lane)} · ${tracks.length} tracks${p.kind === "dynamic" ? ` · ${ruleText(p.rule, groupNames)}` : ""}`,
        },
      };
    };
    const trackEntry = (t: LibraryTrack, group: string): Entry => {
      const fx = isFx(t);
      const what = fx ? `FX${t.role === "sting" ? " · Sting" : ""}` : `${laneWord(t.kind)}${t.role && t.kind === "music" ? ` · ${roleWord(t.role)}` : ""}`;
      return {
        track: t,
        item: {
          id: trackKey(t.id),
          label: shownTitle(t),
          group,
          search: [t.metaTitle, t.fileName, t.artist, t.album, ...Object.values(t.tags).flat()].join(" "),
          sub: `${what} · ${formatLength(t.durationMs)}${t.metaTitle && t.metaTitle !== t.title ? ` · in the file: ${t.metaTitle}` : ""}`,
        },
      };
    };
    switch (kind) {
      case "playlists":
        return index.playlists.map((p) =>
          playlistEntry(p, p.lane === "amb" ? "Ambience playlists" : p.lane === "fx" ? "FX playlists" : p.kind === "dynamic" ? "Music: dynamic" : "Music: manual"),
        );
      case "boards":
        return index.boards.map(
          (b): Entry => ({
            boardId: b.id,
            item: { id: b.id, label: b.name, sub: `${b.cols} × ${b.rows} grid · ${boardPads(b).length} pads`, search: boardPads(b).map((p) => p.label).join(" ") },
          }),
        );
      case "music":
        return [
          ...index.playlists.filter((p) => p.lane !== "amb").map((p) => playlistEntry(p, "Playlists", playlistKey(p.id))),
          ...index.tracks.filter((t) => t.kind !== "amb").map((t) => trackEntry(t, "Tracks")),
        ];
      case "ambience":
        return [
          ...index.playlists.filter((p) => p.lane === "amb").map((p) => playlistEntry(p, "Ambience playlists", playlistKey(p.id))),
          ...index.tracks.filter((t) => t.kind === "amb").map((t) => trackEntry(t, "Ambience tracks")),
        ];
    }
  }, [kind, index, groupNames]);

  const byId = useMemo(() => new Map(entries.map((e) => [e.item.id, e])), [entries]);
  const filters = useMemo<PickerFilter[] | undefined>(() => {
    if (kind !== "music") return undefined;
    const entry = (item: PickerItem) => byId.get(item.id);
    return [
      { id: "all", label: "All", test: () => true },
      { id: "pl", label: "Playlists", test: (item) => !!entry(item)?.playlist },
      { id: "music", label: "Tracks", test: (item) => !!entry(item)?.track && entry(item)?.track?.kind === "music" && !isFx(entry(item)!.track!) },
      {
        id: "fx",
        label: "FX",
        test: (item) => {
          const e = entry(item);
          return e?.playlist ? e.playlist.lane === "fx" : !!e?.track && isFx(e.track);
        },
      },
    ];
  }, [kind, byId]);

  return (
    <PickerDialog
      open={open}
      title={title}
      intro={intro}
      items={entries.map((e) => e.item)}
      selected={selected}
      multi={kind !== "ambience"}
      filters={filters}
      hint={null}
      renderContents={(item, ticks) => {
        const e = byId.get(item.id);
        // ORG-10: in a scene's music, an open playlist's tracks can be ticked one by one.
        if (e?.playlist && kind === "music") return <InsidePlaylist playlist={e.playlist} index={index} groups={groups ?? []} ticks={ticks} />;
        if (e?.playlist) return <Contents item={{ kind: "playlist", playlist: e.playlist }} index={index} place={null} />;
        const board = e?.boardId ? index.board(e.boardId) : undefined;
        return board ? <Contents item={{ kind: "board", board }} index={index} /> : null;
      }}
      renderActions={(item) => {
        const e = byId.get(item.id);
        if (e?.playlist) return <PreviewButton target={{ kind: "playlist", id: e.playlist.id }} name={e.playlist.name} />;
        if (e?.track)
          return (
            <>
              <TagStrip track={e.track} groups={groups ?? []} />
              <PreviewButton target={{ kind: "track", id: e.track.id }} name={item.label} />
            </>
          );
        const board = e?.boardId ? index.board(e.boardId) : undefined;
        return board ? <PreviewButton target={{ kind: "board", board }} name={board.name} /> : null;
      }}
      onDone={(ids) => {
        stopPreview();
        onDone(ids);
      }}
      onClose={() => {
        stopPreview();
        onClose();
      }}
    />
  );
}

/** ORG-10: a playlist's tracks in the music picker, each with a box that adds that track alone. */
function InsidePlaylist({ playlist, index, groups, ticks }: { playlist: PlaylistInfo; index: LibraryIndex; groups: Parameters<typeof TagStrip>[0]["groups"]; ticks: PickerTicks }) {
  const tracks = index.tracksOf(playlist);
  if (tracks.length === 0) return <p className="hint">No tracks yet.</p>;
  return (
    <div className="pk-inside">
      <p className="hint pk-inside-h">Tick single tracks to add only those, or tick the playlist above to add all of it.</p>
      <ul className="list" aria-label={`Tracks in ${playlist.name}`}>
        {tracks.map((t) => {
          const key = trackKey(t.id);
          return (
            <li key={t.id} className="pk-row pk-inrow">
              <label className="pk-item">
                <input type="checkbox" checked={ticks.isTicked(key)} onChange={(event) => ticks.tick(key, event.target.checked)} />
                <span className="grow ellipsis">{shownTitle(t)}</span>
              </label>
              <TagStrip track={t} groups={groups} />
              <span className="num faint">{formatLength(t.durationMs)}</span>
              <PreviewButton target={{ kind: "track", id: t.id }} name={shownTitle(t)} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
