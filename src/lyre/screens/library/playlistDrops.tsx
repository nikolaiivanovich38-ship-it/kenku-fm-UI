/**
 * Audio files dropped on the Playlists screens (playlists.js "dropping files and folders"): on a manual playlist's
 * row or page they go into it (at the place they were dropped) and into the Library; on a dynamic playlist, or beside
 * the list, Lyre asks what to do. The line that says what happened (or asks) stays across a change of screen, as the
 * prototype's `notice` and `pending` do.
 */
import React, { useEffect, useRef, useSyncExternalStore } from "react";
import type { LyreApi, PlaylistInfo } from "../../../common/lyre/api";
import { isRefused } from "../../../common/lyre/api";
import { Icon } from "../../kit/Icon";
import { hashOf } from "../../shell/routes";
import { droppedPaths, hasFiles } from "./drops";
import { setLibraryState } from "./libraryState";
import { DEFAULT_FILTER } from "./model";
import { KIND_NAMES } from "./model";
import { focusSoon } from "./shared";
import type { TrackStore } from "./trackStore";

export type DropWhere = "list" | `page:${string}`;

export interface DropState {
  /** Files waiting for an answer. */
  pending: { where: DropWhere; playlistId: string | null; paths: string[]; count: number } | null;
  /** What happened, as words with the parts to stress. */
  notice: { where: DropWhere; parts: NoticePart[]; open: string | null } | null;
  /** Tracks and playlists just added to, shown with a brief highlight. */
  flash: string[];
}
export type NoticePart = { b?: string; t?: string };

let state: DropState = { pending: null, notice: null, flash: [] };
const listeners = new Set<() => void>();
function set(change: Partial<DropState>) {
  state = { ...state, ...change };
  listeners.forEach((l) => l());
}
export function resetDrops(): void {
  set({ pending: null, notice: null, flash: [] });
}
export function useDropState(): DropState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
export const plainText = (parts: NoticePart[]): string => parts.map((p) => p.b ?? p.t ?? "").join("");
const tracksWord = (n: number) => (n === 1 ? "1 track" : `${n} tracks`);

let flashTimer: ReturnType<typeof setTimeout> | null = null;
function flashSoon(ids: string[]) {
  set({ flash: ids });
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => set({ flash: [] }), 3200);
}

export interface DropActions {
  api: LyreApi;
  store: TrackStore;
  say: (text: string) => void;
  toast: (text: string) => void;
}

/** Imports paths; null (with a toast) when nothing came of it. */
async function importPaths({ api, store, toast }: DropActions, paths: string[]): Promise<string[] | null> {
  const result = await api.import.start({ from: "paths", paths });
  if (isRefused(result)) {
    toast(result.refusal.message);
    return null;
  }
  if (!result.value.trackIds.length) {
    toast(result.value.problems.length ? result.value.summary : "Nothing to add: there are no audio files in what you dropped");
    return null;
  }
  await store.reload();
  return result.value.trackIds;
}

/** Adds imported tracks to a manual playlist at `index` (or the end); the words for the notice line. */
async function addToPlaylist(actions: DropActions, pl: PlaylistInfo, ids: string[], index: number | null): Promise<NoticePart[] | null> {
  const before = pl.kind === "manual" ? pl.trackIds.length : 0;
  const result = await actions.api.playlists.addTracks(pl.id, ids, index ?? undefined);
  if (isRefused(result)) {
    actions.toast(result.refusal.message);
    return null;
  }
  const { added, alreadyIn } = result.value;
  flashSoon([...added, pl.id]);
  if (!added.length) return [{ t: `Those tracks are already in ${pl.name}.` }];
  const atText = index !== null && index >= 0 && index < before ? `, at position ${index + 1}` : "";
  const parts: NoticePart[] = [{ b: tracksWord(added.length) }, { t: ` added to ${pl.name} and your Library${atText}. Give them titles and tags in the Library.` }];
  if (alreadyIn.length) parts.push({ t: ` ${alreadyIn.length === 1 ? "1 was" : `${alreadyIn.length} were`} already in it.` });
  return parts;
}

function libraryOnly(ids: string[], pl: PlaylistInfo | null): NoticePart[] {
  flashSoon(ids);
  return [{ b: tracksWord(ids.length) }, { t: ` added to your Library.${pl ? ` They appear in ${pl.name} once their tags match its rules.` : ""} Give them titles and tags in the Library.` }];
}

/** Where on the screen files were dropped. */
export type DropTarget = { kind: "page"; playlist: PlaylistInfo; index: number | null } | { kind: "row"; playlist: PlaylistInfo } | { kind: "list" };

export async function dropFiles(actions: DropActions, target: DropTarget, paths: string[]): Promise<void> {
  if (!paths.length) {
    actions.toast("Nothing to add: there are no audio files in what you dropped");
    return;
  }
  set({ notice: null, pending: null });
  const pl = target.kind === "list" ? null : target.playlist;
  const where: DropWhere = target.kind === "page" ? `page:${target.playlist.id}` : "list";
  if (pl && pl.kind === "manual") {
    const ids = await importPaths(actions, paths);
    if (!ids) return;
    const parts = await addToPlaylist(actions, pl, ids, target.kind === "page" ? target.index : null);
    if (!parts) return;
    set({ notice: { where, parts, open: target.kind === "row" ? pl.id : null } });
    actions.say(plainText(parts));
    return;
  }
  set({ pending: { where, playlistId: pl?.id ?? null, paths, count: paths.length } });
  actions.say(`${paths.length === 1 ? "1 audio file" : `${paths.length} audio files`} dropped. Choose what to do with them.`);
  focusSoon(pl ? "pldropdo" : "pldropsel");
}

/** The notice line, or the question while a drop waits for an answer. */
export function DropNotice({ where, actions, playlists }: { where: DropWhere; actions: DropActions; playlists: PlaylistInfo[] }) {
  const { pending, notice } = useDropState();
  if (pending && pending.where === where) {
    const lead = (
      <b>
        {pending.count === 1 ? "1 audio file" : `${pending.count} audio files`}
      </b>
    );
    const pl = pending.playlistId ? playlists.find((p) => p.id === pending.playlistId) ?? null : null;
    const libraryOnlyNow = async () => {
      set({ pending: null });
      const ids = await importPaths(actions, pending.paths);
      if (!ids) return;
      const parts = libraryOnly(ids, pl);
      set({ notice: { where: pending.where, parts, open: null } });
      actions.say(plainText(parts));
      focusSoon("plshownew");
    };
    const cancel = () => {
      set({ pending: null });
      actions.say("Nothing added");
    };
    if (pl) {
      return (
        <div className="pl-notice pl-ask" role="group" aria-label="Dropped files">
          <Icon name="tag" size="s" />
          <span className="grow">
            {lead} dropped. &quot;{pl.name}&quot; is a Dynamic playlist: tracks appear in it only when their tags match its rules, and new files have no tags yet.
          </span>
          <button type="button" className="btn s primary" data-focus="pldropdo" onClick={() => void libraryOnlyNow()}>
            Add to the Library anyway
          </button>
          <button type="button" className="btn s" onClick={cancel}>
            Cancel
          </button>
        </div>
      );
    }
    const manual = playlists.filter((p) => p.kind === "manual");
    return <AskWhich lead={lead} manual={manual} actions={actions} onLibraryOnly={() => void libraryOnlyNow()} onCancel={cancel} />;
  }
  if (!notice || notice.where !== where) return null;
  const openName = notice.open ? playlists.find((p) => p.id === notice.open)?.name ?? "playlist" : "";
  return (
    <div className="pl-notice" role="status">
      <Icon name="check" size="s" />
      <span className="grow">
        {notice.parts.map((p, i) => (p.b ? <b key={i}>{p.b}</b> : <React.Fragment key={i}>{p.t}</React.Fragment>))}
      </span>
      {notice.open && (
        <a className="btn s" href={hashOf(`playlist/${notice.open}`)} data-focus="pldropopen">
          Open {openName}
        </a>
      )}
      <button
        type="button"
        className="btn s"
        data-focus="plshownew"
        onClick={() => {
          set({ notice: null });
          setLibraryState({ filter: { ...DEFAULT_FILTER, newOnly: true }, q: "", guide: null });
          window.location.hash = hashOf("library");
        }}
      >
        <Icon name="library" size="s" />
        Open new tracks in the Library
      </button>
      <button type="button" className="closer" title="Dismiss" aria-label="Dismiss this message" onClick={() => set({ notice: null })}>
        <Icon name="close" />
      </button>
    </div>
  );
}

function AskWhich({ lead, manual, actions, onLibraryOnly, onCancel }: { lead: React.ReactNode; manual: PlaylistInfo[]; actions: DropActions; onLibraryOnly: () => void; onCancel: () => void }) {
  const [chosen, setChosen] = React.useState(manual[0]?.id ?? "");
  const pending = state.pending;
  const toPlaylist = async () => {
    const pl = manual.find((p) => p.id === chosen);
    if (!pending || !pl) return;
    set({ pending: null });
    const ids = await importPaths(actions, pending.paths);
    if (!ids) return;
    const parts = await addToPlaylist(actions, pl, ids, null);
    if (!parts) return;
    set({ notice: { where: "list", parts, open: pl.id } });
    actions.say(plainText(parts));
    focusSoon("pldropopen");
  };
  const toNew = async () => {
    if (!pending) return;
    set({ pending: null });
    const ids = await importPaths(actions, pending.paths);
    if (!ids) return;
    const count = { music: 0, amb: 0, fx: 0 };
    for (const id of ids) {
      const t = actions.store.get().byId.get(id);
      if (t) count[t.kind]++;
    }
    const lane = count.amb > count.music && count.amb >= count.fx ? "amb" : count.fx > count.music ? "fx" : "music";
    const made = await actions.api.playlists.create({ name: "New playlist from dropped files", kind: "manual", lane, trackIds: ids });
    if (isRefused(made)) {
      actions.toast(made.refusal.message);
      return;
    }
    flashSoon([...ids, made.value.id]);
    const parts: NoticePart[] = [{ b: tracksWord(ids.length) }, { t: ` added to ${made.value.name} and your Library. Give them titles and tags in the Library.` }];
    set({ notice: { where: `page:${made.value.id}`, parts, open: null } });
    window.location.hash = hashOf(`playlist/${made.value.id}`);
    actions.say(`${plainText(parts)} Give the playlist a name.`);
    focusSoon("plname", true);
  };
  return (
    <div className="pl-notice pl-ask" role="group" aria-label="Dropped files">
      <Icon name="folder" size="s" />
      <span className="pl-asktext">{lead} dropped. Add them to</span>
      <select className="input pl-asksel" data-focus="pldropsel" aria-label="Playlist to add the dropped files to" value={chosen} onChange={(e) => setChosen(e.target.value)}>
        {(["music", "amb", "fx"] as const).map((lane) => {
          const ps = manual.filter((p) => p.lane === lane);
          return ps.length ? (
            <optgroup key={lane} label={KIND_NAMES[lane]}>
              {ps.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ) : null;
        })}
      </select>
      <button type="button" className="btn s primary" onClick={() => void toPlaylist()}>
        Add
      </button>
      <span className="faint">or</span>
      <button type="button" className="btn s" onClick={() => void toNew()}>
        <Icon name="plus" size="s" />
        New playlist from dropped files
      </button>
      <button type="button" className="btn s ghost" onClick={onLibraryOnly}>
        Library only
      </button>
      <button type="button" className="btn s ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/**
 * Listens for files dragged over the screen (#view): shows the drop zone and its message, marks where they would go,
 * and hands the drop to `onDrop` with the paths. `targetOf` says where a point is.
 */
export function useFileDrops(targetOf: (el: Element | null, clientY: number) => DropTarget | null, message: (t: DropTarget) => string, onDrop: (t: DropTarget, paths: string[]) => void): void {
  // The listeners stay for the screen's life and call the latest functions.
  const latest = useRef({ targetOf, message, onDrop });
  latest.current = { targetOf, message, onDrop };
  useEffect(() => {
    const targetOf = (el: Element | null, y: number) => latest.current.targetOf(el, y);
    const message = (t: DropTarget) => latest.current.message(t);
    const onDrop = (t: DropTarget, paths: string[]) => latest.current.onDrop(t, paths);
    const view = document.getElementById("view");
    if (!view) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearMarks = () => view.querySelectorAll(".pl-drop-before, .pl-drop-after, .pl-droptarget").forEach((x) => x.classList.remove("pl-drop-before", "pl-drop-after", "pl-droptarget"));
    const ui = (on: boolean) => {
      view.classList.toggle("pl-filedrag", on);
      if (!on) clearMarks();
    };
    const mark = (e: DragEvent, t: DropTarget) => {
      clearMarks();
      const el = e.target instanceof Element ? e.target : null;
      if (t.kind === "row") el?.closest(".pl-item")?.classList.add("pl-droptarget");
      if (t.kind === "page" && t.index !== null) {
        const row = el?.closest<HTMLElement>(".pl-tr[draggable]");
        if (row) {
          const r = row.getBoundingClientRect();
          row.classList.add(e.clientY > r.top + r.height / 2 ? "pl-drop-after" : "pl-drop-before");
        }
      }
      const msg = view.querySelector(".pl-dropmsg span");
      const text = message(t);
      if (msg && msg.textContent !== text) msg.textContent = text;
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      ui(true);
      // dragover repeats while the files are over the page; when it stops, the drop zone goes.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => ui(false), 400);
      const t = targetOf(e.target instanceof Element ? e.target : null, e.clientY);
      if (t) mark(e, t);
    };
    const leave = (e: DragEvent) => {
      if (hasFiles(e) && !e.relatedTarget) ui(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (timer) clearTimeout(timer);
      const t = targetOf(e.target instanceof Element ? e.target : null, e.clientY);
      ui(false);
      if (t) onDrop(t, droppedPaths(e.dataTransfer));
    };
    view.addEventListener("dragenter", over);
    view.addEventListener("dragover", over);
    view.addEventListener("dragleave", leave);
    view.addEventListener("drop", drop);
    return () => {
      if (timer) clearTimeout(timer);
      ui(false);
      view.removeEventListener("dragenter", over);
      view.removeEventListener("dragover", over);
      view.removeEventListener("dragleave", leave);
      view.removeEventListener("drop", drop);
    };
  }, []);
}

/** The dashed frame and message shown while files are dragged over the screen. */
export function DropZone() {
  return (
    <div className="pl-dropzone" aria-hidden="true">
      <div className="pl-dropmsg">
        <Icon name="folder" size="s" />
        <span />
      </div>
    </div>
  );
}
