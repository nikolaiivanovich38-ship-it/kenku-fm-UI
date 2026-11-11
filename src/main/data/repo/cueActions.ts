/**
 * Cue actions stored on a hotkey (PLY-8; DB review 9): what a key press runs,
 * as the same CueAction shapes the buttons build (src/engine/queue/actions.ts).
 * Each action is a cue_actions row whose track, playlist, scene or pad is a
 * foreign key, so deleting one of those deletes the actions that play it and
 * nothing is left pointing at a row that has gone. Undoable like every edit.
 */
import { isCueAction, type CueAction } from "../../../engine/queue/actions";
import { NotFoundError, ValidationError } from "../errors";
import { GAP } from "../ordering";
import type { SQLInputValue } from "../sqlite";
import type { Store } from "../store";
import { newId, placeholders, requireRow } from "./common";

/** Actions per hotkey; a key press runs them in order. */
const MAX_ACTIONS = 50;

type ActionRow = {
  type: CueAction["type"];
  track_id: string | null;
  playlist_id: string | null;
  scene_id: string | null;
  pad_id: string | null;
  from_playlist_id: string | null;
  from_scene_id: string | null;
  from_step: number | null;
  lane: string | null;
  room: string | null;
  play_when: "now" | "next" | null;
  phase: "down" | "up" | null;
  fade_ms: number | null;
  /** Read only: the scene's session and campaign, the pad's board. */
  session_id?: string | null;
  campaign_id?: string | null;
  from_session_id?: string | null;
  from_campaign_id?: string | null;
  board_id?: string | null;
};

const COLUMNS = [
  "type", "track_id", "playlist_id", "scene_id", "pad_id", "from_playlist_id", "from_scene_id", "from_step",
  "lane", "room", "play_when", "phase", "fade_ms",
] as const;

const roomOf = (target: "all" | { room: string } | undefined) => (target === undefined ? null : target === "all" ? "all" : target.room);
const targetOf = (room: string | null) => (room === null ? undefined : room === "all" ? ("all" as const) : { room });

/** Checks that a scene is where the action says (campaign, session). */
function requireScene(store: Store, ref: { campaignId: string; sessionId: string; sceneId: string }, field: string): string {
  const found = store.get<{ id: string }>(
    "SELECT sc.id FROM scenes sc JOIN sessions s ON s.id = sc.session_id WHERE sc.id = ? AND s.id = ? AND s.campaign_id = ?",
    ref.sceneId,
    ref.sessionId,
    ref.campaignId,
  );
  if (!found) throw new ValidationError(field, "That scene is not in that session and campaign.");
  return found.id;
}

/** The row for one checked action. */
function toRow(store: Store, action: CueAction, index: number): Record<(typeof COLUMNS)[number], SQLInputValue> {
  const field = `actions[${index}]`;
  const row: Record<(typeof COLUMNS)[number], SQLInputValue> = {
    type: action.type, track_id: null, playlist_id: null, scene_id: null, pad_id: null, from_playlist_id: null,
    from_scene_id: null, from_step: null, lane: null, room: null, play_when: null, phase: null, fade_ms: null,
  };
  switch (action.type) {
    case "playTrack":
      row.track_id = requireRow(store, "tracks", "track", action.trackId);
      row.room = roomOf(action.target);
      row.play_when = action.when ?? null;
      row.fade_ms = action.fadeMs ?? null;
      if (action.from !== undefined) {
        const from = action.from;
        if ("playlistId" in from) row.from_playlist_id = requireRow(store, "playlists", "playlist", from.playlistId);
        else {
          row.from_scene_id = requireScene(store, from.scene, `${field}.from`);
          row.from_step = from.at;
        }
      }
      break;
    case "playPlaylist":
      row.playlist_id = requireRow(store, "playlists", "playlist", action.playlistId);
      row.room = roomOf(action.target);
      row.play_when = action.when ?? null;
      row.fade_ms = action.fadeMs ?? null;
      break;
    case "startScene":
      row.scene_id = requireScene(store, action.scene, `${field}.scene`);
      break;
    case "next":
    case "previous":
    case "fadeLane":
      row.lane = action.lane;
      row.room = roomOf(action.target);
      row.fade_ms = action.fadeMs ?? null;
      break;
    case "fadeAll":
      row.room = roomOf(action.target);
      row.fade_ms = action.fadeMs ?? null;
      break;
    case "stopAll":
      row.room = roomOf(action.target);
      break;
    case "firePad": {
      const pad = store.get<{ id: string }>("SELECT id FROM pads WHERE id = ? AND board_id = ?", action.padId, action.boardId);
      if (!pad) throw new NotFoundError("pad on that board", action.padId);
      row.pad_id = pad.id;
      row.room = roomOf(action.target);
      row.phase = action.phase ?? null;
      break;
    }
    case "undoSceneStart":
      break;
    default:
      throw new ValidationError(field, "This action cannot be put on a key.");
  }
  return row;
}

/** One stored action as a CueAction (only the fields it has). */
function fromRow(row: ActionRow): CueAction {
  const target = targetOf(row.room);
  const fade = row.fade_ms === null ? {} : { fadeMs: row.fade_ms };
  switch (row.type) {
    case "playTrack": {
      const from =
        row.from_playlist_id !== null
          ? { from: { playlistId: row.from_playlist_id } }
          : row.from_scene_id !== null && row.from_step !== null
            ? { from: { scene: { campaignId: row.from_campaign_id as string, sessionId: row.from_session_id as string, sceneId: row.from_scene_id }, at: row.from_step } }
            : {};
      return { type: "playTrack", trackId: row.track_id as string, target: target ?? "all", ...(row.play_when ? { when: row.play_when } : {}), ...fade, ...from };
    }
    case "playPlaylist":
      return { type: "playPlaylist", playlistId: row.playlist_id as string, target: target ?? "all", ...(row.play_when ? { when: row.play_when } : {}), ...fade };
    case "startScene":
      return { type: "startScene", scene: { campaignId: row.campaign_id as string, sessionId: row.session_id as string, sceneId: row.scene_id as string } };
    case "next":
    case "previous":
      return { type: row.type, lane: row.lane as "music" | "ambience", target: target ?? "all", ...fade };
    case "fadeLane":
      return { type: "fadeLane", lane: row.lane as "music" | "ambience" | "effects", target: target ?? "all", ...fade };
    case "fadeAll":
      return { type: "fadeAll", ...(target ? { target } : {}), ...fade };
    case "stopAll":
      return { type: "stopAll", ...(target ? { target } : {}) };
    case "firePad":
      return { type: "firePad", boardId: row.board_id as string, padId: row.pad_id as string, target: target ?? "all", ...(row.phase ? { phase: row.phase } : {}) };
    default:
      return { type: "undoSceneStart" };
  }
}

function cleanHotkey(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 40) {
    throw new ValidationError("hotkey", "Choose a key, such as F1 or Ctrl+1.");
  }
  return value.trim().toLowerCase();
}

/** A hotkey's actions in order, through cue_actions_order. Exported for the query-plan tests. */
export const HOTKEY_ACTIONS_SQL = `SELECT a.*, s.id AS session_id, s.campaign_id, fs.id AS from_session_id, fs.campaign_id AS from_campaign_id, p.board_id
  FROM cue_actions a
  LEFT JOIN scenes sc ON sc.id = a.scene_id LEFT JOIN sessions s ON s.id = sc.session_id
  LEFT JOIN scenes fsc ON fsc.id = a.from_scene_id LEFT JOIN sessions fs ON fs.id = fsc.session_id
  LEFT JOIN pads p ON p.id = a.pad_id
  WHERE a.hotkey = ? ORDER BY a.position`;

/** What a hotkey runs, in order (empty when nothing). */
export function getHotkeyActions(store: Store, hotkey: string): CueAction[] {
  return store.all<ActionRow>(HOTKEY_ACTIONS_SQL, cleanHotkey(hotkey)).map(fromRow);
}

/** Every hotkey that runs something, in key order. */
export function listHotkeys(store: Store): string[] {
  return store.all<{ hotkey: string }>("SELECT DISTINCT hotkey FROM cue_actions ORDER BY hotkey").map((row) => row.hotkey);
}

/** Replaces what a hotkey runs, as one undoable step; an empty list frees the key. */
export function setHotkeyActions(store: Store, hotkey: string, actions: CueAction[]): void {
  const key = cleanHotkey(hotkey);
  if (!Array.isArray(actions) || actions.length > MAX_ACTIONS) {
    throw new ValidationError("actions", `A key can run up to ${MAX_ACTIONS} actions.`);
  }
  actions.forEach((action, index) => {
    if (!isCueAction(action) || action.type === "removeQueued") throw new ValidationError(`actions[${index}]`, "This action cannot be put on a key.");
  });
  const rows = actions.map((action, index) => toRow(store, action, index));
  store.change(actions.length === 0 ? `Clear key ${key.toUpperCase()}` : `Set key ${key.toUpperCase()}`, () => {
    store.run("DELETE FROM cue_actions WHERE hotkey = ?", key);
    rows.forEach((row, index) =>
      store.run(
        `INSERT INTO cue_actions (id, hotkey, position, ${COLUMNS.join(", ")}) VALUES (?, ?, ?, ${placeholders(COLUMNS.length)})`,
        newId(),
        key,
        (index + 1) * GAP,
        ...COLUMNS.map((column) => row[column]),
      ),
    );
  });
}
