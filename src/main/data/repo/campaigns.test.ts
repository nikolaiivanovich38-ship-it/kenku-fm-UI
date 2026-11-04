import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "../errors";
import { makeTestStore } from "../test/testStore";
import { createTracks } from "./tracks";
import { createPlaylist, deletePlaylist, getPlaylist, listPlaylists } from "./playlists";
import { createBoard, listBoards } from "./boards";
import {
  addSceneItems,
  addToCampaign,
  campaignsOf,
  createCampaign,
  createScene,
  createSession,
  deleteCampaign,
  deleteScene,
  deleteSession,
  getCampaign,
  getScene,
  getSession,
  listCampaigns,
  listSceneItems,
  listScenes,
  listSessions,
  moveCampaign,
  moveScene,
  moveSceneItem,
  moveSession,
  removeFromCampaign,
  removeSceneItems,
  updateCampaign,
  updateScene,
  updateSession,
} from "./campaigns";

let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  t = makeTestStore();
});
afterEach(() => t.close());

describe("campaigns, sessions and scenes (ORG-7)", () => {
  it("holds sessions in a campaign and scenes in a session, each in order", () => {
    const strahd = createCampaign(t.store, { name: "Curse of Strahd", color: "#550000", notes: "Gothic horror" });
    const s1 = createSession(t.store, { campaignId: strahd.id, name: "Session 1", playedOn: "2026-11-07" });
    const s2 = createSession(t.store, { campaignId: strahd.id, name: "Session 2" });
    const s0 = createSession(t.store, { campaignId: strahd.id, name: "Session 0", placement: "start" });
    const arrival = createScene(t.store, { sessionId: s1.id, name: "Arrival in Barovia" });
    const tavern = createScene(t.store, { sessionId: s1.id, name: "Blood of the Vine" });
    moveScene(t.store, tavern.id, { placement: "start" });
    expect(listSessions(t.store, strahd.id).map((s) => s.name)).toEqual(["Session 0", "Session 1", "Session 2"]);
    expect(listScenes(t.store, s1.id).map((s) => s.name)).toEqual(["Blood of the Vine", "Arrival in Barovia"]);
    expect(getSession(t.store, s1.id)).toMatchObject({ playedOn: "2026-11-07", campaignId: strahd.id });
    expect(getCampaign(t.store, strahd.id)).toMatchObject({ color: "#550000", notes: "Gothic horror" });
    expect(s0.position).toBeLessThan(s1.position);
    expect(s2.position).toBeGreaterThan(s1.position);
    expect(arrival.sessionId).toBe(s1.id);
    expect(() => createSession(t.store, { campaignId: strahd.id, name: "x", playedOn: "7/11/2026" })).toThrow(
      ValidationError,
    );
    expect(() => createScene(t.store, { sessionId: "missing", name: "x" })).toThrow(/No session/);
  });

  it("updates, reorders and moves sessions and scenes between parents", () => {
    const a = createCampaign(t.store, { name: "A" });
    const b = createCampaign(t.store, { name: "B" });
    moveCampaign(t.store, b.id, "start");
    expect(listCampaigns(t.store).map((c) => c.name)).toEqual(["B", "A"]);
    updateCampaign(t.store, a.id, { name: "Alpha", notes: "n" });
    const s = createSession(t.store, { campaignId: a.id, name: "S" });
    const s2 = createSession(t.store, { campaignId: b.id, name: "S2" });
    updateSession(t.store, s.id, { name: "Session one", notes: "x", playedOn: null });
    moveSession(t.store, s.id, { campaignId: b.id, placement: "end" });
    expect(listSessions(t.store, b.id).map((x) => x.name)).toEqual(["S2", "Session one"]);
    const scene = createScene(t.store, { sessionId: s.id, name: "Docks" });
    updateScene(t.store, scene.id, { name: "Night docks", notes: "fog" });
    moveScene(t.store, scene.id, { sessionId: s2.id, placement: "end" });
    expect(getScene(t.store, scene.id)).toMatchObject({ sessionId: s2.id, name: "Night docks", notes: "fog" });
  });

  it("lets playlists and boards belong to several campaigns, and filters by campaign", () => {
    const strahd = createCampaign(t.store, { name: "Strahd" });
    const witcher = createCampaign(t.store, { name: "Witcher" });
    const tavern = createPlaylist(t.store, { title: "Tavern" });
    const battle = createPlaylist(t.store, { title: "Battle" });
    const weather = createBoard(t.store, { title: "Weather" });
    addToCampaign(t.store, strahd.id, { playlistIds: [tavern.id, battle.id], boardIds: [weather.id] });
    addToCampaign(t.store, witcher.id, { playlistIds: [tavern.id] });
    addToCampaign(t.store, witcher.id, { playlistIds: [tavern.id] }); // twice is fine
    expect(listPlaylists(t.store, { campaignId: witcher.id }).map((p) => p.title)).toEqual(["Tavern"]);
    expect(listPlaylists(t.store, { campaignId: strahd.id }).map((p) => p.title)).toEqual(["Tavern", "Battle"]);
    expect(listBoards(t.store, { campaignId: strahd.id }).map((b) => b.title)).toEqual(["Weather"]);
    expect(campaignsOf(t.store, { playlistId: tavern.id }).map((c) => c.name)).toEqual(["Strahd", "Witcher"]);
    removeFromCampaign(t.store, strahd.id, { playlistIds: [tavern.id] });
    expect(campaignsOf(t.store, { playlistId: tavern.id }).map((c) => c.name)).toEqual(["Witcher"]);
    // The library-wide view is the unfiltered list.
    expect(listPlaylists(t.store)).toHaveLength(2);
  });

  it("deleting a campaign removes its sessions and scenes but not the shared playlists", () => {
    const c = createCampaign(t.store, { name: "C" });
    const p = createPlaylist(t.store, { title: "Tavern" });
    addToCampaign(t.store, c.id, { playlistIds: [p.id] });
    const s = createSession(t.store, { campaignId: c.id, name: "S" });
    const scene = createScene(t.store, { sessionId: s.id, name: "Sc" });
    deleteCampaign(t.store, c.id);
    expect(getSession(t.store, s.id)).toBeNull();
    expect(getScene(t.store, scene.id)).toBeNull();
    expect(getPlaylist(t.store, p.id)).not.toBeNull();
  });

  it("prepares material for a scene: playlists, boards and single tracks, in order", () => {
    const c = createCampaign(t.store, { name: "C" });
    const s = createSession(t.store, { campaignId: c.id, name: "S" });
    const scene = createScene(t.store, { sessionId: s.id, name: "Docks" });
    const p = createPlaylist(t.store, { title: "Harbour" });
    const b = createBoard(t.store, { title: "Gulls" });
    const [track] = createTracks(t.store, [{ title: "Bell", file: { path: "/m/bell.mp3" } }]);
    const [ip, ib, it2] = addSceneItems(t.store, scene.id, [{ playlistId: p.id }, { boardId: b.id }, { trackId: track.id }]);
    moveSceneItem(t.store, it2.id, { before: ip.id });
    expect(listSceneItems(t.store, scene.id).map((item) => [item.kind, item.title])).toEqual([
      ["track", "Bell"],
      ["playlist", "Harbour"],
      ["board", "Gulls"],
    ]);
    removeSceneItems(t.store, [ib.id]);
    deletePlaylist(t.store, p.id);
    expect(listSceneItems(t.store, scene.id).map((item) => item.kind)).toEqual(["track"]);
    expect(() => addSceneItems(t.store, scene.id, [{} as never])).toThrow(ValidationError);
    expect(() => addSceneItems(t.store, scene.id, [{ playlistId: "missing" }])).toThrow(/No playlist/);
    deleteScene(t.store, scene.id);
    deleteSession(t.store, s.id);
    expect(listSessions(t.store, c.id)).toEqual([]);
  });
});
