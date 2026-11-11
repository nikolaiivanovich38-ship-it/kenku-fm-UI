import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "../errors";
import { makeTestStore } from "../test/testStore";
import { createFolder, deleteFolder, getFolder, listFolders, moveFolder, updateFolder } from "./folders";
import { createPlaylist, getPlaylist, listPlaylists, movePlaylist } from "./playlists";
import { createBoard, moveBoard } from "./boards";
import { createCampaign, createSession, getSession, moveSession } from "./campaigns";

let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  t = makeTestStore();
});
afterEach(() => t.close());

describe("folders (ORG-4)", () => {
  it("nests folders with a colour and a collapsed state", () => {
    const strahd = createFolder(t.store, { scope: "playlists", name: "Curse of Strahd", color: "Ember" });
    const vallaki = createFolder(t.store, { scope: "playlists", name: "Vallaki", parentId: strahd.id });
    const barovia = createFolder(t.store, {
      scope: "playlists",
      name: "Barovia",
      parentId: strahd.id,
      placement: { before: vallaki.id },
    });
    updateFolder(t.store, strahd.id, { collapsed: true });
    expect(getFolder(t.store, strahd.id)).toMatchObject({ color: "ember", collapsed: true, parentId: null });
    expect(listFolders(t.store, "playlists").map((f) => [f.name, f.parentId])).toEqual([
      ["Curse of Strahd", null],
      ["Barovia", strahd.id],
      ["Vallaki", strahd.id],
    ]);
    expect(barovia.parentId).toBe(strahd.id);
    expect(listFolders(t.store, "boards")).toEqual([]);
    expect(() => updateFolder(t.store, strahd.id, { color: "red" })).toThrow(ValidationError);
  });

  it("moves playlists, boards and sessions into folders of the right kind only", () => {
    const playlists = createFolder(t.store, { scope: "playlists", name: "Town" });
    const boards = createFolder(t.store, { scope: "boards", name: "Weather" });
    const sessions = createFolder(t.store, { scope: "sessions", name: "Act 1" });
    const p = createPlaylist(t.store, { title: "Tavern" });
    const b = createBoard(t.store, { title: "Rain" });
    const c = createCampaign(t.store, { name: "C" });
    const s = createSession(t.store, { campaignId: c.id, name: "S1" });
    movePlaylist(t.store, p.id, { folderId: playlists.id, placement: "end" });
    moveBoard(t.store, b.id, { folderId: boards.id, placement: "end" });
    moveSession(t.store, s.id, { folderId: sessions.id, placement: "end" });
    expect(listPlaylists(t.store, { folderId: playlists.id }).map((x) => x.title)).toEqual(["Tavern"]);
    expect(listPlaylists(t.store, { folderId: null })).toEqual([]);
    expect(getSession(t.store, s.id)!.folderId).toBe(sessions.id);
    expect(() => movePlaylist(t.store, p.id, { folderId: boards.id, placement: "end" })).toThrow(/holds boards/);
    expect(() => createPlaylist(t.store, { title: "x", folderId: sessions.id })).toThrow(/holds sessions/);
  });

  it("refuses to put a folder inside itself or its own subfolder", () => {
    const a = createFolder(t.store, { scope: "playlists", name: "A" });
    const b = createFolder(t.store, { scope: "playlists", name: "B", parentId: a.id });
    const c = createFolder(t.store, { scope: "playlists", name: "C", parentId: b.id });
    expect(() => moveFolder(t.store, a.id, { parentId: c.id, placement: "end" })).toThrow(/inside itself/);
    expect(() => moveFolder(t.store, a.id, { parentId: a.id, placement: "end" })).toThrow(/inside itself/);
    moveFolder(t.store, c.id, { parentId: null, placement: "start" });
    expect(listFolders(t.store, "playlists").map((f) => f.name)).toEqual(["C", "A", "B"]);
  });

  it("deleting a folder moves what it held up one level and deletes nothing else", () => {
    const outer = createFolder(t.store, { scope: "playlists", name: "Outer" });
    const inner = createFolder(t.store, { scope: "playlists", name: "Inner", parentId: outer.id });
    const deep = createFolder(t.store, { scope: "playlists", name: "Deep", parentId: inner.id });
    const p = createPlaylist(t.store, { title: "Tavern", folderId: inner.id });
    deleteFolder(t.store, inner.id);
    expect(getFolder(t.store, inner.id)).toBeNull();
    expect(getFolder(t.store, deep.id)!.parentId).toBe(outer.id);
    expect(getPlaylist(t.store, p.id)!.folderId).toBe(outer.id);
  });
});
