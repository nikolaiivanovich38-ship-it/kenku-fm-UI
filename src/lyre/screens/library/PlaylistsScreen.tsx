/**
 * Playlists (route `playlists`) and one playlist (route `playlist/<id>`), design/prototype/src/views/playlists.js.
 *
 * A playlist is Manual (tracks in an order you choose) or Dynamic (every track matching its tag rules), in a lane:
 * Music, Ambience or FX (effects and stings). The list shows each in one line with Preview, Play on air and ⋯; a
 * row opens in place to show its tracks and where it is used. Audio files dropped on a manual playlist join it and
 * the Library.
 */
import React, { useEffect, useMemo, useState } from "react";
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
import { DestTag } from "../../kit/DestTag";
import { PlayOrderButton } from "../../kit/PlayOrderButton";
import { onAirPlaylistIds, PlaylistContents, useWriteResult } from "./shared";
import { PopMenuButton, TwoLines, type PopMenuEntry } from "../../kit/PopMenu";
import { PlayOnAirButton, PreviewButton } from "../../kit/SoundButtons";
import { orgDragProps, useFolders } from "../folders/Folders";
import "./library.css";
import "./round9.css";
import "./playlists.css";
import { TopLead } from "../../shell/TopBar";
import { useSave } from "../../shell/useSave";
import { DeletePlaylistDialog } from "./DeletePlaylistDialog";
import { deleteKeyOnRow } from "./PlaylistTrackList";
import { moveIndex, PLAYLIST_SORTS, setPlaylistSort, sortPlaylists, usePlaylistSort } from "./playlistOrder";

export { PlaylistPage as PlaylistScreen };

/** Round 9 (item 38): the playlist being dragged by its grip (a drag of one row onto another), while the drag lasts. */
let draggingPlaylist: string | null = null;

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
  const folders = useFolders("playlists");
  const save = useSave();
  const [deleting, setDeleting] = useState<PlaylistInfo | null>(null);
  /* ----- Round 9 (item 38): Sort, and moving a playlist in Your order ----- */
  const sort = usePlaylistSort();
  const sortName = PLAYLIST_SORTS.find(([k]) => k === sort)?.[1] ?? "Your order";
  const sortMenu = (): PopMenuEntry[] => [
    { group: "Sort the playlists" },
    ...PLAYLIST_SORTS.map(
      ([key, label]): PopMenuEntry => ({
        content: label,
        role: "menuitemradio",
        checked: sort === key,
        onSelect: () => {
          setPlaylistSort(key);
          say(`Playlists: ${label}`);
        },
      }),
    ),
  ];
  /** The control to focus once the moved list is drawn again (by its accessible name). */
  const [refocus, setRefocus] = useState<string | null>(null);
  useEffect(() => {
    if (!refocus) return;
    const el = document.querySelector<HTMLElement>(`[aria-label="${refocus.replace(/["\\]/g, "\\$&")}"]`);
    if (el && document.activeElement !== el) el.focus();
    setRefocus(null);
  }, [playlists, refocus]);
  /** Moves a playlist in Your order (going back to Your order first, and saying so, while another sort is on). */
  const move = async (p: PlaylistInfo, to: Parameters<typeof moveIndex>[2], focusName?: string) => {
    const goingBack = sort !== "own";
    if (goingBack) setPlaylistSort("own");
    const at = moveIndex(playlists, p.id, to);
    if (at === null) {
      if (goingBack) toast("Now in your order");
      return;
    }
    const siblings = playlists.filter((x) => x.folderId === p.folderId).length;
    const done = await save("order of the playlists", () => api.playlists.move(p.id, at), {
      detail: `${goingBack ? "now in your order, " : ""}${p.name || "Untitled playlist"} is ${at + 1} of ${siblings}`,
      key: "pl-order",
    });
    if (done && focusName) setRefocus(focusName);
  };

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
  const sorted = sortPlaylists(
    shown,
    sort,
    {
      count: (p) => data.tracksOf(p).length,
      length: (p) => data.tracksOf(p).reduce((n, t) => n + t.durationMs, 0),
      uses: (p) => data.usesOf(p.id).length,
    },
    playlists,
  );
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
      { group: "FX: sound effects and short cues" },
      item("manual", "fx", "Pick effects and short cues by hand"),
      item("dynamic", "fx", "Every effect or short cue that matches"),
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
          ? `Drop to add to ${t.playlist.name}. They are added to the Track library too.`
          : `${t.playlist.name} is Dynamic: drop to choose what to do.`
        : "Drop on a playlist to add the files to it, or here to choose one. They are added to the Track library too.",
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
        <TopLead />
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
      <div className="viewbody fill pl-listbody" data-scroll="body">
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
          <span className="grow" />
          <PopMenuButton label="Sort the playlists" title="Sort the playlists" className="btn s" items={sortMenu}>
            <Icon name="inorder" size="s" />
            <span className="r9-sortw">{sortName}</span>
            <Icon name="chevdown" size="s" />
          </PopMenuButton>
        </div>
        <Column className="pl-listcol">
          <Pane
            id="pl-all"
            title={anyFilter ? `Showing ${shown.length} of ${playlists.length}` : "All playlists"}
            icon="playlist"
            kind="music"
            noMax
            flush
            status={playlists.some((p) => onAir.has(p.id)) ? { text: "Playing", tone: "live" } : undefined}
          >
            {shown.length ? (
              <>
                <div className="pl-grid pl-colhead" aria-hidden="true">
                  <span>Name</span>
                  <span className="pl-c">Tracks</span>
                  <span className="pl-c">Length</span>
                  <span />
                </div>
                {/* ORG-4: folders first at each level, then the playlists. */}
                {folders.list({
                  label: "Playlists",
                  className: "pl-list",
                  // Round 6 (UX-R3): the list's hover text, not a line in the box header.
                  title: "Drop audio files on a row to add them",
                  all: playlists,
                  shown: sorted,
                  filtered: anyFilter,
                  nameOf: (id) => playlists.find((x) => x.id === id)?.name ?? "The playlist",
                  renderItem: (p) => (
                    <PlaylistRow
                      key={p.id}
                      p={p}
                      data={data}
                      open={open.has(p.id)}
                      onToggle={() => toggleOpen(p.id)}
                      onAir={onAir.has(p.id)}
                      flash={drops.flash.includes(p.id)}
                      onUseIn={() => setUseIn(p.id)}
                      onMoveTo={() => folders.openMoveTo(p, p.name || "Untitled playlist")}
                      ownOrder={sort === "own"}
                      siblings={playlists.filter((x) => x.folderId === p.folderId)}
                      onMove={(id, to, focusName) => {
                        const moving = playlists.find((x) => x.id === id);
                        if (moving) void move(moving, to, focusName);
                      }}
                      onDelete={() => setDeleting(p)}
                    />
                  ),
                })}
              </>
            ) : data.ready && playlists.length === 0 ? (
              // w3-ux 9: a first-time user learns what a playlist is and how to make one.
              <div className="empty">
                <b>No playlists yet.</b> A playlist is music, ambience or effects that play together, in your order or picked by their tags. Start with{" "}
                <b>New playlist</b>, or tick tracks in the Track library and choose <b>New playlist from these</b>.
              </div>
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
      {folders.dialogs}
      {deleting && <DeletePlaylistDialog pl={deleting} data={data} onClose={() => setDeleting(null)} onDeleted={() => setTimeout(() => document.querySelector<HTMLElement>('[data-focus="plfq"]')?.focus(), 30)} />}
      {useIn && <UseInDialog playlist={playlists.find((p) => p.id === useIn)} campaigns={data.campaigns} nameOf={soundName(data)} onClose={() => setUseIn(null)} />}
    </>
  );
}

function PlaylistRow({
  p,
  data,
  open,
  onToggle,
  onAir,
  flash,
  onUseIn,
  onMoveTo,
  ownOrder,
  siblings,
  onMove,
  onDelete,
}: {
  p: PlaylistInfo;
  data: PlaylistData;
  open: boolean;
  onToggle: () => void;
  onAir: boolean;
  flash: boolean;
  onUseIn: () => void;
  /** ORG-4: Move to folder…. */
  onMoveTo: () => void;
  /** Round 9 (item 38): the list is in Your order (each row has a grip). */
  ownOrder: boolean;
  /** The playlists in the same folder, in Your order (Move up is off for the first, Move down for the last). */
  siblings: readonly PlaylistInfo[];
  /** Moves playlist `id` (this one, or one dropped on this row); `focusName`: the control to focus once it is drawn again. */
  onMove: (id: string, to: "up" | "down" | "top" | { before: string } | { after: string }, focusName?: string) => void;
  /** Round 10 fixes (R10-FIX §2): Delete playlist… */
  onDelete: () => void;
}) {
  const tracks = data.tracksOf(p);
  const uses = data.usesOf(p.id);
  const kind = KIND_WORDS[p.kind];
  const rule = p.kind === "dynamic" ? ruleWords(p.rule, data.groupNames) : "";
  const len = fmtLong(tracks.reduce((s, t) => s + t.durationMs, 0));
  const usedWords = uses.length ? `used in ${usedText(uses)}` : "not used yet";
  const tip = `${kind.name}${rule ? `: ${rule}` : ""} · ${KIND_NAMES[p.lane]}\n${uses.length ? `Used in ${usedText(uses)}` : "Not used yet"}\nClick to open`;
  const name = p.name || "Untitled playlist";
  const at = siblings.findIndex((x) => x.id === p.id);
  const [line, setLine] = useState<"before" | "after" | null>(null);
  const moreName = `More for ${name}`;
  return (
    <li
      className={`pl-item${open ? " pl-open" : ""}${flash ? " pl-flash" : ""}${line ? ` r9-pl-${line}` : ""}`}
      data-pid={p.id}
      // Round 9 (item 38): Alt+Up and Alt+Down move the playlist; Delete asks as Delete playlist… does (R10-FIX §2).
      // Alt+arrows in the capture phase: a menu button would take Alt+Down as "open the menu".
      onKeyDownCapture={(e) => {
        if ((e.target as HTMLElement).closest("li") !== e.currentTarget) return;
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && !(e.target as HTMLElement).matches("input, textarea, select")) {
          e.preventDefault();
          e.stopPropagation();
          onMove(p.id, e.key === "ArrowUp" ? "up" : "down", (e.target as HTMLElement).getAttribute("aria-label") ?? moreName);
        }
      }}
      onKeyDown={(e) => {
        const own = (e.target as HTMLElement).closest("li") === e.currentTarget;
        if (!own) return;
        if (deleteKeyOnRow(e)) {
          e.preventDefault();
          onDelete();
        }
      }}
      // An exact line shows where a dragged playlist lands: above this row in its upper half, below it in its lower.
      onDragOver={(e) => {
        const dragged = draggingPlaylist;
        if (!dragged || dragged === p.id || !siblings.some((x) => x.id === dragged)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        const box = e.currentTarget.getBoundingClientRect();
        setLine(e.clientY > box.top + box.height / 2 ? "after" : "before");
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setLine(null);
      }}
      onDrop={(e) => {
        const dragged = draggingPlaylist;
        const where = line;
        setLine(null);
        if (!dragged || !where || dragged === p.id) return;
        e.preventDefault();
        e.stopPropagation();
        draggingPlaylist = null;
        onMove(dragged, where === "before" ? { before: p.id } : { after: p.id });
      }}
    >
      <div
        className="pl-grid pl-row"
        title={tip}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, a, .r9-plgrip")) return;
          window.location.hash = hashOf(`playlist/${p.id}`);
        }}
      >
        <div className="pl-namecell">
          {/* Round 9 (item 38): in Your order, a grip to drag the playlist to its place; the keys do the same. */}
          {ownOrder && (
            <span
              className="r9-plgrip"
              title="Drag to change the order (or Alt+Up / Alt+Down)"
              aria-hidden="true"
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                draggingPlaylist = p.id;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("application/x-lyre-playlist-order", p.id);
                e.currentTarget.closest("li")?.classList.add("r9-pl-dragging");
              }}
              onDragEnd={(e) => {
                draggingPlaylist = null;
                e.currentTarget.closest("li")?.classList.remove("r9-pl-dragging");
              }}
            >
              <Icon name="drag" size="s" />
            </span>
          )}
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
          <a href={hashOf(`playlist/${p.id}`)} className="ellipsis pl-nm" {...orgDragProps("playlists", p.id)}>
            {name}
            <span className="sr-only">
              , {kind.name}, {KIND_NAMES[p.lane]}, {usedWords}
            </span>
          </a>
          {onAir && <DestTag to="air" />}
        </div>
        <div className="num pl-c" aria-label={`${tracks.length} track${tracks.length === 1 ? "" : "s"}`}>
          {tracks.length}
        </div>
        <div className="num pl-c muted" aria-label={`Length ${len}`}>
          {len}
        </div>
        <div className="pl-racts">
          <PreviewButton target={{ kind: "playlist", id: p.id }} name={name} />
          <PlayOnAirButton target={{ kind: "playlist", id: p.id, empty: tracks.length === 0 }} name={name} />
          <PlayOrderButton playlistId={p.id} place={null} />
          <PopMenuButton
            label={moreName}
            ariaLabel={moreName}
            title="More"
            className="btn s icon ghost pl-more-btn"
            items={() => [
              // Round 9 (item 38): Your order from the keyboard too (Alt+Up, Alt+Down).
              {
                content: (
                  <>
                    <Icon name="chevup" size="s" />
                    Move up<span className="kbd pl-mk">Alt+↑</span>
                  </>
                ),
                disabled: at <= 0,
                onSelect: () => onMove(p.id, "up", moreName),
              },
              {
                content: (
                  <>
                    <Icon name="chevdown" size="s" />
                    Move down<span className="kbd pl-mk">Alt+↓</span>
                  </>
                ),
                disabled: at < 0 || at >= siblings.length - 1,
                onSelect: () => onMove(p.id, "down", moreName),
              },
              {
                content: (
                  <>
                    <Icon name="chevup" size="s" />
                    Move to the top
                  </>
                ),
                disabled: at <= 0,
                onSelect: () => onMove(p.id, "top", moreName),
              },
              { separator: true },
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
              {
                content: (
                  <>
                    <Icon name="folder" size="s" />
                    Move to folder…
                  </>
                ),
                onSelect: onMoveTo,
              },
              // Round 10 fixes (R10-FIX §2): delete it from here, without opening it (it asks first, then Undo).
              { separator: true },
              {
                content: (
                  <>
                    <Icon name="trash" size="s" />
                    Delete playlist…
                  </>
                ),
                onSelect: onDelete,
              },
            ]}
          >
            <Icon name="more" size="s" />
          </PopMenuButton>
          {/* Round 10 (prep review D6, P14): its page in one click. */}
          <a className="btn s icon r10-open" href={hashOf(`playlist/${p.id}`)} aria-label={`Open ${name}`} title="Open its page">
            <Icon name="right" size="s" />
          </a>
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
          <PlaylistContents
            playlist={p}
            playlistId={p.id}
            name={name}
            dynamic={p.kind === "dynamic"}
            groups={data.groups}
            tracks={tracks.map((t) => ({ id: t.id, title: shownTitle(t), durationMs: t.durationMs, tags: t.tags, shape: t.shape, suggestedShape: t.suggestedShape }))}
          />
        </div>
      )}
    </li>
  );
}
