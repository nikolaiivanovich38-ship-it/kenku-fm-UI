/**
 * Library roots (DAT-8): named folders such as "Soundtracks" = H:\Audio\Soundtracks.
 * Tracks under a root store their path relative to it, so moving the folder
 * means changing one row.
 */
import { ValidationError } from "../errors";
import { isAbsolutePath, joinRoot, normalizePath, relativeToRoot, unsafeFolderReason } from "../paths";
import type { Store } from "../store";
import type { LibraryRoot } from "../types";
import * as v from "../validate";
import { newId, patchOf, requireRow, toFlag, unique } from "./common";

type RootRow = { id: string; name: string; path: string; watched: number; created_at: number };

const toRoot = (row: RootRow): LibraryRoot => ({ id: row.id, name: row.name, path: row.path, watched: row.watched === 1, createdAt: row.created_at });

function absoluteFolder(value: unknown): string {
  const folder = v.requiredName("path", value, v.MAX_TEXT_LENGTH);
  if (!isAbsolutePath(folder)) throw new ValidationError("path", "The folder must be a full path, such as H:\\Audio.");
  // Security review 5: never a whole drive, a system or profile folder, or a \\server share.
  const unsafe = unsafeFolderReason(folder);
  if (unsafe) throw new ValidationError("path", unsafe);
  // Stored one way, as track paths are: no "." parts, no separator at the end (except a drive's own).
  const normal = normalizePath(folder);
  return normal.length > 3 ? normal.replace(/[\\/]+$/, "") : normal;
}

/**
 * Adds a library folder. Tracks already inside it are taken in (their paths
 * become relative to it), in batches when there are many (DB review 1 and 4);
 * await the result.
 */
export function addRoot(store: Store, input: { id?: string; name: string; path: string; watched?: boolean }): Promise<LibraryRoot> {
  const id = newId(input.id);
  const name = v.requiredName("name", input.name);
  const folder = absoluteFolder(input.path);
  const watched = toFlag(input.watched === undefined ? false : v.boolean("watched", input.watched));
  let added = false;
  return store
    .changeInBatches(`Add library folder "${name}"`, tracksTakenIn(store, { id, path: folder }), (batch) => {
      if (!added) {
        unique("name", `A library folder called "${name}"`, () =>
          store.run("INSERT INTO library_roots (id, name, path, watched, created_at) VALUES (?, ?, ?, ?, ?)", id, name, folder, watched, store.now()),
        );
        added = true;
      }
      for (const move of batch) store.run("UPDATE tracks SET root_id = ?, path = ? WHERE id = ?", id, move.relative, move.id);
    })
    .then(() => getRoot(store, id) as LibraryRoot);
}

/**
 * Tracks already in the library whose files lie inside a new library folder,
 * with their paths relative to it (DB review 4): a file outside every folder,
 * or under a folder that holds the new one (the deepest folder wins, as for a
 * new file). Without this, the same file could be added again under the folder.
 */
function tracksTakenIn(store: Store, root: { id: string; path: string }): { id: string; relative: string }[] {
  const roots = [...store.all<{ id: string; path: string }>("SELECT id, path FROM library_roots"), root];
  const rootPath = new Map(roots.map((r) => [r.id, r.path]));
  // Compared loosely (letter case ignored, either slash), as Windows does. Only a path that starts
  // like the new folder can be inside it, only an existing folder that holds the new one can give it
  // tracks, and a folder inside the new one keeps its own.
  const loose = (p: string) => p.toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");
  const prefix = loose(root.path);
  const holds = new Set(roots.filter((r) => r.id !== root.id && prefix.startsWith(`${loose(r.path)}/`)).map((r) => r.id));
  const deeper = roots.filter((r) => r.id !== root.id && loose(r.path).startsWith(`${prefix}/`)).map((r) => `${loose(r.path)}/`);
  const moves: { id: string; relative: string }[] = [];
  for (const track of store.all<{ id: string; root_id: string | null; path: string }>(
    "SELECT id, root_id, path FROM tracks WHERE path IS NOT NULL",
  )) {
    if (track.root_id !== null && !holds.has(track.root_id)) continue;
    const full = track.root_id === null ? track.path : joinRoot(rootPath.get(track.root_id) as string, track.path);
    const lowered = loose(full);
    if (!lowered.startsWith(`${prefix}/`) || deeper.some((d) => lowered.startsWith(d))) continue;
    // Stored paths are normalised (no "." parts), so the part after the folder is the relative path;
    // a name whose length changes in lower case is left to the full path rules.
    const relative = lowered.length === full.length ? full.slice(prefix.length + 1).replace(/\\/g, "/") : relativeToRoot(root.path, full);
    if (relative) moves.push({ id: track.id, relative });
  }
  return moves;
}

export function getRoot(store: Store, id: string): LibraryRoot | null {
  const row = store.get<RootRow>("SELECT * FROM library_roots WHERE id = ?", id);
  return row ? toRoot(row) : null;
}

export function listRoots(store: Store): LibraryRoot[] {
  return store.all<RootRow>("SELECT * FROM library_roots ORDER BY name COLLATE NOCASE").map(toRoot);
}

/** Renames a root or points it at its new folder (every track under it follows). */
export function updateRoot(store: Store, id: string, changes: { name?: string; path?: string; watched?: boolean }): LibraryRoot {
  const patch = patchOf(changes, ["name", "path", "watched"]);
  const watched = patch.watched === undefined ? undefined : toFlag(v.boolean("watched", patch.watched));
  const rootId = requireRow(store, "library_roots", "library folder", id);
  const name = patch.name === undefined ? undefined : v.requiredName("name", patch.name);
  const folder = patch.path === undefined ? undefined : absoluteFolder(patch.path);
  store.change("Change library folder", () =>
    unique("name", `A library folder called "${name}"`, () => {
      if (name !== undefined) store.run("UPDATE library_roots SET name = ? WHERE id = ?", name, rootId);
      if (folder !== undefined) store.run("UPDATE library_roots SET path = ? WHERE id = ?", folder, rootId);
      if (watched !== undefined) store.run("UPDATE library_roots SET watched = ? WHERE id = ?", watched, rootId);
    }),
  );
  return getRoot(store, rootId) as LibraryRoot;
}

/** Removes a root; its tracks keep working with their full paths (in batches when there are many; await the result). */
export function removeRoot(store: Store, id: string): Promise<void> {
  const root = getRoot(store, requireRow(store, "library_roots", "library folder", id)) as LibraryRoot;
  const tracks = store.all<{ id: string; path: string }>(TRACKS_UNDER_ROOT_SQL, root.id);
  return store.changeInBatches(`Remove library folder "${root.name}"`, tracks, (batch, last) => {
    for (const track of batch) {
      store.run("UPDATE tracks SET root_id = NULL, path = ? WHERE id = ?", joinRoot(root.path, track.path), track.id);
    }
    if (last) store.run("DELETE FROM library_roots WHERE id = ?", root.id);
  });
}

/** Every track under a library folder, through tracks_root_path (as TRACK_BY_PATH_SQL.underRoot in tracks.ts). */
const TRACKS_UNDER_ROOT_SQL = "SELECT id, path FROM tracks WHERE root_id = ?";
