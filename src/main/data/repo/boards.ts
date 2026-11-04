/**
 * Pad boards (DAT-11; design/prototype/src/views/boards.js). A board is a grid
 * of 1 to 8 columns and rows. Each pad sits in one cell or waits among the
 * spare pads (off the grid, where its hotkey does nothing). Resizing keeps every
 * pad at its row and column; pads outside a smaller grid move to the spare pads
 * and are never deleted. A pad plays one library track, several as variants
 * (at random or in turn), or any effect with a tag.
 */
import { ValidationError } from "../errors";
import { GAP } from "../ordering";
import type { SQLInputValue } from "../sqlite";
import type { Store } from "../store";
import {
  MAX_GRID_SIZE,
  PAD_COLORS,
  PAD_MODES,
  PAD_SOUND_KINDS,
  PAD_SOUND_ORDERS,
  type Board,
  type BoardLayout,
  type Pad,
  type PadCell,
  type PadColor,
  type PadInput,
  type PadMode,
  type PadSoundKind,
  type PadSoundOrder,
  type Placement,
} from "../types";
import * as v from "../validate";
import { newId, patchOf, placeholders, plural, requireRow } from "./common";
import { containerRepo } from "./containers";

const toBoard = (row: Record<string, SQLInputValue>): Board => ({
  id: row.id as string,
  title: row.title as string,
  background: row.background as string,
  folderId: row.folder_id as string | null,
  position: row.position as number,
  cols: row.grid_cols as number,
  rows: row.grid_rows as number,
  createdAt: row.created_at as number,
  updatedAt: row.updated_at as number,
});

const repo = containerRepo({
  entity: "board",
  label: "pad board",
  table: "boards",
  folderScope: "boards",
  campaignTable: "campaign_boards",
  memberColumn: "board_id",
  toRecord: toBoard,
});

const gridSize = (field: string, value: unknown) => v.integer(field, value, 1, MAX_GRID_SIZE);

/** A new board; 4 x 3 unless another size is given (as the prototype's New board). */
export function createBoard(
  store: Store,
  input: { id?: string; title: string; cols?: number; rows?: number; background?: string; folderId?: string | null; placement?: Placement },
): Board {
  const record = v.record("board", input);
  return repo.create(store, input, {
    grid_cols: gridSize("cols", record.cols ?? 4),
    grid_rows: gridSize("rows", record.rows ?? 3),
  });
}

export const getBoard = repo.get;
export const listBoards = repo.list;

/** Renames a board or changes its background; resizeBoard changes its grid. */
export function updateBoard(store: Store, id: string, changes: { title?: string; background?: string }): Board {
  const patch = patchOf(changes, ["title", "background"]);
  const boardId = repo.requireContainer(store, id);
  return repo.applyUpdate(store, boardId, repo.titleColumns(patch));
}

export const moveBoard = repo.move;
/** Deletes the board with all its pads; the sound files stay in the library. */
export const deleteBoard = repo.remove;

// --- Pads ---

type PadRow = {
  id: string;
  board_id: string;
  grid_row: number | null;
  grid_col: number | null;
  spare_position: number | null;
  label: string;
  icon: string;
  color: string;
  hotkey: string | null;
  mode: string;
  sound_kind: string;
  sound_order: string;
  sound_tag_id: string | null;
  volume: number;
  fade_in_ms: number;
  fade_ms: number;
};

function toPad(row: PadRow, trackIds: string[]): Pad {
  return {
    id: row.id,
    boardId: row.board_id,
    cell: row.grid_row === null ? null : { row: row.grid_row, col: row.grid_col as number },
    label: row.label,
    icon: row.icon,
    color: row.color as PadColor,
    hotkey: row.hotkey,
    mode: row.mode as PadMode,
    sound: { kind: row.sound_kind as PadSoundKind, trackIds, order: row.sound_order as PadSoundOrder, tagId: row.sound_tag_id },
    volume: row.volume,
    fadeMs: row.fade_ms,
    fadeInMs: row.fade_in_ms,
  };
}

/**
 * Drawing a board: its pads (grid row by row, then spare) and their sounds in
 * order, through pads_board and pad_sounds' key. Exported for the query-plan tests.
 */
export const BOARD_PADS_SQL = {
  pads: "SELECT * FROM pads WHERE board_id = ? ORDER BY grid_row IS NULL, grid_row, grid_col, spare_position",
  sounds: `SELECT ps.pad_id, ps.track_id FROM pads p JOIN pad_sounds ps ON ps.pad_id = p.id WHERE p.board_id = ?
    ORDER BY ps.pad_id, ps.position`,
} as const;

/** A board's pads: the grid row by row, then the spare pads in their order. */
function loadPads(store: Store, boardId: string): Pad[] {
  const rows = store.all<PadRow>(BOARD_PADS_SQL.pads, boardId);
  const sounds = new Map<string, string[]>();
  for (const s of store.all<{ pad_id: string; track_id: string }>(BOARD_PADS_SQL.sounds, boardId)) {
    const list = sounds.get(s.pad_id);
    if (list) list.push(s.track_id);
    else sounds.set(s.pad_id, [s.track_id]);
  }
  return rows.map((row) => toPad(row, sounds.get(row.id) ?? []));
}

export function getPad(store: Store, id: string): Pad | null {
  const row = store.get<PadRow>("SELECT * FROM pads WHERE id = ?", id);
  if (!row) return null;
  const trackIds = store
    .all<{ track_id: string }>("SELECT track_id FROM pad_sounds WHERE pad_id = ? ORDER BY position, rowid", id)
    .map((r) => r.track_id);
  return toPad(row, trackIds);
}

/** Every pad of a board: the grid row by row, then the spare pads. */
export function listPads(store: Store, boardId: string): Pad[] {
  return loadPads(store, repo.requireContainer(store, boardId));
}

/** The board as the screens show it: `slots` row by row (null = empty cell), then `spare`. */
export function getBoardLayout(store: Store, boardId: string): BoardLayout {
  const board = repo.get(store, repo.requireContainer(store, boardId)) as Board;
  const slots: (Pad | null)[] = Array.from({ length: board.cols * board.rows }, (): Pad | null => null);
  const spare: Pad[] = [];
  for (const pad of loadPads(store, board.id)) {
    if (pad.cell) slots[pad.cell.row * board.cols + pad.cell.col] = pad;
    else spare.push(pad);
  }
  return { board, slots, spare };
}

const ICON_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const HOTKEY = /^\S{1,12}$/;

/** Checked columns for the pad fields present in `input`, plus the sound tracks when given. */
function padColumns(store: Store, input: Record<string, unknown>): { columns: Record<string, SQLInputValue>; trackIds?: string[] } {
  const columns: Record<string, SQLInputValue> = {};
  if (input.label !== undefined) columns.label = v.optionalText("label", input.label, v.MAX_NAME_LENGTH);
  if (input.icon !== undefined) {
    if (typeof input.icon !== "string" || !ICON_NAME.test(input.icon)) throw new ValidationError("icon", "icon must be an icon name such as swords.");
    columns.icon = input.icon;
  }
  if (input.color !== undefined) columns.color = v.oneOf("color", input.color, PAD_COLORS);
  if (input.hotkey !== undefined) columns.hotkey = cleanHotkey(input.hotkey);
  if (input.mode !== undefined) columns.mode = v.oneOf("mode", input.mode, PAD_MODES);
  if (input.volume !== undefined) columns.volume = v.numberInRange("volume", input.volume, 0, 1);
  if (input.fadeMs !== undefined) columns.fade_ms = v.milliseconds("fadeMs", input.fadeMs);
  if (input.fadeInMs !== undefined) columns.fade_in_ms = v.milliseconds("fadeInMs", input.fadeInMs);
  let trackIds: string[] | undefined;
  if (input.sound !== undefined) {
    const sound = patchOf(input.sound, ["kind", "trackIds", "order", "tagId"]);
    if (sound.kind !== undefined) columns.sound_kind = v.oneOf("sound.kind", sound.kind, PAD_SOUND_KINDS);
    if (sound.order !== undefined) columns.sound_order = v.oneOf("sound.order", sound.order, PAD_SOUND_ORDERS);
    if (sound.tagId !== undefined) columns.sound_tag_id = sound.tagId === null ? null : requireRow(store, "tags", "tag", sound.tagId);
    if (sound.trackIds !== undefined) {
      trackIds = [...new Set(v.ids("sound.trackIds", sound.trackIds))].map((id) => requireRow(store, "tracks", "track", id));
    }
  }
  return { columns, trackIds };
}

function cleanHotkey(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !HOTKEY.test(value)) throw new ValidationError("hotkey", "hotkey must be a single key, such as Q or 1.");
  return value.toLowerCase();
}

function writeSounds(store: Store, padId: string, trackIds: string[]) {
  store.run("DELETE FROM pad_sounds WHERE pad_id = ?", padId);
  trackIds.forEach((trackId, index) =>
    store.run("INSERT INTO pad_sounds (pad_id, track_id, position) VALUES (?, ?, ?)", padId, trackId, (index + 1) * GAP),
  );
}

function requirePad(store: Store, id: unknown): Pad {
  return getPad(store, requireRow(store, "pads", "pad", id)) as Pad;
}

/** The first empty cell, row by row, or null when the grid is full. */
function firstEmptyCell(store: Store, board: Board): PadCell | null {
  const taken = new Set(
    store
      .all<{ grid_row: number; grid_col: number }>("SELECT grid_row, grid_col FROM pads WHERE board_id = ? AND grid_row IS NOT NULL", board.id)
      .map((c) => c.grid_row * MAX_GRID_SIZE + c.grid_col),
  );
  for (let row = 0; row < board.rows; row++)
    for (let col = 0; col < board.cols; col++) if (!taken.has(row * MAX_GRID_SIZE + col)) return { row, col };
  return null;
}

const nextSparePosition = (store: Store, boardId: string) =>
  (store.get<{ last: number }>("SELECT coalesce(max(spare_position), 0) AS last FROM pads WHERE board_id = ?", boardId) as { last: number }).last + GAP;

function checkCell(store: Store, board: Board, value: unknown): PadCell {
  const cell = v.record("cell", value);
  const row = v.integer("cell.row", cell.row, 0, MAX_GRID_SIZE - 1);
  const col = v.integer("cell.col", cell.col, 0, MAX_GRID_SIZE - 1);
  if (row >= board.rows || col >= board.cols) {
    throw new ValidationError("cell", `Row ${row + 1}, column ${col + 1} is outside the ${board.cols} × ${board.rows} grid.`);
  }
  return { row, col };
}

const padAt = (store: Store, boardId: string, cell: PadCell) =>
  store.get<{ id: string; label: string }>("SELECT id, label FROM pads WHERE board_id = ? AND grid_row = ? AND grid_col = ?", boardId, cell.row, cell.col);

/** Writes a new pad (inside a change) in `cell`, or among the spare pads when null. */
function insertPad(store: Store, boardId: string, id: string, cell: PadCell | null, columns: Record<string, SQLInputValue>, trackIds: string[]) {
  const all: Record<string, SQLInputValue> = {
    id,
    board_id: boardId,
    grid_row: cell?.row ?? null,
    grid_col: cell?.col ?? null,
    spare_position: cell ? null : nextSparePosition(store, boardId),
    ...columns,
  };
  const names = Object.keys(all);
  store.run(`INSERT INTO pads (${names.join(", ")}) VALUES (${placeholders(names.length)})`, ...names.map((n) => all[n]));
  writeSounds(store, id, trackIds);
  repo.touch(store, boardId);
}

/**
 * Adds a pad at `at` (a cell, or "spare"); by default in the first empty cell,
 * or among the spare pads when the grid is full. Missing settings take the
 * prototype's defaults: "New pad", star, gold, one-shot, volume 0.8, 1.5 s fade.
 */
export function addPad(store: Store, boardId: string, input: PadInput & { at?: PadCell | "spare" }): Pad {
  const record = v.record("pad", input);
  const board = repo.get(store, repo.requireContainer(store, boardId)) as Board;
  const id = newId(record.id);
  const { columns, trackIds } = padColumns(store, { label: "New pad", ...record });
  const wanted = record.at === undefined || record.at === "spare" ? null : checkCell(store, board, record.at);
  if (wanted && padAt(store, board.id, wanted)) {
    throw new ValidationError("at", `Row ${wanted.row + 1}, column ${wanted.col + 1} already has a pad.`);
  }
  store.change(`Add pad "${columns.label}"`, () => {
    const cell = record.at === "spare" ? null : (wanted ?? firstEmptyCell(store, board));
    insertPad(store, board.id, id, cell, columns, trackIds ?? []);
  });
  return getPad(store, id) as Pad;
}

/** Changes a pad's settings; only the fields given (sound fields too) change. */
export function updatePad(store: Store, padId: string, changes: PadInput): Pad {
  const patch = patchOf(changes, ["label", "icon", "color", "hotkey", "mode", "sound", "volume", "fadeMs", "fadeInMs"]);
  const pad = requirePad(store, padId);
  const { columns, trackIds } = padColumns(store, patch);
  const names = Object.keys(columns);
  store.change(`Change pad "${pad.label}"`, () => {
    if (names.length > 0) {
      store.run(`UPDATE pads SET ${names.map((n) => `${n} = ?`).join(", ")} WHERE id = ?`, ...names.map((n) => columns[n]), pad.id);
    }
    if (trackIds) writeSounds(store, pad.id, trackIds);
    repo.touch(store, pad.boardId);
  });
  return getPad(store, pad.id) as Pad;
}

/** Gives the pad this hotkey and takes it from any other pad on the board ("Take it from that pad"). */
export function takePadHotkey(store: Store, padId: string, hotkey: string): Pad {
  const pad = requirePad(store, padId);
  const key = cleanHotkey(hotkey);
  if (key === null) throw new ValidationError("hotkey", "Choose a key to take.");
  store.change(`Give key ${key.toUpperCase()} to "${pad.label}"`, () => {
    store.run("UPDATE pads SET hotkey = NULL WHERE board_id = ? AND hotkey = ? AND id <> ?", pad.boardId, key, pad.id);
    store.run("UPDATE pads SET hotkey = ? WHERE id = ?", key, pad.id);
  });
  return getPad(store, pad.id) as Pad;
}

/**
 * Moves a pad to a cell or to the spare pads. Onto another pad, the two swap:
 * a pad from the grid takes the other's cell; a spare pad's place among the
 * spare pads goes to the pad it replaced.
 */
export function movePad(store: Store, padId: string, to: PadCell | "spare"): Pad {
  const pad = requirePad(store, padId);
  const board = repo.get(store, pad.boardId) as Board;
  if (to === "spare") {
    if (pad.cell) {
      store.change(`Move "${pad.label}" to Spare pads`, () =>
        store.run("UPDATE pads SET grid_row = NULL, grid_col = NULL, spare_position = ? WHERE id = ?", nextSparePosition(store, board.id), pad.id),
      );
    }
    return getPad(store, pad.id) as Pad;
  }
  const cell = checkCell(store, board, to);
  if (pad.cell && pad.cell.row === cell.row && pad.cell.col === cell.col) return pad;
  const other = padAt(store, board.id, cell);
  store.change(`Move pad "${pad.label}"`, () => {
    const spareAt = (store.get<{ p: number | null }>("SELECT spare_position AS p FROM pads WHERE id = ?", pad.id) as { p: number | null }).p;
    if (pad.cell) {
      // Out of its cell first (to a temporary spare place), so the two never share a cell.
      store.run("UPDATE pads SET grid_row = NULL, grid_col = NULL, spare_position = -1 WHERE id = ?", pad.id);
      if (other) store.run("UPDATE pads SET grid_row = ?, grid_col = ? WHERE id = ?", pad.cell.row, pad.cell.col, other.id);
    } else if (other) {
      // The spare pad gives up its place among the spare pads (positions are unique) to the pad it replaces.
      store.run("UPDATE pads SET spare_position = -1 WHERE id = ?", pad.id);
      store.run("UPDATE pads SET grid_row = NULL, grid_col = NULL, spare_position = ? WHERE id = ?", spareAt, other.id);
    }
    store.run("UPDATE pads SET grid_row = ?, grid_col = ?, spare_position = NULL WHERE id = ?", cell.row, cell.col, pad.id);
  });
  return getPad(store, pad.id) as Pad;
}

/** Puts a spare pad back in the first empty cell. */
export function putPadBack(store: Store, padId: string): Pad {
  const pad = requirePad(store, padId);
  if (pad.cell) return pad;
  const cell = firstEmptyCell(store, repo.get(store, pad.boardId) as Board);
  if (!cell) throw new ValidationError("padId", "No empty slot. Make the grid bigger first.");
  return movePad(store, pad.id, cell);
}

/** A copy of the pad (without its hotkey) in the first empty cell, or among the spare pads. */
export function duplicatePad(store: Store, padId: string): Pad {
  const pad = requirePad(store, padId);
  const board = repo.get(store, pad.boardId) as Board;
  const id = newId();
  store.change(`Copy pad "${pad.label}"`, () =>
    insertPad(
      store,
      board.id,
      id,
      firstEmptyCell(store, board),
      {
        label: `${pad.label} (copy)`,
        icon: pad.icon,
        color: pad.color,
        hotkey: null,
        mode: pad.mode,
        sound_kind: pad.sound.kind,
        sound_order: pad.sound.order,
        sound_tag_id: pad.sound.tagId,
        volume: pad.volume,
        fade_ms: pad.fadeMs,
        fade_in_ms: pad.fadeInMs,
      },
      pad.sound.trackIds,
    ),
  );
  return getPad(store, id) as Pad;
}

/** Deletes pads; their sound files stay in the library. */
export function deletePads(store: Store, padIds: string[]): void {
  const pads = v.ids("padIds", padIds).map((id) => requirePad(store, id));
  store.change(`Delete ${plural(pads.length, "pad")}`, () => {
    for (const pad of pads) {
      store.run("DELETE FROM pads WHERE id = ?", pad.id);
      repo.touch(store, pad.boardId);
    }
  });
}

/**
 * Changes the grid size (1 to 8 each way). Pads keep their row and column;
 * those outside the new grid move to the spare pads, in row order. Undo puts
 * them back. Returns the ids of the pads that moved.
 */
export function resizeBoard(store: Store, boardId: string, size: { cols: number; rows: number }): { movedToSpare: string[] } {
  const board = repo.get(store, repo.requireContainer(store, boardId)) as Board;
  const input = v.record("size", size);
  const cols = gridSize("cols", input.cols);
  const rows = gridSize("rows", input.rows);
  if (cols === board.cols && rows === board.rows) return { movedToSpare: [] };
  const moving = store
    .all<{ id: string }>(
      "SELECT id FROM pads WHERE board_id = ? AND (grid_row >= ? OR grid_col >= ?) ORDER BY grid_row, grid_col",
      board.id,
      rows,
      cols,
    )
    .map((p) => p.id);
  store.change(`Resize "${board.title}" to ${cols} × ${rows}`, () => {
    const start = nextSparePosition(store, board.id);
    moving.forEach((id, index) =>
      store.run("UPDATE pads SET grid_row = NULL, grid_col = NULL, spare_position = ? WHERE id = ?", start + index * GAP, id),
    );
    store.run("UPDATE boards SET grid_cols = ?, grid_rows = ?, updated_at = ? WHERE id = ?", cols, rows, store.now(), board.id);
  });
  return { movedToSpare: moving };
}

export type { Board, Pad };
