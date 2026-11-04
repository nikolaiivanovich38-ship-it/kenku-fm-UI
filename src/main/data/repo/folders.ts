/**
 * Folders (ORG-4) for playlists, boards and sessions. Folders nest; each
 * folder holds one kind of thing (its scope). Folders and the things in them
 * are ordered separately: the interface shows a folder's subfolders, then its
 * items.
 */
import { ValidationError } from "../errors";
import { positionFor, positionsFor, type OrderedList } from "../ordering";
import type { Store } from "../store";
import { FOLDER_SCOPES, type Folder, type FolderScope, type Placement } from "../types";
import * as v from "../validate";
import { newId, patchOf, requireRow, toFlag } from "./common";

type FolderRow = {
  id: string;
  scope: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  collapsed: number;
  position: number;
};

const toFolder = (row: FolderRow): Folder => ({
  id: row.id,
  scope: row.scope as FolderScope,
  parentId: row.parent_id,
  name: row.name,
  color: row.color,
  collapsed: row.collapsed === 1,
  position: row.position,
});

/** Which table each scope's items live in. */
export const ITEM_TABLES: Record<FolderScope, string> = {
  playlists: "playlists",
  boards: "boards",
  sessions: "sessions",
};

const siblings = (scope: FolderScope, parentId: string | null): OrderedList => ({
  table: "folders",
  // The UNIQUE folders_order index's expression (NULL parent = top level).
  scope: "scope = ? AND coalesce(parent_id, '') = ?",
  params: [scope, parentId ?? ""],
});

/**
 * Checks `folderId` (when not null) is a folder holding `scope`; used by the
 * repositories that move items into folders.
 */
export function requireFolderFor(store: Store, folderId: unknown, scope: FolderScope): string | null {
  if (folderId === undefined || folderId === null) return null;
  const id = requireRow(store, "folders", "folder", folderId);
  const folder = getFolder(store, id) as Folder;
  if (folder.scope !== scope) {
    throw new ValidationError("folderId", `That folder holds ${folder.scope}, not ${scope}.`);
  }
  return id;
}

export function createFolder(
  store: Store,
  input: { id?: string; scope: FolderScope; name: string; parentId?: string | null; color?: string | null; placement?: Placement },
): Folder {
  const id = newId(input.id);
  const scope = v.oneOf("scope", input.scope, FOLDER_SCOPES);
  const name = v.requiredName("name", input.name);
  const color = v.nullableColor("color", input.color);
  const parentId = requireFolderFor(store, input.parentId, scope);
  store.change(`Add folder "${name}"`, () => {
    const position = positionFor(store, siblings(scope, parentId), input.placement ?? "end");
    store.run(
      "INSERT INTO folders (id, scope, parent_id, name, color, position) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      scope,
      parentId,
      name,
      color,
      position,
    );
  });
  return getFolder(store, id) as Folder;
}

export function getFolder(store: Store, id: string): Folder | null {
  const row = store.get<FolderRow>("SELECT * FROM folders WHERE id = ?", id);
  return row ? toFolder(row) : null;
}

/** All folders of one scope as a tree flattened depth-first (parents before their children). */
export function listFolders(store: Store, scope: FolderScope): Folder[] {
  const folders = store
    .all<FolderRow>("SELECT * FROM folders WHERE scope = ? ORDER BY position, rowid", v.oneOf("scope", scope, FOLDER_SCOPES))
    .map(toFolder);
  const children = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const list = children.get(folder.parentId) ?? [];
    list.push(folder);
    children.set(folder.parentId, list);
  }
  const result: Folder[] = [];
  const visit = (parentId: string | null) => {
    for (const folder of children.get(parentId) ?? []) {
      result.push(folder);
      visit(folder.id);
    }
  };
  visit(null);
  return result;
}

export function updateFolder(
  store: Store,
  id: string,
  changes: { name?: string; color?: string | null; collapsed?: boolean },
): Folder {
  const patch = patchOf(changes, ["name", "color", "collapsed"]);
  const folderId = requireRow(store, "folders", "folder", id);
  const name = patch.name === undefined ? undefined : v.requiredName("name", patch.name);
  const color = "color" in patch ? v.nullableColor("color", patch.color) : undefined;
  const collapsed = patch.collapsed === undefined ? undefined : v.boolean("collapsed", patch.collapsed);
  store.change("Change folder", () => {
    if (name !== undefined) store.run("UPDATE folders SET name = ? WHERE id = ?", name, folderId);
    if (color !== undefined) store.run("UPDATE folders SET color = ? WHERE id = ?", color, folderId);
    if (collapsed !== undefined) store.run("UPDATE folders SET collapsed = ? WHERE id = ?", toFlag(collapsed), folderId);
  });
  return getFolder(store, folderId) as Folder;
}

/** Moves a folder (with everything in it) under another folder of the same kind, or to the top level. */
export function moveFolder(store: Store, id: string, target: { parentId: string | null; placement: Placement }): Folder {
  const folder = getFolder(store, requireRow(store, "folders", "folder", id)) as Folder;
  const parentId = requireFolderFor(store, target.parentId, folder.scope);
  // Walk up from the new parent: meeting the folder itself would make a loop.
  for (let at = parentId; at !== null; at = (getFolder(store, at) as Folder).parentId) {
    if (at === folder.id) throw new ValidationError("parentId", "A folder cannot go inside itself.");
  }
  store.change(`Move folder "${folder.name}"`, () => {
    const position = positionFor(store, siblings(folder.scope, parentId), target.placement, folder.id);
    store.run("UPDATE folders SET parent_id = ?, position = ? WHERE id = ?", parentId, position, folder.id);
  });
  return getFolder(store, folder.id) as Folder;
}

/** Deletes a folder; its subfolders and items move up into its parent. Nothing else is deleted. */
export function deleteFolder(store: Store, id: string): void {
  const folder = getFolder(store, requireRow(store, "folders", "folder", id)) as Folder;
  store.change(`Delete folder "${folder.name}"`, () => {
    const subfolders = store.all<{ id: string }>(
      "SELECT id FROM folders WHERE parent_id = ? ORDER BY position, rowid",
      folder.id,
    );
    // Subfolders take the deleted folder's place among its siblings.
    const folderPositions = positionsFor(store, siblings(folder.scope, folder.parentId), { after: folder.id }, subfolders.length);
    subfolders.forEach((sub, index) =>
      store.run("UPDATE folders SET parent_id = ?, position = ? WHERE id = ?", folder.parentId, folderPositions[index], sub.id),
    );
    const table = ITEM_TABLES[folder.scope];
    if (folder.scope === "sessions") {
      // Sessions are ordered within their campaign, not their folder.
      store.run("UPDATE sessions SET folder_id = ? WHERE folder_id = ?", folder.parentId, folder.id);
    } else {
      const items = store.all<{ id: string }>(
        `SELECT id FROM ${table} WHERE folder_id = ? ORDER BY position, rowid`,
        folder.id,
      );
      const itemPositions = positionsFor(
        store,
        { table, scope: "coalesce(folder_id, '') = ?", params: [folder.parentId ?? ""] },
        "end",
        items.length,
      );
      items.forEach((item, index) =>
        store.run(`UPDATE ${table} SET folder_id = ?, position = ? WHERE id = ?`, folder.parentId, itemPositions[index], item.id),
      );
    }
    store.run("DELETE FROM folders WHERE id = ?", folder.id);
  });
}
