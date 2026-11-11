/**
 * Design round 7 (schema v6, design/prototype/ROUND7.md): a pad board's dividers (ORG-4), a scene's or pad's own steps
 * and a scene that moves on by itself (PLY-8), how a track plays (PLY-4 Ending and Pick up, SHW-3 Follow with), tags
 * inside tags for the shared rules (DAT-10), the keyboard shortcuts and play settings (UX-12, PLY-8). Handed out in the
 * shapes of src/common/domain/round7.ts. Each write is one undo step and a write that changes nothing makes none.
 */
import {
  checkCrossfade,
  checkSteps,
  CUE_STEP_KINDS,
  inScreenOrder,
  normaliseKey,
  SHORTCUT_ACTIONS,
  SHORTCUT_IDS,
  shortcutUsing,
  STEP_HOWS,
  STEP_STOPS,
  STEP_UP_NEXTS,
  type Crossfade,
  type CueStep,
  type MovesOn,
  type ShortcutAction,
  type ShortcutMap,
  type SoundRef,
  type StepHow,
  type StepStop,
  type StepUpNext,
  type TagTree,
} from "../../../common/domain";
import { NotFoundError, ValidationError } from "../errors";
import type { Store } from "../store";
import * as v from "../validate";
import { newId, requireRow, toFlag } from "./common";

/* ---------- ORG-4 board dividers ---------- */

/** A board's dividers by row (board_dividers' key). Exported for the query-plan tests. */
export const BOARD_DIVIDERS_SQL = "SELECT grid_row, label FROM board_dividers WHERE board_id = ? ORDER BY grid_row";

export function boardDividers(store: Store, boardId: string): { row: number; name: string }[] {
  return store.all<{ grid_row: number; label: string }>(BOARD_DIVIDERS_SQL, v.id("boardId", boardId)).map((r) => ({ row: r.grid_row, name: r.label }));
}

/** Names the row of pads (0 is the top row); null takes the divider away. */
export function setBoardDivider(store: Store, boardId: string, row: number, name: string | null): void {
  const board = requireRow(store, "boards", "pad board", boardId);
  const at = v.integer("row", row, 0, 7);
  const label = name === null ? null : v.requiredName("name", name);
  const had = store.get<{ label: string }>("SELECT label FROM board_dividers WHERE board_id = ? AND grid_row = ?", board, at);
  if ((had?.label ?? null) === label) return;
  store.change(label === null ? "Remove a divider" : had ? `Rename the divider "${label}"` : `Add the divider "${label}"`, () => {
    if (label === null) store.run("DELETE FROM board_dividers WHERE board_id = ? AND grid_row = ?", board, at);
    else store.run("INSERT INTO board_dividers (board_id, grid_row, label) VALUES (?, ?, ?) ON CONFLICT (board_id, grid_row) DO UPDATE SET label = excluded.label", board, at, label);
  });
}

/** Every board's dividers, by board id (a small table, read whole). */
export function allBoardDividers(store: Store): Record<string, { row: number; name: string }[]> {
  const out: Record<string, { row: number; name: string }[]> = {};
  for (const r of store.all<{ board_id: string; grid_row: number; label: string }>("SELECT board_id, grid_row, label FROM board_dividers ORDER BY board_id, grid_row")) {
    (out[r.board_id] ??= []).push({ row: r.grid_row, name: r.label });
  }
  return out;
}

/* ---------- PLY-8 steps ---------- */

/** Whose steps: a scene's start or a pad. */
export type StepOwner = { sceneId: string } | { padId: string };

type StepRow = {
  list_id: string;
  action: CueStep["do"];
  track_id: string | null;
  playlist_id: string | null;
  board_id: string | null;
  target_pad_id: string | null;
  pad_board_id: string | null;
  target_scene_id: string | null;
  scene_session_id: string | null;
  scene_campaign_id: string | null;
  stop_what: StepStop | null;
  comes_in: string | null;
  up_next: string | null;
  from_ms: number | null;
  level: number | null;
  duration_ms: number | null;
};

/** One list's steps in order (cue_steps_order), with what the domain shape names alongside. Exported for the query-plan tests. */
export const CUE_STEPS_SQL = `SELECT c.*, p.board_id AS pad_board_id, s.session_id AS scene_session_id, ss.campaign_id AS scene_campaign_id
  FROM cue_steps c LEFT JOIN pads p ON p.id = c.target_pad_id
  LEFT JOIN scenes s ON s.id = c.target_scene_id LEFT JOIN sessions ss ON ss.id = s.session_id
  WHERE c.list_id = ? ORDER BY c.position`;
/** An owner's list (the UNIQUE keys of cue_lists). */
export const CUE_LIST_SQL = { scene: "SELECT id FROM cue_lists WHERE scene_id = ?", pad: "SELECT id FROM cue_lists WHERE pad_id = ?" } as const;

function toStep(r: StepRow): CueStep {
  const what = (): SoundRef => (r.track_id ? { kind: "track", id: r.track_id } : { kind: "playlist", id: r.playlist_id as string });
  const play = () => ({ what: what(), how: r.comes_in as StepHow, upNext: r.up_next as StepUpNext, fromMs: r.from_ms });
  switch (r.action) {
    case "music":
      return { do: "music", ...play() };
    case "play":
      return { do: "play", ...play() };
    case "ambience":
      return { do: "ambience", what: what() };
    case "board":
      return { do: "board", boardId: r.board_id as string };
    case "sound":
      return { do: "sound" };
    case "stop":
      return { do: "stop", what: r.stop_what as StepStop };
    case "fade":
      return { do: "fade", level: r.level as number, ms: r.duration_ms as number };
    case "wait":
      return { do: "wait", ms: r.duration_ms as number };
    case "pad":
      return { do: "pad", boardId: r.pad_board_id as string, padId: r.target_pad_id as string };
    case "scene":
      return { do: "scene", scene: { campaignId: r.scene_campaign_id as string, sessionId: r.scene_session_id as string, sceneId: r.target_scene_id as string } };
  }
}

function ownerOf(store: Store, owner: StepOwner): { column: "scene_id" | "pad_id"; id: string; kind: "scene" | "pad"; name: string } {
  const o = v.record("owner", owner);
  if ("sceneId" in o) {
    const id = requireRow(store, "scenes", "scene", o.sceneId);
    const { name } = store.get<{ name: string }>("SELECT name FROM scenes WHERE id = ?", id) as { name: string };
    return { column: "scene_id", id, kind: "scene", name: name || "the scene" };
  }
  const id = requireRow(store, "pads", "pad", o.padId);
  const { label } = store.get<{ label: string }>("SELECT label FROM pads WHERE id = ?", id) as { label: string };
  return { column: "pad_id", id, kind: "pad", name: label || "the pad" };
}

/** The owner's own steps in order, or null: it does the usual (usualSceneSteps, usualPadSteps). */
export function getSteps(store: Store, owner: StepOwner): CueStep[] | null {
  const o = ownerOf(store, owner);
  const list = store.get<{ id: string }>(CUE_LIST_SQL[o.kind], o.id);
  return list ? store.all<StepRow>(CUE_STEPS_SQL, list.id).map(toStep) : null;
}

/** Every scene's and pad's own steps, by scene id and pad id (small tables, read whole). */
export function getAllSteps(store: Store): { scenes: Record<string, CueStep[]>; pads: Record<string, CueStep[]> } {
  const out = { scenes: {} as Record<string, CueStep[]>, pads: {} as Record<string, CueStep[]> };
  const lists = store.all<{ id: string; scene_id: string | null; pad_id: string | null }>("SELECT id, scene_id, pad_id FROM cue_lists");
  const byList = new Map<string, CueStep[]>();
  for (const l of lists) {
    const steps: CueStep[] = [];
    byList.set(l.id, steps);
    if (l.scene_id) out.scenes[l.scene_id] = steps;
    else if (l.pad_id) out.pads[l.pad_id] = steps;
  }
  const rows = store.all<StepRow>(`${CUE_STEPS_SQL.replace("WHERE c.list_id = ? ORDER BY c.position", "ORDER BY c.list_id, c.position")}`);
  for (const r of rows) byList.get(r.list_id)?.push(toStep(r));
  return out;
}

/** The columns a step is stored with, checked; refers only to rows that are there. */
function stepColumns(store: Store, step: unknown, index: number): Record<string, string | number | null> {
  const field = `steps[${index}]`;
  const s = v.record(field, step);
  const kind = v.oneOf(`${field}.do`, s.do, CUE_STEP_KINDS);
  const cols: Record<string, string | number | null> = { action: kind };
  const what = () => {
    const ref = v.record(`${field}.what`, s.what);
    const id = v.id(`${field}.what.id`, ref.id);
    if (ref.kind === "track") cols.track_id = requireRow(store, "tracks", "track", id);
    else if (ref.kind === "playlist") cols.playlist_id = requireRow(store, "playlists", "playlist", id);
    else throw new ValidationError(`${field}.what`, "A step plays a track or a playlist.");
  };
  switch (kind) {
    case "music":
    case "play":
      what();
      cols.comes_in = v.oneOf(`${field}.how`, s.how, STEP_HOWS);
      cols.up_next = v.oneOf(`${field}.upNext`, s.upNext, STEP_UP_NEXTS);
      cols.from_ms = s.fromMs === null || s.fromMs === undefined ? null : v.milliseconds(`${field}.fromMs`, s.fromMs);
      break;
    case "ambience":
      what();
      break;
    case "board":
      cols.board_id = requireRow(store, "boards", "pad board", s.boardId);
      break;
    case "stop":
      cols.stop_what = v.oneOf(`${field}.what`, s.what, STEP_STOPS);
      break;
    case "fade":
      cols.level = v.numberInRange(`${field}.level`, s.level, 0, 1);
      cols.duration_ms = v.integer(`${field}.ms`, s.ms, 0, 60_000);
      break;
    case "wait":
      cols.duration_ms = v.integer(`${field}.ms`, s.ms, 0, 600_000);
      break;
    case "pad": {
      const padId = requireRow(store, "pads", "pad", s.padId);
      const board = store.get<{ board_id: string }>("SELECT board_id FROM pads WHERE id = ?", padId) as { board_id: string };
      if (board.board_id !== v.id(`${field}.boardId`, s.boardId)) throw new ValidationError(`${field}.boardId`, "That pad is on another board.");
      cols.target_pad_id = padId;
      break;
    }
    case "scene": {
      const sc = v.record(`${field}.scene`, s.scene);
      cols.target_scene_id = requireRow(store, "scenes", "scene", sc.sceneId);
      break;
    }
    case "sound":
      break;
  }
  return cols;
}

/**
 * The owner's own steps (null: back to the usual; a scene's moving on is setMovesOn). Steps equal to the usual ones
 * are the caller's to drop first (stepsToKeep), as only the caller knows the usual; the same steps again make no undo step.
 */
export function setSteps(store: Store, owner: StepOwner, steps: CueStep[] | null): void {
  const o = ownerOf(store, owner);
  if (steps !== null && !Array.isArray(steps)) throw new ValidationError("steps", "Steps are a list.");
  const rows = steps === null ? null : steps.map((step, index) => stepColumns(store, step, index));
  if (steps !== null) {
    const problem = checkSteps(steps, o.kind);
    if (problem) throw new ValidationError("steps", problem);
  }
  // What the steps read back as once saved, so saving the same steps again makes no undo step.
  const saved = rows === null ? null : rows.map((cols) => toStep(rowFor(store, cols)));
  if (JSON.stringify(getSteps(store, owner)) === JSON.stringify(saved)) return;
  const label = o.kind === "scene" ? `What ${o.name} does when it starts` : `What ${o.name} does`;
  store.change(label, () => {
    store.run(`DELETE FROM cue_lists WHERE ${o.column} = ?`, o.id);
    if (rows === null) return;
    const listId = newId();
    store.run(`INSERT INTO cue_lists (id, ${o.column}) VALUES (?, ?)`, listId, o.id);
    rows.forEach((cols, index) => {
      const names = Object.keys(cols);
      store.run(
        `INSERT INTO cue_steps (id, list_id, position, ${names.join(", ")}) VALUES (?, ?, ?, ${names.map(() => "?").join(", ")})`,
        newId(),
        listId,
        (index + 1) * 1024,
        ...names.map((n) => cols[n]),
      );
    });
  });
}

/** A checked step's columns as the row it would read back as (so an unchanged save is noticed). */
function rowFor(store: Store, c: Record<string, string | number | null>): StepRow {
  const pad = c.target_pad_id ? store.get<{ board_id: string }>("SELECT board_id FROM pads WHERE id = ?", c.target_pad_id) : undefined;
  const scene = c.target_scene_id
    ? store.get<{ session_id: string; campaign_id: string }>("SELECT s.session_id, ss.campaign_id FROM scenes s JOIN sessions ss ON ss.id = s.session_id WHERE s.id = ?", c.target_scene_id)
    : undefined;
  return {
    list_id: "",
    action: c.action as CueStep["do"],
    track_id: (c.track_id as string) ?? null,
    playlist_id: (c.playlist_id as string) ?? null,
    board_id: (c.board_id as string) ?? null,
    target_pad_id: (c.target_pad_id as string) ?? null,
    pad_board_id: pad?.board_id ?? null,
    target_scene_id: (c.target_scene_id as string) ?? null,
    scene_session_id: scene?.session_id ?? null,
    scene_campaign_id: scene?.campaign_id ?? null,
    stop_what: (c.stop_what as StepStop) ?? null,
    comes_in: (c.comes_in as string) ?? null,
    up_next: (c.up_next as string) ?? null,
    from_ms: (c.from_ms as number) ?? null,
    level: (c.level as number) ?? null,
    duration_ms: (c.duration_ms as number) ?? null,
  };
}

/* ---------- PLY-8 a scene that moves on by itself ---------- */

export function getMovesOn(store: Store, sceneId: string): MovesOn {
  const row = store.get<{ moves_on: "musicEnds" | "after"; after_ms: number | null }>("SELECT moves_on, after_ms FROM scene_moves_on WHERE scene_id = ?", v.id("sceneId", sceneId));
  return toMovesOn(row);
}

function toMovesOn(row: { moves_on: "musicEnds" | "after"; after_ms: number | null } | undefined): MovesOn {
  if (!row) return { when: "stay" };
  return row.moves_on === "after" ? { when: "after", ms: row.after_ms as number } : { when: "musicEnds" };
}

/** Every scene that moves on by itself, by scene id. */
export function getAllMovesOn(store: Store): Record<string, MovesOn> {
  const out: Record<string, MovesOn> = {};
  for (const r of store.all<{ scene_id: string; moves_on: "musicEnds" | "after"; after_ms: number | null }>("SELECT scene_id, moves_on, after_ms FROM scene_moves_on")) {
    out[r.scene_id] = toMovesOn(r);
  }
  return out;
}

export function setMovesOn(store: Store, sceneId: string, movesOn: MovesOn): void {
  const scene = requireRow(store, "scenes", "scene", sceneId);
  const m = v.record("movesOn", movesOn);
  const when = v.oneOf("movesOn.when", m.when, ["stay", "musicEnds", "after"] as const);
  const ms = when === "after" ? v.integer("movesOn.ms", m.ms, 1000, 21_600_000) : null;
  const next: MovesOn = when === "after" ? { when, ms: ms as number } : { when };
  if (JSON.stringify(getMovesOn(store, scene)) === JSON.stringify(next)) return;
  store.change(when === "stay" ? "Stay on the scene until Next" : "Move on by itself", () => {
    store.run("DELETE FROM scene_moves_on WHERE scene_id = ?", scene);
    if (when !== "stay") store.run("INSERT INTO scene_moves_on (scene_id, moves_on, after_ms) VALUES (?, ?, ?)", scene, when, ms);
  });
}

/* ---------- PLY-4, SHW-3 how a track plays ---------- */

export interface TrackPlay {
  /** Ending "Fades out" (tracks.ending = 'fades'). */
  fadesOut: boolean;
  /** Pick up where it stopped. */
  resume: boolean;
  follow: SoundRef | null;
}

/** Every track's Follow with, by track id (a small table, read whole). Exported SQL for the query-plan tests. */
export const FOLLOWS_SQL = "SELECT track_id, follow_track_id, follow_playlist_id FROM track_follows";

export function getFollows(store: Store): Record<string, SoundRef> {
  const out: Record<string, SoundRef> = {};
  for (const r of store.all<{ track_id: string; follow_track_id: string | null; follow_playlist_id: string | null }>(FOLLOWS_SQL)) {
    out[r.track_id] = r.follow_track_id ? { kind: "track", id: r.follow_track_id } : { kind: "playlist", id: r.follow_playlist_id as string };
  }
  return out;
}

export function trackPlay(store: Store, trackId: string): TrackPlay {
  const id = requireRow(store, "tracks", "track", trackId);
  const row = store.get<{ ending: string | null; resume: number }>("SELECT ending, resume FROM tracks WHERE id = ?", id) as { ending: string | null; resume: number };
  const f = store.get<{ follow_track_id: string | null; follow_playlist_id: string | null }>("SELECT follow_track_id, follow_playlist_id FROM track_follows WHERE track_id = ?", id);
  const follow: SoundRef | null = !f ? null : f.follow_track_id ? { kind: "track", id: f.follow_track_id } : { kind: "playlist", id: f.follow_playlist_id as string };
  return { fadesOut: row.ending === "fades", resume: row.resume === 1, follow };
}

/** Changes how a track plays (only the fields given) in one undo step; nothing new makes none. */
export function setTrackPlay(store: Store, trackId: string, patch: Partial<TrackPlay>): TrackPlay {
  const id = requireRow(store, "tracks", "track", trackId);
  const p = v.record("patch", patch);
  for (const key of Object.keys(p)) if (!["fadesOut", "resume", "follow"].includes(key)) throw new ValidationError(key, `${key} cannot be changed here.`);
  const fadesOut = p.fadesOut === undefined ? undefined : v.boolean("fadesOut", p.fadesOut);
  const resume = p.resume === undefined ? undefined : v.boolean("resume", p.resume);
  let follow: SoundRef | null | undefined;
  if (p.follow === null) follow = null;
  else if (p.follow !== undefined) {
    const ref = v.record("follow", p.follow);
    if (ref.kind === "track") {
      const other = requireRow(store, "tracks", "track", ref.id);
      if (other === id) throw new ValidationError("follow", "A track cannot follow with itself.");
      follow = { kind: "track", id: other };
    } else if (ref.kind === "playlist") follow = { kind: "playlist", id: requireRow(store, "playlists", "playlist", ref.id) };
    else throw new ValidationError("follow", "Follow with a track or a playlist.");
  }
  const before = trackPlay(store, id);
  const after: TrackPlay = { fadesOut: fadesOut ?? before.fadesOut, resume: resume ?? before.resume, follow: follow === undefined ? before.follow : follow };
  if (JSON.stringify(before) === JSON.stringify(after)) return before;
  store.change("How it plays", () => {
    if (after.fadesOut !== before.fadesOut) {
      // Not fading out: it plays to its end (no ending of its own); a "resolves" ending is DAT-2's and stays.
      store.run("UPDATE tracks SET ending = CASE WHEN ? = 1 THEN 'fades' WHEN ending = 'fades' THEN NULL ELSE ending END, updated_at = ? WHERE id = ?", toFlag(after.fadesOut), store.now(), id);
    }
    if (after.resume !== before.resume) store.run("UPDATE tracks SET resume = ?, updated_at = ? WHERE id = ?", toFlag(after.resume), store.now(), id);
    if (JSON.stringify(after.follow) !== JSON.stringify(before.follow)) {
      store.run("DELETE FROM track_follows WHERE track_id = ?", id);
      if (after.follow) {
        store.run(
          "INSERT INTO track_follows (track_id, follow_track_id, follow_playlist_id) VALUES (?, ?, ?)",
          id,
          after.follow.kind === "track" ? after.follow.id : null,
          after.follow.kind === "playlist" ? after.follow.id : null,
        );
      }
    }
  });
  return after;
}

/** Every track's Pick up and Ending, by id, for the tracks that have one (domain.ts adds them to DomainTrack). */
export function allTrackPlay(store: Store): Map<string, { fadesOut: boolean; resume: boolean }> {
  const out = new Map<string, { fadesOut: boolean; resume: boolean }>();
  for (const r of store.all<{ id: string; ending: string | null; resume: number }>("SELECT id, ending, resume FROM tracks WHERE ending = 'fades' OR resume = 1")) {
    out.set(r.id, { fadesOut: r.ending === "fades", resume: r.resume === 1 });
  }
  return out;
}

/* ---------- DAT-10 tags inside tags ---------- */

/** The tags with every tag inside them, through tags_parent. Exported for the query-plan tests. */
export const TAGS_WITH_INSIDE_SQL = `WITH RECURSIVE inside(id) AS (SELECT value FROM json_each(?) UNION SELECT t.id FROM inside i CROSS JOIN tags t ON t.parent_id = i.id)
  SELECT id FROM inside`;

export function tagsWithInside(store: Store, tagIds: readonly string[]): string[] {
  if (tagIds.length === 0) return [];
  return store.all<{ id: string }>(TAGS_WITH_INSIDE_SQL, JSON.stringify(tagIds)).map((r) => r.id);
}

/** The TagTree of the shared rules: per group id, each tag inside another, with that tag's name. */
export function getTagTree(store: Store): TagTree {
  const out: TagTree = {};
  for (const r of store.all<{ group_id: string; name: string; parent: string }>(
    "SELECT t.group_id, t.name, p.name AS parent FROM tags t JOIN tags p ON p.id = t.parent_id ORDER BY t.group_id, t.position",
  )) {
    (out[r.group_id] ??= {})[r.name] = r.parent;
  }
  return out;
}

/** A tag as listTagsInScreenOrder lists it (a reader: the undo test knows it by its name). */
export type VocabularyTag = { id: string; group_id: string; name: string; parent_id: string | null };

/**
 * DAT-10: every tag in vocabulary order, the Tags screen's: group by group, each tag followed depth first by the tags
 * inside it, in saved position. A track lists its tags in this order (tagsOfTrack, the domain lookup).
 */
export function listTagsInScreenOrder(store: Store): VocabularyTag[] {
  const saved = store.all<VocabularyTag>(
    "SELECT t.id, t.group_id, t.name, t.parent_id FROM tags t JOIN tag_groups g ON g.id = t.group_id ORDER BY g.position, g.rowid, t.position, t.rowid",
  );
  return inScreenOrder(saved, (tag) => tag.id, (tag) => tag.parent_id);
}

/* ---------- UX-12, PLY-8 the library's play settings ---------- */

export function getShortcuts(store: Store): ShortcutMap {
  const out: ShortcutMap = {};
  for (const r of store.all<{ action: ShortcutAction; key: string }>("SELECT action, key FROM shortcut_keys")) out[r.action] = r.key;
  return out;
}

const actionName = (id: ShortcutAction) => SHORTCUT_ACTIONS.find((a) => a.id === id)?.name ?? id;

/** Gives an action a key (null: Lyre's own). A key another action has is refused, naming that action. */
export function setShortcut(store: Store, action: ShortcutAction, key: string | null): void {
  const id = v.oneOf("action", action, SHORTCUT_IDS);
  const own = SHORTCUT_ACTIONS.find((a) => a.id === id)?.key as string;
  const named = key === null ? own : normaliseKey(key);
  if (!named) throw new ValidationError("key", "Lyre cannot listen to that key. Press a letter, a number, F1 to F12 or a named key, with Ctrl, Alt or Shift if you like.");
  const map = getShortcuts(store);
  const taken = shortcutUsing(map, named, id);
  if (taken) throw new ValidationError("key", `${named} is already ${actionName(taken)}. Give that one another key first.`);
  const want = named === own ? null : named;
  if ((map[id] ?? null) === want) return;
  store.change(`The key for ${actionName(id)}`, () => {
    store.run("DELETE FROM shortcut_keys WHERE action = ?", id);
    if (want !== null) store.run("INSERT INTO shortcut_keys (action, key) VALUES (?, ?)", id, want);
  });
}

/** Put back Lyre's keys. */
export function resetShortcuts(store: Store): void {
  if (Object.keys(getShortcuts(store)).length === 0) return;
  store.change("Put back Lyre's keys", () => store.run("DELETE FROM shortcut_keys"));
}

export interface PlaySettings {
  crossfade: Crossfade;
  nextSceneGuard: boolean;
}

export function getPlaySettings(store: Store): PlaySettings {
  const r = store.get<{ crossfade_ms: number; crossfade_curve: "even" | "power"; next_scene_guard: number }>(
    "SELECT crossfade_ms, crossfade_curve, next_scene_guard FROM library_settings WHERE id = 1",
  );
  if (!r) throw new NotFoundError("library settings", "1");
  return { crossfade: { ms: r.crossfade_ms, curve: r.crossfade_curve }, nextSceneGuard: r.next_scene_guard === 1 };
}

export function setCrossfade(store: Store, crossfade: Crossfade): void {
  const c = v.record("crossfade", crossfade);
  const value: Crossfade = { ms: v.integer("crossfade.ms", c.ms, 0, 20_000), curve: v.oneOf("crossfade.curve", c.curve, ["even", "power"] as const) };
  const problem = checkCrossfade(value);
  if (problem) throw new ValidationError("crossfade", problem);
  const now = getPlaySettings(store).crossfade;
  if (now.ms === value.ms && now.curve === value.curve) return;
  store.change(value.ms === 0 ? "Cut between tracks" : `Crossfade between tracks ${value.ms / 1000} s`, () =>
    store.run("UPDATE library_settings SET crossfade_ms = ?, crossfade_curve = ? WHERE id = 1", value.ms, value.curve),
  );
}

export function setNextSceneGuard(store: Store, on: boolean): void {
  const want = v.boolean("on", on);
  if (getPlaySettings(store).nextSceneGuard === want) return;
  store.change(want ? "Ignore a second Next scene" : "Count every Next scene", () => store.run("UPDATE library_settings SET next_scene_guard = ? WHERE id = 1", toFlag(want)));
}
