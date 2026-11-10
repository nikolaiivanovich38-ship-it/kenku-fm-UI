/**
 * ORG-4 (design round 7, r7org.js L.inFolders): playlists and pad boards in folders. What a list shows: at each level
 * its folders (each with what it holds, at every depth) and then the items of that level, in the screen's own order.
 * With a search or a filter on, only folders that hold something shown appear, and they show open.
 */
import type { FolderInfo } from "../../../common/lyre/api";

export interface FolderNode<T> {
  folder: FolderInfo;
  /** Folders inside it, then its own items, as shown. */
  folders: FolderNode<T>[];
  items: T[];
  /** How many items it holds at every depth (shown or not): the folder row's count. */
  total: number;
}

export interface FolderLevel<T> {
  folders: FolderNode<T>[];
  items: T[];
}

/**
 * The tree to draw. `all`: every item (for the counts); `shown`: the items the screen shows now, in order;
 * `filtered`: a search or filter is on (folders holding nothing shown are left out).
 */
export function folderTree<T extends { id: string; folderId: string | null }>(folders: readonly FolderInfo[], all: readonly T[], shown: readonly T[], filtered: boolean): FolderLevel<T> {
  const known = new Set(folders.map((f) => f.id));
  const parentOf = (f: FolderInfo) => (f.parentId && known.has(f.parentId) ? f.parentId : null);
  const holderOf = (item: T) => (item.folderId && known.has(item.folderId) ? item.folderId : null);
  const inside = (folderId: string, of: string | null): boolean => {
    const seen = new Set<string>();
    for (let at = of; at; ) {
      if (at === folderId) return true;
      if (seen.has(at)) return false;
      seen.add(at);
      const f = folders.find((x) => x.id === at);
      at = f ? parentOf(f) : null;
    }
    return false;
  };
  const level = (parent: string | null, seen: Set<string>): FolderLevel<T> => {
    const nodes: FolderNode<T>[] = [];
    for (const f of folders) {
      if (parentOf(f) !== parent || seen.has(f.id)) continue;
      const below = level(f.id, new Set([...seen, f.id]));
      const total = all.filter((x) => inside(f.id, holderOf(x))).length;
      const holdsShown = shown.some((x) => inside(f.id, holderOf(x)));
      if (filtered && !holdsShown) continue;
      nodes.push({ folder: f, folders: below.folders, items: below.items, total });
    }
    return { folders: nodes, items: shown.filter((x) => holderOf(x) === parent) };
  };
  return level(null, new Set());
}
