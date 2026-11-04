/**
 * Soundboards. Each sound entry points at a library track and keeps the
 * current player's per-sound settings (loop, volume, fade in/out), so the same
 * track can be on several boards with different settings. Pads and their
 * action lists (SFX-1, PLY-8) come in a later schema version.
 */
import { ValidationError } from "../errors";
import type { SQLInputValue } from "../sqlite";
import type { Store } from "../store";
import type { Board, BoardItem, Placement, SoundSettings } from "../types";
import * as v from "../validate";
import { patchOf, toFlag } from "./common";
import { containerRepo, type ItemRow } from "./containers";

const repo = containerRepo({
  entity: "board",
  table: "boards",
  itemsTable: "board_items",
  parentColumn: "board_id",
  entryKind: "sound",
  folderScope: "boards",
  campaignTable: "campaign_boards",
});

function toItem(row: ItemRow): BoardItem {
  const base = { id: row.id, boardId: row.board_id as string, position: row.position };
  return row.kind === "sound"
    ? {
        ...base,
        kind: "sound",
        trackId: row.track_id as string,
        title: row.title as string,
        loop: row.loop === 1,
        volume: row.volume as number,
        fadeInMs: row.fade_in_ms as number,
        fadeOutMs: row.fade_out_ms as number,
      }
    : { ...base, kind: "divider", label: row.label };
}

/** Column values for the sound settings present in `input`. */
function settingsColumns(input: Record<string, unknown>): Record<string, SQLInputValue> {
  const columns: Record<string, SQLInputValue> = {};
  if (input.loop !== undefined) columns.loop = toFlag(v.boolean("loop", input.loop));
  if (input.volume !== undefined) columns.volume = v.numberInRange("volume", input.volume, 0, 1);
  if (input.fadeInMs !== undefined) columns.fade_in_ms = v.milliseconds("fadeInMs", input.fadeInMs);
  if (input.fadeOutMs !== undefined) columns.fade_out_ms = v.milliseconds("fadeOutMs", input.fadeOutMs);
  return columns;
}

export const createBoard = repo.create;
export const getBoard = repo.get;
export const listBoards = repo.list;
export const updateBoard = repo.update;
export const moveBoard = repo.move;
/** Deletes the board and its entries; its tracks stay in the library. */
export const deleteBoard = repo.remove;

export function listBoardItems(store: Store, boardId: string): BoardItem[] {
  return repo.listItemRows(store, boardId).map(toItem);
}

/** Adds library tracks as sounds, with optional settings (defaults: no loop, full volume, no fades). */
export function addSoundsToBoard(
  store: Store,
  boardId: string,
  sounds: ({ trackId: string } & Partial<SoundSettings>)[],
  placement: Placement = "end",
): BoardItem[] {
  if (!Array.isArray(sounds)) throw new ValidationError("sounds", "sounds must be a list.");
  const entries = sounds.map((sound, index) => {
    const input = v.record(`sounds[${index}]`, sound);
    return { trackId: input.trackId as string, extra: settingsColumns(input) };
  });
  return repo.addEntries(store, boardId, entries, placement).map(toItem);
}

export function addBoardDivider(store: Store, boardId: string, label: string, placement: Placement = "end"): BoardItem {
  return toItem(repo.addDivider(store, boardId, label, placement));
}

export function updateBoardSound(store: Store, itemId: string, changes: Partial<SoundSettings>): BoardItem {
  const patch = patchOf(changes, ["loop", "volume", "fadeInMs", "fadeOutMs"]);
  const item = repo.requireItem(store, itemId);
  if (item.kind !== "sound") throw new ValidationError("itemId", "That entry is not a sound.");
  const columns = settingsColumns(patch);
  const names = Object.keys(columns);
  if (names.length > 0) {
    store.change("Change sound settings", () =>
      store.run(
        `UPDATE board_items SET ${names.map((name) => `${name} = ?`).join(", ")} WHERE id = ?`,
        ...names.map((name) => columns[name]),
        item.id,
      ),
    );
  }
  return toItem(repo.requireItem(store, item.id));
}

export const renameBoardDivider = repo.renameDivider;
export const moveBoardItems = repo.moveItems;
export const removeBoardItems = repo.removeItems;

export type { Board };
