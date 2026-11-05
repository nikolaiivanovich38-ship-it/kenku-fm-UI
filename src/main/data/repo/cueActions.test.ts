import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CueAction } from "../../../player/engine/queue/actions";
import { ValidationError } from "../errors";
import { makeTestStore } from "../test/testStore";
import { addPad, createBoard, deletePads } from "./boards";
import { createCampaign, createScene, createSession, deleteScene } from "./campaigns";
import { getHotkeyActions, listHotkeys, setHotkeyActions } from "./cueActions";
import { createPlaylist, deletePlaylist } from "./playlists";
import { createTracks, deleteTracks } from "./tracks";

let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  t = makeTestStore();
});
afterEach(() => t.close());

function world() {
  const [track] = createTracks(t.store, [{ title: "Thunder", file: { path: "/fx/thunder.wav" } }]);
  const playlist = createPlaylist(t.store, { title: "Storm" });
  const campaign = createCampaign(t.store, { name: "Strahd" });
  const session = createSession(t.store, { campaignId: campaign.id, name: "S1" });
  const scene = createScene(t.store, { sessionId: session.id, name: "Gates" });
  const board = createBoard(t.store, { title: "Fx" });
  const pad = addPad(t.store, board.id, { label: "Door" });
  const sceneRef = { campaignId: campaign.id, sessionId: session.id, sceneId: scene.id };
  return { track, playlist, scene, sceneRef, board, pad };
}

describe("cue actions on hotkeys (PLY-8, DB review 9)", () => {
  it("stores every kind of action a key can run, in order, and gives them back the same", () => {
    const w = world();
    const actions: CueAction[] = [
      { type: "playTrack", trackId: w.track.id, target: "all", when: "next", fadeMs: 2000, from: { playlistId: w.playlist.id } },
      { type: "playTrack", trackId: w.track.id, target: { room: "123456789012345678" }, from: { scene: w.sceneRef, at: 2 } },
      { type: "playPlaylist", playlistId: w.playlist.id, target: "all" },
      { type: "startScene", scene: w.sceneRef },
      { type: "next", lane: "music", target: "all", fadeMs: 3000 },
      { type: "previous", lane: "ambience", target: "all" },
      { type: "fadeLane", lane: "effects", target: { room: "1" } },
      { type: "fadeAll", fadeMs: 1500 },
      { type: "stopAll", target: "all" },
      { type: "firePad", boardId: w.board.id, padId: w.pad.id, target: "all", phase: "up" },
      { type: "undoSceneStart" },
    ];
    setHotkeyActions(t.store, "F1", actions);
    expect(getHotkeyActions(t.store, "f1")).toEqual(actions);
    setHotkeyActions(t.store, "ctrl+1", [{ type: "stopAll" }]);
    expect(listHotkeys(t.store)).toEqual(["ctrl+1", "f1"]);
    setHotkeyActions(t.store, "F1", []);
    expect(listHotkeys(t.store)).toEqual(["ctrl+1"]);
  });

  it("refuses actions that cannot be kept on a key, or that name things that are not there", () => {
    const w = world();
    const bad: unknown[] = [
      { type: "removeQueued", entryId: "e1", target: "all" },
      { type: "teleport" },
      { type: "playTrack", trackId: w.track.id },
      { type: "fadeAll", fadeMs: -1 },
    ];
    for (const action of bad) expect(() => setHotkeyActions(t.store, "f2", [action as CueAction]), JSON.stringify(action)).toThrow(ValidationError);
    expect(() => setHotkeyActions(t.store, "f2", [{ type: "playTrack", trackId: "missing", target: "all" }])).toThrow(/No track/);
    expect(() => setHotkeyActions(t.store, "f2", [{ type: "startScene", scene: { ...w.sceneRef, sessionId: "other" } }])).toThrow(ValidationError);
    expect(() => setHotkeyActions(t.store, "f2", [{ type: "firePad", boardId: "other", padId: w.pad.id, target: "all" }])).toThrow(/No pad/);
    expect(() => setHotkeyActions(t.store, " ", [])).toThrow(ValidationError);
    expect(listHotkeys(t.store)).toEqual([]);
  });

  it("drops an action when what it plays is deleted, and forgets a place a track was picked from", async () => {
    const w = world();
    setHotkeyActions(t.store, "f3", [
      { type: "playTrack", trackId: w.track.id, target: "all", from: { playlistId: w.playlist.id } },
      { type: "playPlaylist", playlistId: w.playlist.id, target: "all" },
      { type: "startScene", scene: w.sceneRef },
      { type: "firePad", boardId: w.board.id, padId: w.pad.id, target: "all" },
    ]);
    deletePlaylist(t.store, w.playlist.id);
    expect(getHotkeyActions(t.store, "f3").map((a) => a.type)).toEqual(["playTrack", "startScene", "firePad"]);
    expect(getHotkeyActions(t.store, "f3")[0]).toEqual({ type: "playTrack", trackId: w.track.id, target: "all" });
    deleteScene(t.store, w.scene.id);
    deletePads(t.store, [w.pad.id]);
    await deleteTracks(t.store, [w.track.id]);
    expect(getHotkeyActions(t.store, "f3")).toEqual([]);
  });
});
