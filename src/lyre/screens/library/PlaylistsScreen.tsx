/**
 * Playlists (route `playlists`) and one playlist (route `playlist/<id>`), design/prototype/src/views/playlists.js.
 *
 * A playlist is Manual (tracks in an order you choose) or Dynamic (every track matching its tag rules), in a lane:
 * Music, Ambience or FX (effects and stings). The list shows each in one line with Preview, Play on air and ⋯; a
 * row opens in place to show its tracks and where it is used. Audio files dropped on a manual playlist join it and
 * the Library.
 */
import React, { useMemo, useState } from "react";
import type { PlaylistInfo } from "../../../common/lyre/api";
import { useLyreApi } from "../../api";
import { useNowPlaying } from "../../audio";
import { Column, Pane } from "../../kit/Pane";
import { Icon } from "../../kit/Icon";
import { useAnnounce } from "../../shell/Announcer";
import { hashOf } from "../../shell/routes";
import type { ScreenProps } from "../index";
import { KIND_NAMES, fmtLong, ruleWords, shownTitle } from "./model";
import { nameUses, usePlaylistData, usedText, type PlaylistData } from "./playlistData";
import { DropNotice, DropZone, dropFiles, useDropState, useFileDrops, type DropTarget } from "./playlistDrops";
import { KIND_WORDS, matchesQuery, newlyMade, soundName, useDropActions } from "./playlistParts";
import { PlaylistPage } from "./PlaylistPage";
import { UseInDialog } from "./UseInDialog";
import { onAirPlaylistIds, PlayOnAirButton, PlaylistContents, PopMenuButton, PreviewButton, TwoLines, useSoundMessages, useWriteResult, type PopMenuEntry } from "./shared";
import "./library.css";
import "./playlists.css";

export { PlaylistPage as PlaylistScreen };

type Filter = { lane: "all" | "music" | "amb" | "fx"; kind: "all" | "manual" | "dynamic"; used: "all" | "used" | "unused"; q: string };
const NO_FILTER: Filter = { lane: "all", kind: "all", used: "all", q: "" };
/** The list's filters and open rows, kept for the visit (the prototype's `filt` and L.state.xp). */
let keptFilter: Filter = NO_FILTER;
const keptOpen = new Set<string>();
/** A fresh list (tests). */
export function resetPlaylistsView(): void {
  keptFilter = NO_FILTER;
  keptOpen.clear();
}

export function PlaylistsScreen(_props: ScreenProps) {
  useSoundMessages();
  const api = useLyreApi();
  const { say, toast } = useAnnounce();
  const accept = useWriteResult();
  const data = usePlaylistData();
  const now = useNowPlaying();
  const drops = useDropState();
  const actions = useDropActions(data);
  const [filter, setFilterState] = useState<Filter>(keptFilter);
  const [open, setOpen] = useState<Set<string>>(() => new Set(keptOpen));
  const [useIn, setUseIn] = useState<string | null>(null);
  const onAir = useMemo(() => onAirPlaylistIds(now), [now]);
  const { playlists, groupNames } = data;

  const setFilter = (change: Partial<Filter>) => {
    keptFilter = { ...filter, ...change };
    setFilterState(keptFilter);
    return keptFilter;
  };
  const shown = playlists.filter((p) => {
    if (filter.lane !== "all" && p.lane !== filter.lane) return false;
    if (filter.kind !== "all" && p.kind !== filter.kind) return false;
    const used = data.usesOf(p.id).length > 0;
    if (filter.used === "used" && !used) return false;
    if (filter.used === "unused" && used) return false;
    const text = `${p.name} ${KIND_WORDS[p.kind].name} ${KIND_NAMES[p.lane]} ${p.kind === "dynamic" ? ruleWords(p.rule, groupNames) : ""}`.toLowerCase();
    return !filter.q || matchesQuery(text, filter.q);
  });
  const countShown = (f: Filter) =>
    playlists.filter(
      (p) =>
        (f.lane === "all" || p.lane === f.lane) &&
        (f.kind === "all" || p.kind === f.kind) &&
        (f.used === "all" || (data.usesOf(p.id).length > 0) === (f.used === "used")),
    ).length;
  const anyFilter = filter.lane !== "all" || filter.kind !== "all" || filter.used !== "all" || !!filter.q;
  const toggleOpen = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    keptOpen.clear();
    next.forEach((x) => keptOpen.add(x));
    setOpen(next);
  };

  const create = async (kind: "manual" | "dynamic", lane: "music" | "amb" | "fx") => {
    const name = `New ${lane === "fx" ? "FX" : KIND_NAMES[lane].toLowerCase()} playlist`;
    const made = accept(await api.playlists.create(kind === "manual" ? { name, kind, lane, trackIds: [] } : { name, kind, lane, rule: { conds: [] } }));
    if (!made) return;
    window.location.hash = hashOf(`playlist/${made.id}`);
    toast("New playlist made. Give it a name.");
    // The new playlist's page opens with its name ready to type (PlaylistPage reads this).
    newlyMade.add(made.id);
  };
  const newMenu = (): PopMenuEntry[] => {
    const item = (kind: "manual" | "dynamic", lane: "music" | "amb" | "fx", sub: string): PopMenuEntry => ({
      content: <TwoLines icon={KIND_WORDS[kind].icon} first={KIND_WORDS[kind].name} second={sub} />,
      onSelect: () => void create(kind, lane),
    });
    return [
      { group: "Music" },
      item("manual", "music", "Pick tracks and put them in order"),
      item("dynamic", "music", "Every track that matches your tag rules"),
      { separator: true },
      { group: "Ambience" },
      item("manual", "amb", "Pick ambience loops by hand"),
      item("dynamic", "amb", "Every ambience track that matches"),
      { separator: true },
      { group: "FX: sound effects and stings" },
      item("manual", "fx", "Pick effects and stings by hand"),
      item("dynamic", "fx", "Every effect or sting that matches"),
    ];
  };

  // Files dropped on a row go into that playlist; anywhere else, Lyre asks which.
  const targetOf = (el: Element | null): DropTarget => {
    const li = el?.closest<HTMLElement>(".pl-item[data-pid]");
    const pl = li ? playlists.find((p) => p.id === li.dataset.pid) : undefined;
    return pl ? { kind: "row", playlist: pl } : { kind: "list" };
  };
  useFileDrops(
    targetOf,
    (t) =>
      t.kind === "row"
        ? t.playlist.kind === "manual"
          ? `Drop to add to ${t.playlist.name}. They also go into your Library.`
          : `${t.playlist.name} is Dynamic: drop to choose what to do.`
        : "Drop on a playlist to add the files to it, or here to choose one. They also go into your Library.",
    (t, paths) => void dropFiles(actions, t, paths),
  );

  const seg = <K extends "lane" | "kind" | "used">(name: K, label: string, options: [Filter[K], string, ("hand" | "tag")?][]) => (
    <div className="seg s" role="group" aria-label={label}>
      {options.map(([v, text, icon]) => (
        <button
          key={v}
          type="button"
          aria-pressed={filter[name] === v}
          onClick={() => {
            const next = setFilter({ [name]: v } as Partial<Filter>);
            say(`${countShown(next)} playlists shown`);
          }}
        >
          {icon && <Icon name={icon} size="s" />}
          {text}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <div className="viewhead">
        <h1>Playlists</h1>
        <span className="muted">
          {playlists.length} playlist{playlists.length === 1 ? "" : "s"}
        </span>
        <span className="grow" />
        <PopMenuButton label="New playlist" className="btn primary" focusKey="plnew" items={newMenu}>
          <Icon name="plus" size="s" />
          New playlist
          <Icon name="chevdown" size="s" />
        </PopMenuButton>
      </div>
      <div className="viewbody fill pl-listbody">
        <DropNotice where="list" actions={actions} playlists={playlists} />
        <div className="pl-tools">
          <div className="search pl-search">
            <Icon name="search" />
            <input
              className="input"
              type="search"
              placeholder="Search playlists"
              aria-label="Search playlists by name or tag"
              data-focus="plfq"
              value={filter.q}
              onChange={(e) => setFilter({ q: e.target.value })}
            />
          </div>
          {seg("lane", "Music, ambience or FX", [
            ["all", "All"],
            ["music", "Music"],
            ["amb", "Ambience"],
            ["fx", "FX"],
          ])}
          {seg("kind", "Manual or dynamic", [
            ["all", "All"],
            ["manual", "Manual", "hand"],
            ["dynamic", "Dynamic", "tag"],
          ])}
          {seg("used", "Used or not", [
            ["all", "All"],
            ["used", "Used"],
            ["unused", "Not used yet"],
          ])}
        </div>
        <Column className="pl-listcol">
          <Pane
            id="pl-all"
            title={anyFilter ? `Showing ${shown.length} of ${playlists.length}` : "All playlists"}
            icon="playlist"
            kind="music"
            noMax
            flush
            status={playlists.some((p) => onAir.has(p.id)) ? { text: "Playing", tone: "live" } : { text: "Ready" }}
            summary="Drop audio files on a row to add them"
          >
            {shown.length ? (
              <>
                <div className="pl-grid pl-colhead" aria-hidden="true">
                  <span>Name</span>
                  <span className="pl-c">Tracks</span>
                  <span className="pl-c">Length</span>
                  <span />
                </div>
                <ul className="pl-list" aria-label="Playlists">
                  {shown.map((p) => (
                    <PlaylistRow key={p.id} p={p} data={data} open={open.has(p.id)} onToggle={() => toggleOpen(p.id)} onAir={onAir.has(p.id)} flash={drops.flash.includes(p.id)} onUseIn={() => setUseIn(p.id)} />
                  ))}
                </ul>
              </>
            ) : data.ready ? (
              <div className="empty">
                No playlists match these filters.{" "}
                <button type="button" className="btn s" onClick={() => setFilter(NO_FILTER)}>
                  Show all playlists
                </button>
              </div>
            ) : (
              <div className="empty">Opening your playlists…</div>
            )}
          </Pane>
        </Column>
      </div>
      <DropZone />
      {useIn && <UseInDialog playlist={playlists.find((p) => p.id === useIn)} campaigns={data.campaigns} nameOf={soundName(data)} onClose={() => setUseIn(null)} />}
    </>
  );
}

function PlaylistRow({ p, data, open, onToggle, onAir, flash, onUseIn }: { p: PlaylistInfo; data: PlaylistData; open: boolean; onToggle: () => void; onAir: boolean; flash: boolean; onUseIn: () => void }) {
  const tracks = data.tracksOf(p);
  const uses = data.usesOf(p.id);
  const kind = KIND_WORDS[p.kind];
  const rule = p.kind === "dynamic" ? ruleWords(p.rule, data.groupNames) : "";
  const len = fmtLong(tracks.reduce((s, t) => s + t.durationMs, 0));
  const usedWords = uses.length ? `used in ${usedText(uses)}` : "not used yet";
  const tip = `${kind.name}${rule ? `: ${rule}` : ""} · ${KIND_NAMES[p.lane]}\n${uses.length ? `Used in ${usedText(uses)}` : "Not used yet"}\nClick to open`;
  const name = p.name || "Untitled playlist";
  return (
    <li className={`pl-item${open ? " pl-open" : ""}${flash ? " pl-flash" : ""}`} data-pid={p.id}>
      <div
        className="pl-grid pl-row"
        title={tip}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, a")) return;
          window.location.hash = hashOf(`playlist/${p.id}`);
        }}
      >
        <div className="pl-namecell">
          <button
            type="button"
            className="xp-btn"
            aria-expanded={open}
            title={`${open ? "Hide" : "Show"} what is in ${name}`}
            aria-label={`${open ? "Hide" : "Show"} contents of ${name}`}
            onClick={onToggle}
          >
            <Icon name="chevdown" size="s" />
          </button>
          <span className="pl-kicon" aria-hidden="true">
            <Icon name={kind.icon} size="s" />
          </span>
          <span className={`lane-dot ${p.lane}`} aria-hidden="true" />
          <a href={hashOf(`playlist/${p.id}`)} className="ellipsis pl-nm">
            {name}
            <span className="sr-only">
              , {kind.name}, {KIND_NAMES[p.lane]}, {usedWords}
            </span>
          </a>
          {onAir && <span className="badge onair">On air</span>}
        </div>
        <div className="num pl-c" aria-label={`${tracks.length} track${tracks.length === 1 ? "" : "s"}`}>
          {tracks.length}
        </div>
        <div className="num pl-c muted" aria-label={`Length ${len}`}>
          {len}
        </div>
        <div className="pl-racts">
          <PreviewButton kind="playlist" id={p.id} name={name} />
          <PlayOnAirButton kind="playlist" id={p.id} name={name} empty={tracks.length === 0} />
          <PopMenuButton
            label={`More for ${name}`}
            ariaLabel={`More for ${name}`}
            title="More"
            className="btn s icon ghost pl-more-btn"
            items={() => [
              {
                content: (
                  <>
                    <Icon name="right" size="s" />
                    Open
                  </>
                ),
                onSelect: () => (window.location.hash = hashOf(`playlist/${p.id}`)),
              },
              {
                content: (
                  <>
                    <Icon name="link" size="s" />
                    Use in…
                  </>
                ),
                onSelect: onUseIn,
              },
            ]}
          >
            <Icon name="more" size="s" />
          </PopMenuButton>
        </div>
      </div>
      {open && (
        <div className="xp-body pl-xp">
          <p className="pl-xpmeta">
            {rule && (
              <span>
                <Icon name="tag" size="s" />
                {rule}
              </span>
            )}
            <span>
              <Icon name="link" size="s" />
              {uses.length ? nameUses(uses, data.campaigns).map((u) => u.label).join("; ") : "Not used yet"}
            </span>
          </p>
          <PlaylistContents playlistId={p.id} name={name} dynamic={p.kind === "dynamic"} tracks={tracks.map((t) => ({ id: t.id, title: shownTitle(t), durationMs: t.durationMs }))} />
        </div>
      )}
    </li>
  );
}
