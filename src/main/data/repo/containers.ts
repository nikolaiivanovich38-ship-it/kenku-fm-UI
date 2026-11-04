/**
 * What playlists and pad boards have in common: a titled list with a
 * background, kept in a folder (ORG-4), in the library's order, and possibly
 * given to campaigns. playlists.ts and boards.ts add their own columns and contents.
 */
import { positionFor, type OrderedList } from "../ordering";
import type { SQLInputValue } from "../sqlite";
import type { Store } from "../store";
import type { FolderScope, Placement } from "../types";
import * as v from "../validate";
import { newId, placeholders, requireRow } from "./common";
import { requireFolderFor } from "./folders";

export type ContainerConfig<T> = {
  /** Word used in messages ("No playlist with id …"). */
  entity: "playlist" | "board";
  /** Word used in undo labels ("Add pad board …"). */
  label: string;
  table: "playlists" | "boards";
  folderScope: FolderScope;
  campaignTable: "campaign_playlists" | "campaign_boards";
  memberColumn: "playlist_id" | "board_id";
  toRecord: (row: Record<string, SQLInputValue>) => T;
};

export function containerRepo<T extends { id: string; title: string; folderId: string | null }>(config: ContainerConfig<T>) {
  const { entity, label, table, folderScope, campaignTable, memberColumn, toRecord } = config;
  const inFolder = (folderId: string | null): OrderedList => ({ table, scope: "folder_id IS ?", params: [folderId] });

  function get(store: Store, id: string): T | null {
    const row = store.get<Record<string, SQLInputValue>>(`SELECT * FROM ${table} WHERE id = ?`, id);
    return row ? toRecord(row) : null;
  }

  function requireContainer(store: Store, id: unknown): string {
    return requireRow(store, table, entity, id);
  }

  /** Marks the list as changed when its contents change. */
  function touch(store: Store, id: string) {
    store.run(`UPDATE ${table} SET updated_at = ? WHERE id = ?`, store.now(), id);
  }

  /**
   * Creates one; `extra` holds the columns only this kind has (already checked).
   * `after` runs inside the same change, for contents added with it.
   */
  function create(
    store: Store,
    input: { id?: string; title: string; background?: string; folderId?: string | null; placement?: Placement },
    extra: Record<string, SQLInputValue> = {},
    options: { placeAfter?: string; after?: (id: string) => void } = {},
  ): T {
    const id = newId(input.id);
    const title = v.requiredName("title", input.title);
    const background = v.optionalText("background", input.background, 4000);
    const folderId = options.placeAfter
      ? (get(store, options.placeAfter) as T).folderId
      : requireFolderFor(store, input.folderId, folderScope);
    store.change(`Add ${label} "${title}"`, () => {
      const placement = options.placeAfter ? { after: options.placeAfter } : (input.placement ?? "end");
      const now = store.now();
      const columns: Record<string, SQLInputValue> = {
        id,
        title,
        background,
        folder_id: folderId,
        position: positionFor(store, inFolder(folderId), placement),
        created_at: now,
        updated_at: now,
        ...extra,
      };
      const names = Object.keys(columns);
      store.run(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${placeholders(names.length)})`, ...names.map((n) => columns[n]));
      options.after?.(id);
    });
    return get(store, id) as T;
  }

  /**
   * Lists in order. `folderId`: only that folder (null = top level); leave it
   * out for every folder. `campaignId`: only those given to the campaign, in the
   * campaign's order.
   */
  function list(store: Store, options: { folderId?: string | null; campaignId?: string } = {}): T[] {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    let from = `${table} c`;
    let order = "c.position, c.rowid";
    if (options.campaignId !== undefined) {
      from += ` JOIN ${campaignTable} m ON m.${memberColumn} = c.id AND m.campaign_id = ?`;
      params.push(v.id("campaignId", options.campaignId));
      order = "m.position, c.rowid";
    }
    if (options.folderId !== undefined) {
      where.push("c.folder_id IS ?");
      params.push(options.folderId === null ? null : v.id("folderId", options.folderId));
    }
    const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return store.all<Record<string, SQLInputValue>>(`SELECT c.* FROM ${from} ${filter} ORDER BY ${order}`, ...params).map(toRecord);
  }

  /** Checked columns for a title or background change. */
  function titleColumns(patch: Record<string, unknown>): Record<string, SQLInputValue> {
    const columns: Record<string, SQLInputValue> = {};
    if (patch.title !== undefined) columns.title = v.requiredName("title", patch.title);
    if (patch.background !== undefined) columns.background = v.optionalText("background", patch.background, 4000);
    return columns;
  }

  /** Writes checked columns as one change ("Edit playlist"); `after` runs inside it. */
  function applyUpdate(store: Store, id: string, columns: Record<string, SQLInputValue>, label_ = `Edit ${label}`, after?: () => void): T {
    const names = Object.keys(columns);
    store.change(label_, () => {
      if (names.length > 0) {
        store.run(`UPDATE ${table} SET ${names.map((n) => `${n} = ?`).join(", ")} WHERE id = ?`, ...names.map((n) => columns[n]), id);
      }
      after?.();
      touch(store, id);
    });
    return get(store, id) as T;
  }

  /** Moves into a folder (null = top level; leave out to stay) at a place among its neighbours. */
  function move(store: Store, id: string, target: { folderId?: string | null; placement: Placement }): T {
    const containerId = requireContainer(store, id);
    const current = get(store, containerId) as T;
    const folderId = target.folderId === undefined ? current.folderId : requireFolderFor(store, target.folderId, folderScope);
    store.change(`Move ${label}`, () => {
      const position = positionFor(store, inFolder(folderId), target.placement, containerId);
      store.run(`UPDATE ${table} SET folder_id = ?, position = ? WHERE id = ?`, folderId, position, containerId);
    });
    return get(store, containerId) as T;
  }

  /** Deletes the list and what it holds; the tracks stay in the library (DAT-1). */
  function remove(store: Store, id: string): void {
    const container = get(store, requireContainer(store, id)) as T;
    store.change(`Delete ${label} "${container.title}"`, () => {
      store.run(`DELETE FROM ${table} WHERE id = ?`, container.id);
    });
  }

  return { get, requireContainer, touch, create, list, titleColumns, applyUpdate, move, remove };
}
