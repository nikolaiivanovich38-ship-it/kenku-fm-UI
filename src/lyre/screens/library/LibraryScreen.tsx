/**
 * Library (route `library`, and `library/<trackId>` with a track open): every track in three boxes, Filters, Tracks
 * and Details (design/prototype/src/views/library.js).
 *
 * Layout by the app's width: wide (from 1200 px) three columns, closed side boxes fold into 34 px strips; mid (from
 * 820 px) Filters above Tracks with Details on the right; narrow, one column where Details replaces the list and has a
 * Back button. Adding tracks: files, a folder, a watched folder, or files dropped anywhere on the page.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImportSummary, LibraryTrack, TagRef } from "../../../common/lyre/api";
import { useCampaigns, useFolders, useLyreApi, useLyreEvent, useMissingTracks, usePlaylists, useProfileOverrides, useTagGroups } from "../../api";
import { useLyreAudio, useNowPlaying } from "../../audio";
import { Column, Pane } from "../../kit/Pane";
import { Icon } from "../../kit/Icon";
import { PickerDialog } from "../../kit/Picker";
import { cx } from "../../kit/cx";
import { useAnnounce } from "../../shell/Announcer";
import { useUndoNote } from "../../shell/UndoNote";
import { hashOf } from "../../shell/routes";
import { useRememberedOpen } from "../../shell/ShellSettings";
import type { ScreenProps } from "../index";
import { droppedPaths, hasFiles, NOTHING_TO_ADD } from "./drops";
import { FiltersBody } from "./FiltersBody";
import { useLayoutMode } from "./layout";
import { getLibraryState, setLibraryState, useLibraryState, type Guide } from "./libraryState";
import { DEFAULT_FILTER, filterCount, filterSummary, filtersOn, KIND_NAMES, plural, shownTitle, visibleTracks } from "./model";
import { focusSoon, onAirTrackIds, pausedTrackIds, useWriteResult } from "./shared";
import { UseInDialog } from "./UseInDialog";
import { useNormaliseSettings } from "./normalise";
import { NormaliseDialog } from "../../kit/NormaliseChoice";
import { PopMenuButton, TwoLines, type PopMenuEntry } from "../../kit/PopMenu";
import { TagSheet } from "./TagSheet";
import { TrackDetails } from "./TrackDetails";
import { TracksTable } from "./TracksTable";
import { useTrackList } from "./trackStore";
import { SORTS, type SortKey } from "./model";
import { SearchField } from "../../kit/Fields";
import { LibraryMoreMenu } from "../transfer/LibraryMoreMenu";
import "./library.css";
import { TopLead } from "../../shell/TopBar";
import { tagTreeOf } from "../../../common/lyre/lookup";

type Picker = { kind: "bulk" } | { kind: "one"; id: string };

/** Stand-ins while a list loads, the same object each time so memoised work is not redone. */
const NONE: never[] = [];
const NO_OVERRIDES = {};

export function LibraryScreen({ route }: ScreenProps) {
  const api = useLyreApi();
  const audio = useLyreAudio();
  const now = useNowPlaying();
  const { say, toast } = useAnnounce();
  const { offer } = useUndoNote();
  const accept = useWriteResult();
  const st = useLibraryState();
  const { tracks, byId, store } = useTrackList();
  const groups = useTagGroups().data ?? NONE;
  const folders = useFolders().data ?? NONE;
  const playlists = usePlaylists().data ?? NONE;
  const campaigns = useCampaigns().data ?? NONE;
  const overrides = useProfileOverrides().data ?? NO_OVERRIDES;
  const mode = useLayoutMode();
  const [tagging, setTagging] = useState(false);
  const [picker, setPicker] = useState<Picker | null>(null);
  /** PLY-15: the library's Normalise volume dialog. */
  const [normaliseOpen, setNormaliseOpen] = useState(false);
  const normalise = useNormaliseSettings();
  /** ORG-12: the track whose Use in… sheet is open. */
  const [useIn, setUseIn] = useState<string | null>(null);
  const missingList = useMissingTracks().data;
  const missing = useMemo(() => new Set((missingList ?? NONE).map((m) => m.id)), [missingList]);

  const tid = route.params.tid;
  const open = tid ? byId.get(tid) : undefined;
  const all = tracks ?? NONE;
  // DAT-10: a tag finds the tracks of the tags inside it.
  const tree = useMemo(() => tagTreeOf(groups), [groups]);
  const list = useMemo(() => visibleTracks(all, st.filter, st.q, st.sort, missing, tree), [all, st.filter, st.q, st.sort, missing, tree]);
  const sel = useMemo(() => new Set(st.sel), [st.sel]);
  const onAir = useMemo(() => onAirTrackIds(now), [now]);
  const airPaused = useMemo(() => pausedTrackIds(now), [now]);
  const groupNames = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups]);

  /* ----- focus after a route change: the row that opened a track, or Back ----- */
  useEffect(() => {
    const key = getLibraryState().pendingFocus;
    if (!key) return;
    setLibraryState({ pendingFocus: null });
    focusSoon(key);
  }, [tid]);

  const openTrack = useCallback(
    (id: string) => {
      setLibraryState({ cursor: id, pendingFocus: mode === "narrow" ? "lb-back" : `row-${id}` });
      window.location.hash = hashOf(`library/${id}`);
    },
    [mode],
  );
  const closeTrack = () => {
    const cursor = getLibraryState().cursor;
    setLibraryState({ pendingFocus: cursor ? `row-${cursor}` : null });
    window.location.hash = hashOf("library");
  };

  /* ----- selection ----- */
  const toggleSel = useCallback(
    (id: string, range: boolean) => {
      const s = getLibraryState();
      if (range && s.anchor) {
        const ids = list.map((t) => t.id);
        const a = ids.indexOf(s.anchor);
        const b = ids.indexOf(id);
        if (a > -1 && b > -1) {
          const add = ids.slice(Math.min(a, b), Math.max(a, b) + 1).filter((x) => !s.sel.includes(x));
          setLibraryState({ sel: [...s.sel, ...add], anchor: id, cursor: id });
          say(`${s.sel.length + add.length} selected`);
          return;
        }
      }
      const next = s.sel.includes(id) ? s.sel.filter((x) => x !== id) : [...s.sel, id];
      setLibraryState({ sel: next, anchor: id, cursor: id });
      say(`${next.length} selected`);
    },
    [list, say],
  );
  const toggleAll = () => {
    const s = getLibraryState();
    const ids = list.map((t) => t.id);
    const allOn = ids.length > 0 && ids.every((x) => s.sel.includes(x));
    const shown = new Set(ids);
    const next = allOn ? s.sel.filter((x) => !shown.has(x)) : [...s.sel, ...ids.filter((x) => !s.sel.includes(x))];
    setLibraryState({ sel: next });
    say(`${next.length} selected`);
  };
  const extend = useCallback(
    (from: string, to: string) => {
      const s = getLibraryState();
      const next = [...s.sel];
      for (const x of [from, to]) if (!next.includes(x)) next.push(x);
      setLibraryState({ sel: next, anchor: to });
      say(`${next.length} selected`);
    },
    [say],
  );
  const clearSel = () => {
    setLibraryState({ sel: [] });
    say("Selection cleared");
    focusSoon("lb-q");
  };

  const playOnAir = useCallback(
    (id: string) => {
      const t = store.get().byId.get(id);
      if (t && audio.playTrack(id, { fadeMs: 3000 }).ok) toast(`On air: ${shownTitle(t)}`);
    },
    [audio, store, toast],
  );
  const preview = useCallback(
    (id: string): void => {
      audio.previewTrack(id);
    },
    [audio],
  );

  /* ----- playlists from the Library ----- */
  const newPlaylist = useCallback(
    async (ids: string[]) => {
      const count = { music: 0, amb: 0, fx: 0 };
      for (const id of ids) {
        const t = store.get().byId.get(id);
        if (t) count[t.kind]++;
      }
      const lane = (Object.keys(count) as (keyof typeof count)[]).sort((a, b) => count[b] - count[a])[0];
      let n = 1;
      while (playlists.some((p) => p.name === `New playlist ${n}`)) n++;
      const made = accept(await api.playlists.create({ name: `New playlist ${n}`, kind: "manual", lane, trackIds: ids }));
      if (!made) return;
      setLibraryState({ guide: { kind: "playlist-made", playlistId: made.id, name: made.name, count: ids.length } });
      say(`${made.name} made with ${plural(ids.length, "track")}`);
    },
    [accept, api, playlists, say, store],
  );

  const rowMenu = useCallback(
    (t: LibraryTrack): PopMenuEntry[] => {
      const on = getLibraryState().sel.includes(t.id);
      return [
        { content: <Item icon="file" text="Open details" />, onSelect: () => openTrack(t.id) },
        { content: <Item icon="check" text={on ? "Deselect" : "Select"} />, onSelect: () => toggleSel(t.id, false) },
        { content: <Item icon="playlist" text="Add to playlist…" />, onSelect: () => setPicker({ kind: "one", id: t.id }) },
        { content: <Item icon="link" text="Use in…" />, onSelect: () => setUseIn(t.id) },
        { content: <Item icon="fade" text="Audio profile" />, onSelect: () => (window.location.hash = hashOf(`profile/${t.id}`)) },
      ];
    },
    [openTrack, toggleSel],
  );

  /* ----- adding tracks ----- */
  const arrive = useCallback(
    async (summary: ImportSummary, how: string) => {
      if (summary.cancelled && !summary.trackIds.length) return;
      if (!summary.trackIds.length) {
        toast(summary.problems.length ? summary.summary : "There are no audio files there.");
        return;
      }
      await store.reload();
      const ids = summary.trackIds;
      // UX review 6: files already in the Library are named, never counted as added, and selected with the new ones.
      const byId = store.get().byId;
      const alreadyIn = summary.alreadyInLibrary.map((id) => byId.get(id)).filter((t): t is LibraryTrack => Boolean(t)).map((t) => shownTitle(t));
      const guide: Guide = { kind: "added", count: summary.added.length, how, alreadyIn, problems: summary.problems.map((p) => `${fileName(p.file)}: ${p.reason}`) };
      // Only new tracks: show New ones; any already there may not be New, so show everything.
      const filter = alreadyIn.length ? DEFAULT_FILTER : { ...DEFAULT_FILTER, newOnly: true };
      setLibraryState({ filter, q: "", sort: "new", sel: ids, cursor: ids[0], anchor: null, guide });
      if (mode === "narrow" && tid) window.location.hash = hashOf("library");
      say(`${addedWords(summary.added.length, alreadyIn)} Selected.`);
      focusSoon("lb-btag");
    },
    [mode, say, store, tid, toast],
  );
  // Progress shows only while this screen's import runs: over IPC its last events can come after the answer.
  const importing = useRef(false);
  const importFrom = async (source: Parameters<typeof api.import.start>[0], how: string) => {
    importing.current = true;
    let summary: ImportSummary | null;
    try {
      summary = accept(await api.import.start(source));
    } finally {
      importing.current = false;
      if (getLibraryState().guide?.kind === "progress") setLibraryState({ guide: null });
    }
    if (summary) await arrive(summary, how);
  };
  const watch = async () => {
    const root = accept(await api.import.watchFolder({ from: "choose-folder" }));
    if (!root) return;
    setLibraryState({ guide: { kind: "watching", folder: root.path } });
    say(`Watching ${root.path}`);
  };
  useLyreEvent((event) => {
    if (event.type === "import-progress" && importing.current && event.progress.phase !== "done") setLibraryState({ guide: { kind: "progress", text: event.progress.message } });
    if (event.type === "watched-files") {
      void store.reload().then(() => {
        const titles = event.trackIds.map((id) => store.get().byId.get(id)).filter(Boolean).map((t) => shownTitle(t));
        setLibraryState({ guide: { kind: "arrived", folder: event.folder, titles } });
        say(`${titles.length === 1 ? "A new file" : `${titles.length} new files`} appeared in the watched folder: ${titles.join(", ")}`);
      });
    }
  });
  const showNew = () => {
    setLibraryState({ filter: { ...DEFAULT_FILTER, newOnly: true }, q: "", guide: null });
    if (mode === "narrow" && tid) window.location.hash = hashOf("library");
  };

  // Files and folders dropped anywhere on the page join the Library. The listeners stay for the screen's life and
  // call the latest import, so a drag under way keeps its count of entered elements.
  const importRef = useRef(importFrom);
  importRef.current = importFrom;
  useEffect(() => {
    const view = document.getElementById("view");
    if (!view) return;
    let depth = 0;
    const show = (on: boolean) => view.classList.toggle("lb-drop", on);
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      show(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) show(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      show(false);
      const paths = droppedPaths(e.dataTransfer);
      if (!paths.length) {
        toast(NOTHING_TO_ADD);
        return;
      }
      void importRef.current({ from: "paths", paths }, "by dropping");
    };
    view.addEventListener("dragenter", enter);
    view.addEventListener("dragover", over);
    view.addEventListener("dragleave", leave);
    view.addEventListener("drop", drop);
    return () => {
      show(false);
      view.removeEventListener("dragenter", enter);
      view.removeEventListener("dragover", over);
      view.removeEventListener("dragleave", leave);
      view.removeEventListener("drop", drop);
    };
  }, [toast]);

  const addMenu = (): PopMenuEntry[] => [
    { className: "lb-mi", content: <TwoLines bold icon="file" first="Add files…" second="Choose one or more audio files" />, onSelect: () => void importFrom({ from: "choose-files" }, "") },
    { className: "lb-mi", content: <TwoLines bold icon="folder" first="Add a folder…" second="Everything in it, subfolders too" />, onSelect: () => void importFrom({ from: "choose-folder" }, "") },
    { className: "lb-mi", content: <TwoLines bold icon="eye" first="Watch a folder…" second="New files appear by themselves" />, onSelect: () => void watch() },
    { separator: true },
    { group: "Or drop files and folders anywhere on this page" },
  ];

  /* ----- bulk tagging ----- */
  const applyTags = async (how: "add" | "remove", tags: TagRef[]) => {
    const ids = getLibraryState().sel;
    const result = await api.tags.tagTracks(how === "add" ? { trackIds: ids, add: tags } : { trackIds: ids, remove: tags });
    const done = accept(result);
    setTagging(false);
    if (!done) return;
    await store.reload();
    const names = tags.map((x) => x.value);
    const msg = `${how === "add" ? "Added" : "Removed"} ${names.join(", ")} ${how === "add" ? "to" : "from"} ${plural(ids.length, "track")}.`;
    const stillNew = ids.filter((id) => store.get().byId.get(id)?.isNew).length;
    setLibraryState({ guide: { kind: "tagged", text: msg, stillNew } });
    say(msg);
    // w3-ux 10: tagging many tracks at once can be undone from a message (and Ctrl+Z).
    if (result.ok) offer(msg, result.undoLabel);
  };

  const addToPlaylists = async (pids: string[], ids: string[], single: boolean) => {
    if (!pids.length) return;
    const done: string[] = [];
    for (const pid of pids) if (accept(await api.playlists.addTracks(pid, ids))) done.push(pid);
    if (!done.length) return;
    if (single) {
      toast(`Added to ${plural(done.length, "playlist")}`);
      return;
    }
    const named = done.map((pid) => ({ id: pid, name: playlists.find((p) => p.id === pid)?.name ?? "" }));
    setLibraryState({ guide: { kind: "added-to", count: ids.length, playlists: named } });
    say(`Added ${plural(ids.length, "track")} to ${plural(done.length, "playlist")}`);
  };

  /* ----- the boxes ----- */
  const nAll = all.length;
  const nShown = list.length;
  const nFilters = filterCount(st.filter);
  const [fOpen, setFOpen] = useRememberedOpen("lb-filters", mode === "wide");
  const [tOpen, setTOpen] = useRememberedOpen("lb-tracks", true);
  const [dOpen, setDOpen] = useRememberedOpen("lb-details", true);
  const shownSel = list.reduce((k, t) => k + (sel.has(t.id) ? 1 : 0), 0);

  const filtersPane = (strip = false) => (
    <Pane
      id="lb-filters"
      title="Filters"
      icon="rule"
      className={cx("lb-filters", strip && "lb-strip")}
      kind="search"
      open={fOpen}
      onOpenChange={setFOpen}
      summary={filterSummary(st.filter, groups)}
      status={nFilters ? { text: `${nFilters} filter${nFilters > 1 ? "s" : ""} on`, tone: "on" } : undefined}
      actions={
        filtersOn(st.filter) ? (
          <button
            type="button"
            className="btn s ghost"
            onClick={() => {
              setLibraryState({ filter: DEFAULT_FILTER, q: "" });
              say("Filters cleared");
            }}
          >
            Clear all
          </button>
        ) : undefined
      }
    >
      <FiltersBody tracks={all} groups={groups} folders={folders} filter={st.filter} missing={missing} />
    </Pane>
  );

  const emptyText =
    tracks === undefined ? (
      "Opening your library…"
    ) : st.q || filtersOn(st.filter) ? (
      <>
        No track matches.{" "}
        <button type="button" className="btn s" onClick={() => setLibraryState({ filter: DEFAULT_FILTER, q: "" })}>
          Clear search and filters
        </button>
      </>
    ) : (
      // w3-ux 9: a first-time user learns what to do first.
      <>
        <b>Your library is empty.</b> Add music, ambience and sound effects with <b>Add tracks</b>, or drop audio files or a folder here.
      </>
    );

  const tracksPane = (strip = false) => (
    <Pane
      id="lb-tracks"
      title="Tracks"
      icon="library"
      className={cx("lb-tracks", strip && "lb-strip")}
      flush
      kind="music"
      open={tOpen}
      onOpenChange={setTOpen}
      status={st.sel.length ? { text: `${st.sel.length} selected`, tone: "on" } : { text: nShown === nAll ? String(nAll) : `${nShown} of ${nAll}` }}
    >
      <div className="lb-tools">
        <SearchField
          className="grow"
          label="Search tracks"
          placeholder="Search titles, file names, artists, tags"
          value={st.q}
          onChange={(q) => setLibraryState({ q })}
          inputRef={(el) => el?.setAttribute("data-focus", "lb-q")}
        />
        <label className="lb-sortl">
          <span className="sr-only">Sort</span>
          <select className="input lb-sel" aria-label="Sort tracks" value={st.sort} onChange={(e) => setLibraryState({ sort: e.target.value as SortKey })}>
            {SORTS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {st.guide && <GuideLine guide={st.guide} onShowNew={showNew} />}
      {st.sel.length > 0 && (
        <div className="lb-bulk" role="toolbar" aria-label="Selected tracks">
          <b className="lb-bn">{st.sel.length} selected</b>
          {shownSel < st.sel.length && <span className="hint">({st.sel.length - shownSel} not shown)</span>}
          <button type="button" className="btn s primary" data-focus="lb-btag" onClick={() => setTagging(true)}>
            <Icon name="tag" size="s" />
            Tag…
          </button>
          <button type="button" className="btn s" onClick={() => setPicker({ kind: "bulk" })}>
            <Icon name="playlist" size="s" />
            Add to playlist…
          </button>
          <button type="button" className="btn s" onClick={() => void newPlaylist(getLibraryState().sel)}>
            <Icon name="plus" size="s" />
            New playlist from these
          </button>
          <button type="button" className="btn s ghost" onClick={clearSel}>
            Clear selection
          </button>
        </div>
      )}
      <TracksTable
        list={list}
        groupNames={groupNames}
        openId={open?.id}
        sel={sel}
        cursor={st.cursor ?? (open ? open.id : null)}
        onAir={onAir}
        airPaused={airPaused}
        preview={now.preview}
        missing={missing}
        emptyText={emptyText}
        sort={st.sort}
        onOpen={openTrack}
        onToggle={toggleSel}
        onToggleAll={toggleAll}
        onCursor={(id) => setLibraryState({ cursor: id })}
        onExtend={extend}
        onPreview={preview}
        onPlay={playOnAir}
        rowMenu={rowMenu}
        describedBy="lb-keys"
      />
      {/* Round 6: the keys show only while the keyboard is in the list, and are read out with it. */}
      <div className="lb-foot hint keys-on-focus" id="lb-keys">
        Keys: <span className="kbd">↑</span> <span className="kbd">↓</span> move · <span className="kbd">Enter</span> open · <span className="kbd">Space</span> select ·{" "}
        <span className="kbd">P</span> preview · <span className="kbd">A</span> play on air
      </div>
    </Pane>
  );

  const nNewAll = useMemo(() => all.filter((t) => t.isNew || !Object.values(t.tags).some((v) => v.length)).length, [all]);
  const detailsPane = (strip = false) => (
    <Pane
      id="lb-details"
      title="Details"
      icon="file"
      className={cx("lb-details", strip && "lb-strip")}
      kind="plain"
      open={dOpen}
      onOpenChange={setDOpen}
      summary={open ? shownTitle(open) : ""}
      status={open ? (onAir.has(open.id) ? { text: "Playing", tone: "live" } : undefined) : { text: "Empty" }}
      actions={
        open && mode !== "narrow" ? (
          <button type="button" className="closer" title="Close details" aria-label="Close details" onClick={closeTrack}>
            <Icon name="close" />
          </button>
        ) : undefined
      }
    >
      {open ? (
        <TrackDetails
          key={open.id}
          t={open}
          store={store}
          groups={groups}
          playlists={playlists}
          campaigns={campaigns}
          overrides={overrides}
          previewing={now.preview?.key ?? null}
          missing={missing.has(open.id)}
          normalise={normalise}
          onNewPlaylist={(ids) => void newPlaylist(ids)}
          onUseIn={() => setUseIn(open.id)}
        />
      ) : (
        <div className="lb-d lb-dempty">
          <p>Open a track to see its names, file and tags.</p>
          {nNewAll > 0 && (
            <p>
              <button type="button" className="btn s" onClick={showNew}>
                <Icon name="tag" size="s" />
                Show the {plural(nNewAll, "track")} not tagged yet
              </button>
            </p>
          )}
        </div>
      )}
    </Pane>
  );

  let body: React.ReactNode;
  if (mode === "narrow") {
    body = (
      <div className="lb-grid lb-narrow" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
        <Column>{open ? detailsPane() : [<React.Fragment key="f">{filtersPane()}</React.Fragment>, <React.Fragment key="t">{tracksPane()}</React.Fragment>]}</Column>
      </div>
    );
  } else if (mode === "mid") {
    const tC = !tOpen;
    const dC = !dOpen;
    const cols = [tC ? "34px" : "minmax(0,1fr)"];
    if (open) cols.push(dC ? "34px" : tC ? "minmax(0,1fr)" : "minmax(0,.66fr)");
    if (tC && (!open || dC)) cols[0] = "minmax(0,1fr)";
    body = (
      <div className="lb-grid lb-mid" style={{ gridTemplateColumns: cols.join(" ") }}>
        <Column className="lb-maincol">
          {filtersPane()}
          {tracksPane()}
        </Column>
        {open && detailsPane(dC)}
      </div>
    );
  } else {
    const fC = !fOpen;
    const tC = !tOpen;
    const dC = !dOpen;
    const expanded = [!fC, !tC, !dC].filter(Boolean).length;
    const cols = [fC ? "34px" : expanded === 1 ? "minmax(0,1fr)" : "220px", tC ? "34px" : "minmax(0,1fr)", dC ? "34px" : tC ? "minmax(0,1fr)" : open ? "minmax(320px,.62fr)" : "250px"];
    body = (
      <div className="lb-gridwrap" style={{ ["--lb-cols" as string]: cols.join(" ") }}>
        <Column className="lb-grid lb-wide">
          {filtersPane(fC)}
          {tracksPane(tC)}
          {detailsPane(dC)}
        </Column>
      </div>
    );
  }

  return (
    <>
      <div className="viewhead lb-head">
        <TopLead />
        {mode === "narrow" && open && (
          <button type="button" className="btn s" data-focus="lb-back" onClick={closeTrack}>
            <Icon name="chevleft" size="s" />
            Tracks
          </button>
        )}
        <h1>Library</h1>
        <span className="muted lb-count">{plural(nAll, "track")}</span>
        <span className="grow" />
        <PopMenuButton label="Add tracks" className="btn primary" items={addMenu}>
          <Icon name="plus" size="s" />
          Add tracks
          <Icon name="chevdown" size="s" />
        </PopMenuButton>
        <LibraryMoreMenu onNormalise={() => setNormaliseOpen(true)} />
      </div>
      <div className="viewbody fill lb-body" data-scroll="body">{body}</div>
      {tagging && (
        <TagSheet
          tracks={st.sel.map((id) => byId.get(id)).filter((t): t is LibraryTrack => !!t)}
          groups={groups}
          onClose={() => setTagging(false)}
          onApply={applyTags}
        />
      )}
      <NormaliseDialog
        open={normaliseOpen}
        setting={normalise}
        measured={all.filter((t) => t.loudness).length}
        total={all.length}
        onClose={() => setNormaliseOpen(false)}
        onSave={async (setting) => {
          if (accept(await api.library.setNormaliseSettings(setting))) setNormaliseOpen(false);
        }}
      />
      {useIn && (
        <UseInDialog
          track={byId.get(useIn)}
          campaigns={campaigns}
          nameOf={(ref) => (ref.kind === "playlist" ? (playlists.find((p) => p.id === ref.id)?.name ?? "a playlist") : shownTitle(byId.get(ref.id) ?? { title: "a track", metaTitle: "", fileName: "" }))}
          onClose={() => setUseIn(null)}
        />
      )}
      <PickerDialog
        open={picker !== null}
        title={picker?.kind === "one" ? `Add "${shownTitle(byId.get(picker.id) ?? { title: "", metaTitle: "", fileName: "" })}" to playlists` : `Add ${plural(st.sel.length, "track")} to playlists`}
        intro={picker?.kind === "bulk" ? "Only manual playlists are listed. Dynamic playlists pick up tracks by their tags, so tag the tracks instead." : undefined}
        okLabel="Add"
        items={playlists
          .filter((p): p is Extract<typeof p, { kind: "manual" }> => p.kind === "manual" && (picker?.kind !== "one" || !p.trackIds.includes(picker.id)))
          .map((p) => ({ id: p.id, label: p.name, sub: plural(p.trackIds.length, "track"), group: KIND_NAMES[p.lane] }))}
        onClose={() => setPicker(null)}
        onDone={(pids) => {
          const p = picker;
          setPicker(null);
          if (p) void addToPlaylists(pids, p.kind === "one" ? [p.id] : getLibraryState().sel, p.kind === "one");
        }}
      />
    </>
  );
}

function Item({ icon, text }: { icon: React.ComponentProps<typeof Icon>["name"]; text: string }) {
  return (
    <>
      <Icon name={icon} size="s" />
      {text}
    </>
  );
}

/** A file's name from its full path, either style (UX review 12: messages name the file, not where it is). */
function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

/**
 * What an import did, in plain words (UX review 6): "2 tracks added by dropping.", "Dragon roar is already in your
 * Library.", "3 tracks added. Dragon roar and Rain were already in your Library."
 */
function addedWords(count: number, alreadyIn: string[], how = ""): string {
  const names = alreadyIn.length <= 3 ? alreadyIn.join(", ").replace(/, ([^,]*)$/, " and $1") : `${alreadyIn.length} of these files`;
  const already = alreadyIn.length ? `${names} ${alreadyIn.length === 1 ? (count ? "was" : "is") : count ? "were" : "are"} already in your Library.` : "";
  if (!count) return already || "Nothing was added.";
  return `${plural(count, "track")} added${how ? ` ${how}` : ""}.${already ? ` ${already}` : ""}`;
}

/** The line under the search box after an action (role status, so it is read out), with a way to dismiss it. */
function GuideLine({ guide, onShowNew }: { guide: Guide; onShowNew: () => void }) {
  const icon = guide.kind === "added" || guide.kind === "progress" ? "plus" : guide.kind === "tagged" ? "tag" : guide.kind === "watching" || guide.kind === "arrived" ? "eye" : "playlist";
  let text: React.ReactNode;
  let action: React.ReactNode = null;
  switch (guide.kind) {
    case "added": {
      const one = guide.count === 1;
      text = (
        <>
          <b>{addedWords(guide.count, guide.alreadyIn, guide.how)}</b>
          {guide.count > 0 && (
            <>
              {" "}
              Give {one ? "it" : "them"} a title and tags: {one ? "choose" : "select them and choose"} <b>Tag…</b>, or open {one ? "it" : "one"} to edit it.
            </>
          )}
          {guide.problems.length > 0 && ` ${plural(guide.problems.length, "file")} could not be added: ${guide.problems.join("; ")}`}
        </>
      );
      break;
    }
    case "tagged":
      text = (
        <>
          {guide.text}
          {guide.stillNew > 0 &&
            ` ${plural(guide.stillNew, "track")} ${guide.stillNew === 1 ? "still needs" : "still need"} a title of your own: open ${guide.stillNew === 1 ? "it" : "each one"} to type it.`}
        </>
      );
      break;
    case "playlist-made":
      text = (
        <>
          <b>{guide.name}</b> made with {plural(guide.count, "track")}. <a href={hashOf(`playlist/${guide.playlistId}`)}>Open it</a> to name it and choose where it is used.
        </>
      );
      break;
    case "added-to":
      text = (
        <>
          Added {plural(guide.count, "track")} to{" "}
          {guide.playlists.map((p, i) => (
            <React.Fragment key={p.id}>
              {i > 0 && ", "}
              <a href={hashOf(`playlist/${p.id}`)}>{p.name}</a>
            </React.Fragment>
          ))}
          .
        </>
      );
      break;
    case "watching":
      text = (
        <>
          Watching <b>{guide.folder}</b>. Audio files you put there will appear here by themselves, marked New.
        </>
      );
      break;
    case "arrived":
      text = (
        <>
          <b>
            {guide.titles.length === 1 ? "1 new file appeared" : `${guide.titles.length} new files appeared`}
          </b>{" "}
          in {guide.folder}: {guide.titles.join(", ")}.
        </>
      );
      action = (
        <button type="button" className="btn s" onClick={onShowNew}>
          Show new tracks
        </button>
      );
      break;
    case "progress":
      text = guide.text;
      break;
  }
  return (
    <div className="lb-guide" role="status">
      <Icon name={icon} size="s" />
      <span className="grow">{text}</span>
      {action}
      <button
        type="button"
        className="closer"
        title="Dismiss"
        aria-label="Dismiss this message"
        onClick={() => {
          setLibraryState({ guide: null });
          focusSoon("lb-q");
        }}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
