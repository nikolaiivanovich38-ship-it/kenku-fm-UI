/**
 * Library roots (DAT-8): named folders such as "Soundtracks" = H:\Audio\Soundtracks.
 * Tracks under a root store their path relative to it, so moving the folder
 * means changing one row.
 */
import { ValidationError } from "../errors";
import { isAbsolutePath, joinRoot } from "../paths";
import type { Store } from "../store";
import type { LibraryRoot } from "../types";
import * as v from "../validate";
import { newId, patchOf, requireRow, unique } from "./common";

type RootRow = { id: string; name: string; path: string; created_at: number };

const toRoot = (row: RootRow): LibraryRoot => ({ id: row.id, name: row.name, path: row.path, createdAt: row.created_at });

function absoluteFolder(value: unknown): string {
  const folder = v.requiredName("path", value, v.MAX_TEXT_LENGTH);
  if (!isAbsolutePath(folder)) throw new ValidationError("path", "The folder must be a full path, such as H:\\Audio.");
  return folder;
}

export function addRoot(store: Store, input: { id?: string; name: string; path: string }): LibraryRoot {
  const id = newId(input.id);
  const name = v.requiredName("name", input.name);
  const folder = absoluteFolder(input.path);
  store.change(`Add library folder "${name}"`, () =>
    unique("name", `A library folder called "${name}"`, () =>
      store.run("INSERT INTO library_roots (id, name, path, created_at) VALUES (?, ?, ?, ?)", id, name, folder, store.now()),
    ),
  );
  return getRoot(store, id) as LibraryRoot;
}

export function getRoot(store: Store, id: string): LibraryRoot | null {
  const row = store.get<RootRow>("SELECT * FROM library_roots WHERE id = ?", id);
  return row ? toRoot(row) : null;
}

export function listRoots(store: Store): LibraryRoot[] {
  return store.all<RootRow>("SELECT * FROM library_roots ORDER BY name COLLATE NOCASE").map(toRoot);
}

/** Renames a root or points it at its new folder (every track under it follows). */
export function updateRoot(store: Store, id: string, changes: { name?: string; path?: string }): LibraryRoot {
  const patch = patchOf(changes, ["name", "path"]);
  const rootId = requireRow(store, "library_roots", "library folder", id);
  const name = patch.name === undefined ? undefined : v.requiredName("name", patch.name);
  const folder = patch.path === undefined ? undefined : absoluteFolder(patch.path);
  store.change("Change library folder", () =>
    unique("name", `A library folder called "${name}"`, () => {
      if (name !== undefined) store.run("UPDATE library_roots SET name = ? WHERE id = ?", name, rootId);
      if (folder !== undefined) store.run("UPDATE library_roots SET path = ? WHERE id = ?", folder, rootId);
    }),
  );
  return getRoot(store, rootId) as LibraryRoot;
}

/** Removes a root; its tracks keep working with their full paths. */
export function removeRoot(store: Store, id: string): void {
  const root = getRoot(store, requireRow(store, "library_roots", "library folder", id)) as LibraryRoot;
  store.change(`Remove library folder "${root.name}"`, () => {
    const tracks = store.all<{ id: string; path: string }>("SELECT id, path FROM tracks WHERE root_id = ?", root.id);
    for (const track of tracks) {
      store.run("UPDATE tracks SET root_id = NULL, path = ? WHERE id = ?", joinRoot(root.path, track.path), track.id);
    }
    store.run("DELETE FROM library_roots WHERE id = ?", root.id);
  });
}
