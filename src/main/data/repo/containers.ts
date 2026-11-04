/**
 * What playlists and soundboards have in common: a titled list with a
 * background, kept in a folder, holding ordered entries that point at library
 * tracks, plus dividers (ORG-4). playlists.ts and boards.ts build on this.
 */
import { ValidationError } from "../errors";
import { positionFor, positionsFor, type OrderedList } from "../ordering";
import type { SQLInputValue } from "../sqlite";
import type { Store } from "../store";
import type { FolderScope, Placement, Playlist } from "../types";
import * as v from "../validate";
import { newId, patchOf, placeholders, plural, requireRow } from "./common";
import { requireFolderFor } from "./folders";

export type ContainerConfig = {
  /** Word used in messages and undo labels. */
  entity: "playlist" | "board";
  table: "playlists" | "boards";
  itemsTable: "playlist_items" | "board_items";
  parentColumn: "playlist_id" | "board_id";
  /** Item kind for an entry that plays a track. */
  entryKind: "track" | "sound";
  folderScope: FolderScope;
  campaignTable: "campaign_playlists" | "campaign_boards";
};

type ContainerRow = {
  id: string;
  title: string;
  background: string;
  folder_id: string | null;
  position: number;
  created_at: number;
  updated_at: number;
};

/** An item row with its track's title joined in. */
export type ItemRow = Record<string, SQLInputValue> & {
  id: string;
  kind: string;
  track_id: string | null;
  label: string;
  position: number;
  title: string | null;
};

const toContainer = (row: ContainerRow): Playlist => ({
  id: row.id,
  title: row.title,
  background: row.background,
  folderId: row.folder_id,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function containerRepo(config: ContainerConfig) {
  const { entity, table, itemsTable, parentColumn, entryKind, folderScope, campaignTable } = config;
  const label = entity === "playlist" ? "playlist" : "soundboard";
  const inFolder = (folderId: string | null): OrderedList => ({ table, scope: "folder_id IS ?", params: [folderId] });
  const itemsOf = (parentId: string): OrderedList => ({ table: itemsTable, scope: `${parentColumn} = ?`, params: [parentId] });
  /** Marks the list as changed when its entries change. */
  const touch = (store: Store, id: string) =>
    store.run(`UPDATE ${table} SET updated_at = ? WHERE id = ?`, store.now(), id);

  function get(store: Store, id: string): Playlist | null {
    const row = store.get<ContainerRow>(`SELECT * FROM ${table} WHERE id = ?`, id);
    return row ? toContainer(row) : null;
  }

  function requireContainer(store: Store, id: unknown): string {
    return requireRow(store, table, entity, id);
  }

  function create(
    store: Store,
    input: { id?: string; title: string; background?: string; folderId?: string | null; placement?: Placement },
  ): Playlist {
    const id = newId(input.id);
    const title = v.requiredName("title", input.title);
    const background = v.optionalText("background", input.background, 4000);
    const folderId = requireFolderFor(store, input.folderId, folderScope);
    store.change(`Add ${label} "${title}"`, () => {
      const position = positionFor(store, inFolder(folderId), input.placement ?? "end");
      const now = store.now();
      store.run(
        `INSERT INTO ${table} (id, title, background, folder_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        title,
        background,
        folderId,
        position,
        now,
        now,
      );
    });
    return get(store, id) as Playlist;
  }

  /**
   * Lists in order. `folderId`: only that folder (null = top level);
   * leave it out for every folder. `campaignId`: only those in the campaign.
   */
  function list(store: Store, options: { folderId?: string | null; campaignId?: string } = {}): Playlist[] {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (options.folderId !== undefined) {
      where.push("folder_id IS ?");
      params.push(options.folderId === null ? null : v.id("folderId", options.folderId));
    }
    if (options.campaignId !== undefined) {
      where.push(`id IN (SELECT ${parentColumn} FROM ${campaignTable} WHERE campaign_id = ?)`);
      params.push(v.id("campaignId", options.campaignId));
    }
    const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return store.all<ContainerRow>(`SELECT * FROM ${table} ${filter} ORDER BY position, rowid`, ...params).map(toContainer);
  }

  function update(store: Store, id: string, changes: { title?: string; background?: string }): Playlist {
    const patch = patchOf(changes, ["title", "background"]);
    const containerId = requireContainer(store, id);
    const title = patch.title === undefined ? undefined : v.requiredName("title", patch.title);
    const background = patch.background === undefined ? undefined : v.optionalText("background", patch.background, 4000);
    store.change(`Edit ${label}`, () => {
      if (title !== undefined) store.run(`UPDATE ${table} SET title = ? WHERE id = ?`, title, containerId);
      if (background !== undefined) store.run(`UPDATE ${table} SET background = ? WHERE id = ?`, background, containerId);
      store.run(`UPDATE ${table} SET updated_at = ? WHERE id = ?`, store.now(), containerId);
    });
    return get(store, containerId) as Playlist;
  }

  /** Moves into a folder (null = top level; leave out to stay) at a place among its neighbours. */
  function move(store: Store, id: string, target: { folderId?: string | null; placement: Placement }): Playlist {
    const containerId = requireContainer(store, id);
    const current = get(store, containerId) as Playlist;
    const folderId =
      target.folderId === undefined ? current.folderId : requireFolderFor(store, target.folderId, folderScope);
    store.change(`Move ${label}`, () => {
      const position = positionFor(store, inFolder(folderId), target.placement, containerId);
      store.run(`UPDATE ${table} SET folder_id = ?, position = ? WHERE id = ?`, folderId, position, containerId);
    });
    return get(store, containerId) as Playlist;
  }

  /** Deletes the list and its entries; the tracks stay in the library (DAT-1). */
  function remove(store: Store, id: string): void {
    const container = get(store, requireContainer(store, id)) as Playlist;
    store.change(`Delete ${label} "${container.title}"`, () => {
      store.run(`DELETE FROM ${table} WHERE id = ?`, container.id);
    });
  }

  function listItemRows(store: Store, parentId: string): ItemRow[] {
    requireContainer(store, parentId);
    return store.all<ItemRow>(
      `SELECT i.*, t.title AS title FROM ${itemsTable} i LEFT JOIN tracks t ON t.id = i.track_id
       WHERE i.${parentColumn} = ? ORDER BY i.position, i.rowid`,
      parentId,
    );
  }

  function itemRow(store: Store, itemId: string): ItemRow {
    return store.get<ItemRow>(
      `SELECT i.*, t.title AS title FROM ${itemsTable} i LEFT JOIN tracks t ON t.id = i.track_id WHERE i.id = ?`,
      itemId,
    ) as ItemRow;
  }

  /**
   * Adds entries for library tracks, together, at `placement`.
   * `extra` holds additional columns per entry (board sound settings).
   */
  function addEntries(
    store: Store,
    parentId: string,
    entries: { trackId: string; extra?: Record<string, SQLInputValue> }[],
    placement: Placement,
  ): ItemRow[] {
    const containerId = requireContainer(store, parentId);
    const trackIds = entries.map((entry, index) => requireRow(store, "tracks", "track", v.id(`trackIds[${index}]`, entry.trackId)));
    const ids = trackIds.map(() => newId());
    store.change(`Add ${plural(trackIds.length, entryKind)} to ${label}`, () => {
      const positions = positionsFor(store, itemsOf(containerId), placement, trackIds.length);
      entries.forEach((entry, index) => {
        const extra = entry.extra ?? {};
        const columns = ["id", parentColumn, "kind", "track_id", "position", ...Object.keys(extra)];
        store.run(
          `INSERT INTO ${itemsTable} (${columns.join(", ")}) VALUES (${placeholders(columns.length)})`,
          ids[index],
          containerId,
          entryKind,
          trackIds[index],
          positions[index],
          ...Object.values(extra),
        );
      });
      touch(store, containerId);
    });
    return ids.map((itemId) => itemRow(store, itemId));
  }

  function addDivider(store: Store, parentId: string, text: string, placement: Placement): ItemRow {
    const containerId = requireContainer(store, parentId);
    const dividerLabel = v.optionalText("label", text, v.MAX_NAME_LENGTH);
    const id = newId();
    store.change(`Add divider to ${label}`, () => {
      const position = positionFor(store, itemsOf(containerId), placement);
      store.run(
        `INSERT INTO ${itemsTable} (id, ${parentColumn}, kind, label, position) VALUES (?, ?, 'divider', ?, ?)`,
        id,
        containerId,
        dividerLabel,
        position,
      );
      touch(store, containerId);
    });
    return itemRow(store, id);
  }

  function requireItem(store: Store, itemId: unknown): ItemRow {
    const id = requireRow(store, itemsTable, `${label} entry`, itemId);
    return itemRow(store, id);
  }

  function renameDivider(store: Store, itemId: string, text: string): void {
    const item = requireItem(store, itemId);
    if (item.kind !== "divider") throw new ValidationError("itemId", "That entry is not a divider.");
    const dividerLabel = v.optionalText("label", text, v.MAX_NAME_LENGTH);
    store.change("Rename divider", () => {
      store.run(`UPDATE ${itemsTable} SET label = ? WHERE id = ?`, dividerLabel, item.id);
      touch(store, item[parentColumn] as string);
    });
  }

  /** Moves the selected entries together to `placement`, keeping their order. */
  function moveItems(store: Store, itemIds: string[], placement: Placement): void {
    const items = v.ids("itemIds", itemIds).map((id) => requireItem(store, id));
    if (items.length === 0) return;
    const parentId = items[0][parentColumn] as string;
    if (items.some((item) => item[parentColumn] !== parentId)) {
      throw new ValidationError("itemIds", `Entries from different ${label}s cannot be moved together.`);
    }
    items.sort((a, b) => a.position - b.position);
    const moving = items.map((item) => item.id);
    store.change(`Move ${plural(items.length, "entry", "entries")}`, () => {
      const positions = positionsFor(store, itemsOf(parentId), placement, items.length, moving);
      items.forEach((item, index) =>
        store.run(`UPDATE ${itemsTable} SET position = ? WHERE id = ?`, positions[index], item.id),
      );
      touch(store, parentId);
    });
  }

  /** Takes entries out of the list; their tracks stay in the library. */
  function removeItems(store: Store, itemIds: string[]): void {
    const items = v.ids("itemIds", itemIds).map((id) => requireItem(store, id));
    store.change(`Remove ${plural(items.length, "entry", "entries")} from ${label}`, () => {
      for (const item of items) {
        store.run(`DELETE FROM ${itemsTable} WHERE id = ?`, item.id);
        touch(store, item[parentColumn] as string);
      }
    });
  }

  return {
    get,
    create,
    list,
    update,
    move,
    remove,
    listItemRows,
    addEntries,
    addDivider,
    renameDivider,
    requireItem,
    moveItems,
    removeItems,
  };
}
