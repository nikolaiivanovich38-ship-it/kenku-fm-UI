import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "../errors";
import { makeTestStore } from "../test/testStore";
import { createTracks, deleteTracks } from "./tracks";
import { createPlaylist, deletePlaylist, getPlaylist, listPlaylists } from "./playlists";
import { createBoard, deleteBoard, listBoards } from "./boards";
import {
  addSceneBoards,
  addSceneMusic,
  addToCampaign,
  addToSession,
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
  listSceneBoards,
  listSceneMusic,
  listScenes,
  listSessionMembers,
  listCampaignMembers,
  listSessions,
  moveCampaign,
  moveInCampaign,
  moveInSession,
  moveScene,
  moveSceneBoard,
  moveSceneMusic,
  moveSession,
  removeFromCampaign,
  removeFromSession,
  removeSceneBoards,
  removeSceneMusic,
  setBoardUses,
  setPlaylistUses,
  setSceneAmbience,
  updateCampaign,
  updateScene,
  updateSession,
} from "./campaigns";
import { getDomainCampaign } from "./domain";

let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  t = makeTestStore();
});
afterEach(() => t.close());

/** A campaign with one session and one scene. */
function sample() {
  const campaign = createCampaign(t.store, { name: "The Sunken Crown" });
  const session = createSession(t.store, { campaignId: campaign.id, name: "The Drowned Abbey" });
  const scene = createScene(t.store, { sessionId: session.id, name: "The abbey ruins" });
  return { campaign, session, scene };
}

describe("campaigns, sessions and scenes (ORG-7)", () => {
  it("holds sessions in a campaign and scenes in a session, each in order", () => {
    const strahd = createCampaign(t.store, { name: "Curse of Strahd", color: "#550000", notes: "Gothic horror" });
    const s1 = createSession(t.store, { campaignId: strahd.id, name: "Session 1", date: "2026-11-07" });
    const s2 = createSession(t.store, { campaignId: strahd.id, name: "Session 2" });
    const s0 = createSession(t.store, { campaignId: strahd.id, name: "Session 0", placement: "start" });
    const arrival = createScene(t.store, { sessionId: s1.id, name: "Arrival in Barovia" });
    const tavern = createScene(t.store, { sessionId: s1.id, name: "Blood of the Vine" });
    moveScene(t.store, tavern.id, { placement: "start" });
    expect(listSessions(t.store, strahd.id).map((s) => s.name)).toEqual(["Session 0", "Session 1", "Session 2"]);
    expect(listScenes(t.store, s1.id).map((s) => s.name)).toEqual(["Blood of the Vine", "Arrival in Barovia"]);
    expect(getSession(t.store, s1.id)).toMatchObject({ date: "2026-11-07", campaignId: strahd.id });
    expect(getCampaign(t.store, strahd.id)).toMatchObject({ color: "#550000", notes: "Gothic horror" });
    expect(s0.position).toBeLessThan(s1.position);
    expect(s2.position).toBeGreaterThan(s1.position);
    expect(arrival.sessionId).toBe(s1.id);
    expect(() => createSession(t.store, { campaignId: strahd.id, name: "x", date: "7/11/2026" })).toThrow(ValidationError);
    expect(() => createScene(t.store, { sessionId: "missing", name: "x" })).toThrow(/No session/);
  });

  it("keeps a campaign's theme, system, description and Obsidian fields (default theme: candle)", () => {
    const plain = createCampaign(t.store, { name: "Plain" });
    expect(plain).toMatchObject({ theme: "candle", system: "", description: "", obsidian: { vault: "", note: "", sessionsFolder: "" } });
    const crown = createCampaign(t.store, {
      name: "The Sunken Crown",
      theme: "hearth",
      system: "D&D 5e",
      description: "A drowned kingdom.",
      obsidian: { vault: "Tabletop", note: "Campaigns/Crown.md", sessionsFolder: "Campaigns/Crown/Sessions" },
    });
    expect(crown).toMatchObject({ theme: "hearth", system: "D&D 5e", obsidian: { vault: "Tabletop" } });
    expect(updateCampaign(t.store, crown.id, { theme: "elysium", obsidian: { note: "" } })).toMatchObject({
      theme: "elysium",
      obsidian: { vault: "Tabletop", note: "", sessionsFolder: "Campaigns/Crown/Sessions" },
    });
    expect(() => updateCampaign(t.store, crown.id, { theme: "neon" as never })).toThrow(ValidationError);
  });

  it("numbers sessions, lets a session have no name, and keeps at most one next session", () => {
    const c = createCampaign(t.store, { name: "C" });
    const first = createSession(t.store, { campaignId: c.id });
    const second = createSession(t.store, { campaignId: c.id, name: "Black sails" });
    const third = createSession(t.store, { campaignId: c.id, number: 14, noteLink: "Sessions/14.md" });
    // The first session is next; later ones are drafts (as in the prototype).
    expect([first, second, third].map((s) => [s.number, s.name, s.status])).toEqual([
      [1, "", "next"],
      [2, "Black sails", "draft"],
      [14, "", "draft"],
    ]);
    expect(third.noteLink).toBe("Sessions/14.md");
    // Making a later session next marks the old next one played; an earlier one would become a draft.
    updateSession(t.store, third.id, { status: "next" });
    expect(listSessions(t.store, c.id).map((s) => s.status)).toEqual(["played", "draft", "next"]);
    updateSession(t.store, second.id, { status: "next" });
    expect(listSessions(t.store, c.id).map((s) => s.status)).toEqual(["played", "next", "draft"]);
    expect(() => updateSession(t.store, first.id, { status: "done" as never })).toThrow(ValidationError);
    // Moving a next session into a campaign that has one makes it a draft.
    const other = createCampaign(t.store, { name: "Other" });
    createSession(t.store, { campaignId: other.id, status: "next" });
    expect(moveSession(t.store, second.id, { campaignId: other.id, placement: "end" }).status).toBe("draft");
  });

  it("updates, reorders and moves sessions and scenes between parents", () => {
    const a = createCampaign(t.store, { name: "A" });
    const b = createCampaign(t.store, { name: "B" });
    moveCampaign(t.store, b.id, "start");
    expect(listCampaigns(t.store).map((c) => c.name)).toEqual(["B", "A"]);
    updateCampaign(t.store, a.id, { name: "Alpha", notes: "n" });
    const s = createSession(t.store, { campaignId: a.id, name: "S" });
    const s2 = createSession(t.store, { campaignId: b.id, name: "S2" });
    updateSession(t.store, s.id, { name: "Session one", notes: "x", date: null, number: 7 });
    expect(getSession(t.store, s.id)).toMatchObject({ name: "Session one", number: 7, date: null });
    moveSession(t.store, s.id, { campaignId: b.id, placement: "end" });
    expect(listSessions(t.store, b.id).map((x) => x.name)).toEqual(["S2", "Session one"]);
    const scene = createScene(t.store, { sessionId: s.id, name: "Docks" });
    updateScene(t.store, scene.id, { name: "Night docks", notes: "fog", startsWhen: "They reach the pier", noteLink: "Docks.md" });
    moveScene(t.store, scene.id, { sessionId: s2.id, placement: "end" });
    expect(getScene(t.store, scene.id)).toMatchObject({
      sessionId: s2.id,
      name: "Night docks",
      notes: "fog",
      startsWhen: "They reach the pier",
      noteLink: "Docks.md",
      ambience: null,
    });
  });

  it("orders a campaign's and a session's playlists and boards", () => {
    const { campaign, session } = sample();
    const [tavern, battle, travel] = ["Tavern", "Battle", "Travel"].map((title) => createPlaylist(t.store, { title }));
    const [weather, combat] = ["Weather", "Combat"].map((title) => createBoard(t.store, { title }));
    addToCampaign(t.store, campaign.id, { playlistIds: [tavern.id, battle.id], boardIds: [weather.id] });
    addToCampaign(t.store, campaign.id, { playlistIds: [travel.id, tavern.id], boardIds: [combat.id] }, "start"); // twice is fine
    expect(listCampaignMembers(t.store, campaign.id)).toEqual({ playlistIds: [travel.id, tavern.id, battle.id], boardIds: [combat.id, weather.id] });
    moveInCampaign(t.store, campaign.id, { playlistId: travel.id }, "end");
    expect(listCampaignMembers(t.store, campaign.id).playlistIds).toEqual([tavern.id, battle.id, travel.id]);
    expect(listPlaylists(t.store, { campaignId: campaign.id }).map((p) => p.title)).toEqual(["Tavern", "Battle", "Travel"]);
    expect(listBoards(t.store, { campaignId: campaign.id }).map((b) => b.title)).toEqual(["Combat", "Weather"]);
    removeFromCampaign(t.store, campaign.id, { playlistIds: [battle.id] });
    expect(campaignsOf(t.store, { playlistId: battle.id })).toEqual([]);

    addToSession(t.store, session.id, { playlistIds: [battle.id, travel.id], boardIds: [combat.id] });
    moveInSession(t.store, session.id, { playlistId: travel.id }, { before: battle.id });
    expect(listSessionMembers(t.store, session.id)).toEqual({ playlistIds: [travel.id, battle.id], boardIds: [combat.id] });
    removeFromSession(t.store, session.id, { boardIds: [combat.id] });
    expect(listSessionMembers(t.store, session.id).boardIds).toEqual([]);
    expect(() => addToSession(t.store, session.id, { playlistIds: ["missing"] })).toThrow(/No playlist/);
  });

  it("gives a scene an ordered music list mixing tracks and playlists, one ambience item and ordered boards", () => {
    const { campaign, session, scene } = sample();
    const [eerie, bells, rain] = createTracks(t.store, [
      { title: "Eerie bed", file: { path: "/m/eerie.flac" } },
      { title: "Drowned bells", file: { path: "/m/bells.flac" } },
      { kind: "amb", title: "Rain", file: { path: "/a/rain.wav" } },
    ]);
    const abbess = createPlaylist(t.store, { title: "The Abbess" });
    const abbeyAmb = createPlaylist(t.store, { title: "Abbey ambience", lane: "amb" });
    const [abbey, weather] = ["Drowned Abbey", "Weather"].map((title) => createBoard(t.store, { title }));

    const [m1, m2, m3] = addSceneMusic(t.store, scene.id, [
      { kind: "track", id: eerie.id },
      { kind: "playlist", id: abbess.id },
      { kind: "track", id: bells.id },
    ]);
    addSceneMusic(t.store, scene.id, [{ kind: "track", id: eerie.id }], { after: m1.id }); // a track may come twice
    moveSceneMusic(t.store, [m3.id], "start");
    expect(listSceneMusic(t.store, scene.id).map((m) => [m.ref.kind, m.title])).toEqual([
      ["track", "Drowned bells"],
      ["track", "Eerie bed"],
      ["track", "Eerie bed"],
      ["playlist", "The Abbess"],
    ]);
    removeSceneMusic(t.store, [m2.id]);

    setSceneAmbience(t.store, scene.id, { kind: "playlist", id: abbeyAmb.id });
    expect(getScene(t.store, scene.id)!.ambience).toEqual({ kind: "playlist", id: abbeyAmb.id });
    setSceneAmbience(t.store, scene.id, { kind: "track", id: rain.id });

    addSceneBoards(t.store, scene.id, [weather.id, abbey.id]);
    addSceneBoards(t.store, scene.id, [weather.id]); // already there: kept once
    moveSceneBoard(t.store, scene.id, abbey.id, "start");
    expect(listSceneBoards(t.store, scene.id)).toEqual([abbey.id, weather.id]);

    expect(getDomainCampaign(t.store, campaign.id)!.sessions[0].scenes[0]).toEqual({
      id: scene.id,
      name: "The abbey ruins",
      music: [
        { kind: "track", id: bells.id },
        { kind: "track", id: eerie.id },
        { kind: "track", id: eerie.id },
      ],
      ambience: { kind: "track", id: rain.id },
      boardIds: [abbey.id, weather.id],
    });
    expect(session.id).toBe(getDomainCampaign(t.store, campaign.id)!.sessions[0].id);

    // Deleting a track, playlist or board takes it out of scenes; the scene stays.
    deleteTracks(t.store, [rain.id, bells.id]);
    deleteBoard(t.store, abbey.id);
    expect(getScene(t.store, scene.id)!.ambience).toBeNull();
    expect(listSceneMusic(t.store, scene.id).map((m) => m.ref.id)).toEqual([eerie.id, eerie.id]);
    expect(listSceneBoards(t.store, scene.id)).toEqual([weather.id]);
    removeSceneBoards(t.store, scene.id, [weather.id]);
    setSceneAmbience(t.store, scene.id, null);
    expect(getScene(t.store, scene.id)!.ambience).toBeNull();

    expect(() => addSceneMusic(t.store, scene.id, [{ kind: "board", id: weather.id } as never])).toThrow(ValidationError);
    expect(() => addSceneMusic(t.store, scene.id, [{ kind: "playlist", id: "missing" }])).toThrow(/No playlist/);
  });

  it("sets where a playlist or board is used in one step, as the Use in… sheet does", () => {
    const { campaign, session, scene } = sample();
    const scene2 = createScene(t.store, { sessionId: session.id, name: "Crypt" });
    const music = createPlaylist(t.store, { title: "The Abbess" });
    const amb = createPlaylist(t.store, { title: "Abbey ambience", lane: "amb" });
    const board = createBoard(t.store, { title: "Abbey" });

    setPlaylistUses(t.store, music.id, [{ campaignId: campaign.id }, { sceneId: scene.id }]);
    setPlaylistUses(t.store, amb.id, [{ sessionId: session.id }, { sceneId: scene.id }, { sceneId: scene2.id }]);
    setBoardUses(t.store, board.id, [{ sceneId: scene2.id }]);
    let tree = getDomainCampaign(t.store, campaign.id)!;
    expect(tree.playlistIds).toEqual([music.id]);
    expect(tree.sessions[0].playlistIds).toEqual([amb.id]);
    expect(tree.sessions[0].scenes.map((s) => [s.music, s.ambience, s.boardIds])).toEqual([
      [[{ kind: "playlist", id: music.id }], { kind: "playlist", id: amb.id }, []],
      [[], { kind: "playlist", id: amb.id }, [board.id]],
    ]);

    // Unticking removes every use there; ticking again does not add twice.
    setPlaylistUses(t.store, music.id, [{ campaignId: campaign.id }]);
    setPlaylistUses(t.store, music.id, [{ campaignId: campaign.id }]);
    setPlaylistUses(t.store, amb.id, [{ sceneId: scene2.id }]);
    tree = getDomainCampaign(t.store, campaign.id)!;
    expect(tree.playlistIds).toEqual([music.id]);
    expect(tree.sessions[0].playlistIds).toEqual([]);
    expect(tree.sessions[0].scenes.map((s) => [s.music, s.ambience])).toEqual([
      [[], null],
      [[], { kind: "playlist", id: amb.id }],
    ]);
    expect(() => setBoardUses(t.store, board.id, [{ sceneId: "missing" }])).toThrow(/No scene/);
  });

  it("deleting a campaign removes its sessions and scenes but not the shared playlists", () => {
    const c = createCampaign(t.store, { name: "C" });
    const p = createPlaylist(t.store, { title: "Tavern" });
    addToCampaign(t.store, c.id, { playlistIds: [p.id] });
    const s = createSession(t.store, { campaignId: c.id, name: "S" });
    const scene = createScene(t.store, { sessionId: s.id, name: "Sc" });
    addSceneMusic(t.store, scene.id, [{ kind: "playlist", id: p.id }]);
    deleteCampaign(t.store, c.id);
    expect(getSession(t.store, s.id)).toBeNull();
    expect(getScene(t.store, scene.id)).toBeNull();
    expect(getPlaylist(t.store, p.id)).not.toBeNull();
    deletePlaylist(t.store, p.id);
    const c2 = sample();
    deleteScene(t.store, c2.scene.id);
    deleteSession(t.store, c2.session.id);
    expect(listSessions(t.store, c2.campaign.id)).toEqual([]);
  });
});
