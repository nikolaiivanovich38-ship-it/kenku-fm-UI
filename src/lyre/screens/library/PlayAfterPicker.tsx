/**
 * Round 9 (ROUND9.md §9, item 5: "Better interface (inc. search and splits by playlist, fx, ambience, ordinary track)
 * for follow with picker"): At its end › Play… as a picker (r9track.js pickerBody). Search, All · Playlists · Music ·
 * Ambience · FX with counts, the results under those headings with Preview, and Nothing at the top. A double-click
 * chooses at once. The Library's details and the Audio profile open the same picker.
 */
import React, { useMemo, useState } from "react";
import { isFx, playlistTracks, type SoundRef } from "../../../common/domain";
import { lookupFrom } from "../../../common/lyre/lookup";
import type { LibraryTrack, PlaylistInfo, TagGroup } from "../../../common/lyre/api";
import { lengthText, shownTitle } from "../../../common/lyre/text";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { Icon } from "../../kit/Icon";
import { cx } from "../../kit/cx";
import { PreviewButton } from "../../kit/SoundButtons";
import { searchWords } from "./model";

type Group = "pl" | "music" | "amb" | "fx";
type Tab = "all" | Group;

interface Option {
  group: Group;
  ref: SoundRef;
  name: string;
  sub: string;
  /** The lane dot's colour. */
  lane: "music" | "amb" | "fx";
  /** Every word a search can find it by. */
  hay: string;
}

const TABS: readonly (readonly [Tab, string])[] = [
  ["all", "All"],
  ["pl", "Playlists"],
  ["music", "Music"],
  ["amb", "Ambience"],
  ["fx", "FX"],
];
const HEADINGS: readonly (readonly [Group, string])[] = [
  ["pl", "Playlists"],
  ["music", "Music"],
  ["amb", "Ambience"],
  ["fx", "FX and short cues"],
];
const LANE_WORDS = { music: "Music", amb: "Ambience", fx: "FX" } as const;
/** Each heading lists this many at most; the search finds the rest. */
const MAX_PER_GROUP = 40;

const keyOf = (ref: SoundRef | null) => (ref ? `${ref.kind}:${ref.id}` : "");

export interface PlayAfterPickerProps {
  track: LibraryTrack;
  tracks: readonly LibraryTrack[];
  playlists: readonly PlaylistInfo[];
  groups?: readonly TagGroup[];
  onClose: () => void;
  /** The choice: a playlist or a track, or null for Nothing. */
  onDone: (ref: SoundRef | null) => void;
}

export function PlayAfterPicker({ track, tracks, playlists, onClose, onDone }: PlayAfterPickerProps) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [pick, setPick] = useState(keyOf(track.follow ?? null));
  const title = shownTitle(track);

  const pool = useMemo<Option[]>(() => {
    const lookup = lookupFrom(tracks, playlists);
    const pls = playlists.map((p): Option => {
      const n = playlistTracks(p, lookup).length;
      const sub = `${p.kind === "dynamic" ? "Dynamic" : "Manual"} · ${LANE_WORDS[p.lane]} · ${n} ${n === 1 ? "track" : "tracks"}`;
      return { group: "pl", ref: { kind: "playlist", id: p.id }, name: p.name, sub, lane: p.lane, hay: `${p.name} ${sub}`.toLowerCase() };
    });
    const trs = tracks
      .filter((x) => x.id !== track.id)
      .map((x): Option => {
        const group: Group = isFx(x) ? "fx" : x.kind === "amb" ? "amb" : "music";
        const sub = `${x.artist ? `${x.artist} · ` : ""}${lengthText(x.durationMs)}`;
        const name = shownTitle(x);
        return { group, ref: { kind: "track", id: x.id }, name, sub, lane: group === "fx" ? "fx" : group, hay: [name, sub, ...Object.values(x.tags).flat()].join(" ").toLowerCase() };
      });
    return [...pls, ...trs];
  }, [tracks, playlists, track.id]);

  const words = searchWords(q);
  const hits = words.length ? pool.filter((o) => words.every((w) => o.hay.includes(w))) : pool;
  const count = (t: Tab) => (t === "all" ? hits.length : hits.filter((o) => o.group === t).length);
  const shown = tab === "all" ? hits : hits.filter((o) => o.group === tab);
  const choose = (key: string) => {
    const found = pool.find((o) => keyOf(o.ref) === key);
    onDone(found ? found.ref : null);
  };

  return (
    <Dialog
      open
      wide
      title="When it ends, play"
      onClose={onClose}
      description={`Choose a playlist or a track to play when ${title} ends. Something waiting in Play next goes first.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => choose(pick)}>
            Done
          </Button>
        </>
      }
    >
      <p className="hint r9-fp-for">
        After <b>{title}</b>
      </p>
      <div className="r9-fp-tools">
        <div className="search grow">
          <Icon name="search" />
          <input className="input" type="search" placeholder="Any word of a title, artist or tag" aria-label="Search playlists and tracks" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="seg s r9-fp-tabs" role="group" aria-label="Show">
          {TABS.map(([t, label]) => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
              {label} <span className="num faint">{count(t)}</span>
            </button>
          ))}
        </div>
      </div>
      <ul className="r9-fp-list" aria-label="When it ends, play">
        <li>
          <label className={cx("r9-fp-row r9-fp-none", !pick && "on")} onDoubleClick={() => onDone(null)}>
            <input type="radio" name="r9fp" value="" checked={!pick} onChange={() => setPick("")} />
            <span className="grow">
              <b>Nothing</b>
              <span className="hint"> · it ends as set</span>
            </span>
          </label>
        </li>
        {HEADINGS.map(([group, heading]) => {
          const list = shown.filter((o) => o.group === group);
          if (!list.length) return null;
          return (
            <React.Fragment key={group}>
              <li className="r9-fp-h">
                {heading} <span className="faint num">{list.length}</span>
              </li>
              {list.slice(0, MAX_PER_GROUP).map((o) => {
                const key = keyOf(o.ref);
                return (
                  <li key={key} className="r9-fp-li">
                    <label className={cx("r9-fp-row", pick === key && "on")} onDoubleClick={() => onDone(o.ref)}>
                      <input type="radio" name="r9fp" value={key} checked={pick === key} onChange={() => setPick(key)} />
                      <span className={cx("lane-dot", o.lane)} aria-hidden="true" />
                      <span className="grow r9-fp-t">
                        <span className="ellipsis">{o.name}</span>
                        <span className="hint ellipsis">{o.sub}</span>
                      </span>
                    </label>
                    <PreviewButton target={o.ref.kind === "playlist" ? { kind: "playlist", id: o.ref.id } : { kind: "track", id: o.ref.id }} name={o.name} />
                  </li>
                );
              })}
            </React.Fragment>
          );
        })}
        {!shown.length && <li className="hint r9-fp-h">Nothing matches “{q}”.</li>}
      </ul>
    </Dialog>
  );
}
