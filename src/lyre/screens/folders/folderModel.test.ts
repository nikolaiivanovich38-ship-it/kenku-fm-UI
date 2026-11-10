import { describe, expect, it } from "vitest";
import type { FolderInfo } from "../../../common/lyre/api";
import { folderTree } from "./folderModel";

const folders: FolderInfo[] = [
  { id: "crown", kind: "playlists", name: "Sunken Crown", parentId: null, color: null },
  { id: "villains", kind: "playlists", name: "Villains", parentId: "crown", color: null },
  { id: "travel", kind: "playlists", name: "Travel", parentId: null, color: null },
];
const items = [
  { id: "ashen", folderId: "villains" },
  { id: "abbess", folderId: "crown" },
  { id: "coast", folderId: null },
  { id: "lost", folderId: "gone" },
];

describe("folders for playlists and boards (r7org.js inFolders)", () => {
  it("draws each level's folders, then its items; a folder counts what it holds at every depth", () => {
    const tree = folderTree(folders, items, items, false);
    expect(tree.folders.map((n) => [n.folder.name, n.total])).toEqual([
      ["Sunken Crown", 2],
      ["Travel", 0],
    ]);
    expect(tree.folders[0].folders.map((n) => n.folder.name)).toEqual(["Villains"]);
    expect(tree.folders[0].folders[0].items.map((x) => x.id)).toEqual(["ashen"]);
    expect(tree.folders[0].items.map((x) => x.id)).toEqual(["abbess"]);
    // An item whose folder is gone shows at the top.
    expect(tree.items.map((x) => x.id)).toEqual(["coast", "lost"]);
  });

  it("with a filter on, only folders holding something shown appear", () => {
    const tree = folderTree(folders, items, [items[0]], true);
    expect(tree.folders.map((n) => n.folder.name)).toEqual(["Sunken Crown"]);
    expect(tree.folders[0].folders[0].items.map((x) => x.id)).toEqual(["ashen"]);
    expect(tree.items).toEqual([]);
  });
});
