/**
 * Design round 6 in the library (schema version 5): Repeat one per scene and track (PLY-17) and a playlist's track
 * order per place (ORG-13). Each write is checked for its refusals here and for undo in undo.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "../errors";
import { makeTestStore } from "../test/testStore";
import { UndoHistory } from "../undo";
import { createCampaign, createScene, createSession, deleteScene } from "./campaigns";
import { addTracksToPlaylist, createPlaylist, deletePlaylist } from "./playlists";
import { clearTrackOrder, getRepeatOnes, getTrackOrder, getTrackOrders, sceneRepeatOnes, setRepeatOne, setTrackOrder } from "./round6";
import { createTracks, deleteTracks } from "./tracks";

let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  t = makeTestStore();
});
afterEach(() => t.close());

function sample() {
  const [a, b, c, d] = createTracks(t.store, ["A", "B", "C", "D"].map((title, i) => ({ title, file: { path: `/m/${title}.flac`, size: i + 1, mtimeMs: 1 } })));
  const playlist = createPlaylist(t.store, { title: "Abbey" });
  addTracksToPlaylist(t.store, playlist.id, [a.id, b.id, c.id]);
  const campaign = createCampaign(t.store, { name: "Crown" });
  const session = createSession(t.store, { campaignId: campaign.id, name: "Abbey" });
  const scene = createScene(t.store, { sessionId: session.id, name: "Ruins" });
  const other = createScene(t.store, { sessionId: session.id, name: "Crypt" });
  const inScene = { kind: "scene" as const, campaignId: campaign.id, sessionId: session.id, sceneId: scene.id };
  const inSession = { kind: "session" as const, campaignId: campaign.id, sessionId: session.id };
  const inCampaign = { kind: "campaign" as const, campaignId: campaign.id };
  const sceneKey = `sc:${campaign.id}:${session.id}:${scene.id}`;
  return { a, b, c, d, playlist, campaign, session, scene, other, inScene, inSession, inCampaign, sceneKey };
}

describe("PLY-17 Repeat one per scene and track", () => {
  it("is on or off for a track in one scene, read back by scene key and for one scene", () => {
    const s = sample();
    setRepeatOne(t.store, s.scene.id, s.a.id, true);
    setRepeatOne(t.store, s.scene.id, s.c.id, true);
    setRepeatOne(t.store, s.other.id, s.a.id, true);
    expect(getRepeatOnes(t.store)).toEqual({
      [s.sceneKey]: [s.a.id, s.c.id].sort(),
      [`sc:${s.campaign.id}:${s.session.id}:${s.other.id}`]: [s.a.id],
    });
    expect(sceneRepeatOnes(t.store, s.scene.id)).toEqual([s.a.id, s.c.id].sort());
    setRepeatOne(t.store, s.scene.id, s.a.id, false);
    expect(sceneRepeatOnes(t.store, s.scene.id)).toEqual([s.c.id]);
  });

  it("makes one undo step per change, none when it is already so, and goes with the scene or the track", () => {
    const s = sample();
    const undo = new UndoHistory(t.store);
    setRepeatOne(t.store, s.scene.id, s.a.id, true);
    expect(undo.state().undoLabel).toBe('Repeat one in the scene "Ruins"');
    const steps = undo.recorded;
    setRepeatOne(t.store, s.scene.id, s.a.id, true);
    setRepeatOne(t.store, s.scene.id, s.b.id, false);
    expect(undo.recorded).toBe(steps);
    setRepeatOne(t.store, s.scene.id, s.a.id, false);
    expect(undo.state().undoLabel).toBe('Stop repeating one in the scene "Ruins"');
    setRepeatOne(t.store, s.scene.id, s.b.id, true);
    setRepeatOne(t.store, s.other.id, s.c.id, true);
    deleteScene(t.store, s.other.id);
    expect(Object.keys(getRepeatOnes(t.store))).toEqual([s.sceneKey]);
    return deleteTracks(t.store, [s.b.id]).then(() => expect(getRepeatOnes(t.store)).toEqual({}));
  });

  it("refuses an unknown scene or track and a choice that is not on or off", () => {
    const s = sample();
    expect(() => setRepeatOne(t.store, "nope", s.a.id, true)).toThrow(NotFoundError);
    expect(() => setRepeatOne(t.store, s.scene.id, "nope", true)).toThrow(NotFoundError);
    expect(() => setRepeatOne(t.store, s.scene.id, s.a.id, "yes" as unknown as boolean)).toThrow(ValidationError);
  });
});

describe("ORG-13 a playlist's track order per place", () => {
  it("keeps an order in a scene, a session's list and a campaign's list, each only there", () => {
    const s = sample();
    expect(getTrackOrder(t.store, s.playlist.id, s.inScene)).toBeNull();
    setTrackOrder(t.store, s.playlist.id, s.inScene, [s.c.id, s.a.id, s.b.id]);
    setTrackOrder(t.store, s.playlist.id, s.inSession, [s.b.id, s.a.id, s.c.id]);
    setTrackOrder(t.store, s.playlist.id, s.inCampaign, [s.a.id, s.c.id, s.b.id]);
    expect(getTrackOrder(t.store, s.playlist.id, s.inScene)).toEqual([s.c.id, s.a.id, s.b.id]);
    expect(getTrackOrders(t.store)).toEqual({
      [s.sceneKey]: { [s.playlist.id]: [s.c.id, s.a.id, s.b.id] },
      [`ss:${s.campaign.id}:${s.session.id}`]: { [s.playlist.id]: [s.b.id, s.a.id, s.c.id] },
      [`cp:${s.campaign.id}`]: { [s.playlist.id]: [s.a.id, s.c.id, s.b.id] },
    });
  });

  it("names only the playlist's tracks, each once, the rest after; the playlist's own order is no order (Back to the playlist's order)", () => {
    const s = sample();
    setTrackOrder(t.store, s.playlist.id, s.inScene, [s.c.id, s.d.id, s.c.id]);
    expect(getTrackOrder(t.store, s.playlist.id, s.inScene)).toEqual([s.c.id, s.a.id, s.b.id]);
    setTrackOrder(t.store, s.playlist.id, s.inScene, [s.a.id, s.b.id, s.c.id]);
    expect(getTrackOrder(t.store, s.playlist.id, s.inScene)).toBeNull();
    expect(getTrackOrders(t.store)).toEqual({});
  });

  it("makes one undo step per change and none for no change; clearing is one step and nothing to clear none", () => {
    const s = sample();
    const undo = new UndoHistory(t.store);
    setTrackOrder(t.store, s.playlist.id, s.inScene, [s.b.id, s.a.id, s.c.id]);
    expect(undo.state().undoLabel).toBe('Order "Abbey" in the scene "Ruins"');
    const steps = undo.recorded;
    setTrackOrder(t.store, s.playlist.id, s.inScene, [s.b.id, s.a.id, s.c.id]);
    clearTrackOrder(t.store, s.playlist.id, s.inSession);
    expect(undo.recorded).toBe(steps);
    clearTrackOrder(t.store, s.playlist.id, s.inScene);
    expect(undo.state().undoLabel).toBe(`Back to the order of "Abbey" in the scene "Ruins"`);
    expect(getTrackOrder(t.store, s.playlist.id, s.inScene)).toBeNull();
  });

  it("a track added to the playlist later follows; a deleted track drops out; an order goes with its place or playlist", async () => {
    const s = sample();
    setTrackOrder(t.store, s.playlist.id, s.inScene, [s.c.id, s.b.id, s.a.id]);
    addTracksToPlaylist(t.store, s.playlist.id, [s.d.id]);
    expect(getTrackOrder(t.store, s.playlist.id, s.inScene)).toEqual([s.c.id, s.b.id, s.a.id, s.d.id]);
    await deleteTracks(t.store, [s.b.id]);
    expect(getTrackOrder(t.store, s.playlist.id, s.inScene)).toEqual([s.c.id, s.a.id, s.d.id]);
    deleteScene(t.store, s.scene.id);
    expect(getTrackOrders(t.store)).toEqual({});
    setTrackOrder(t.store, s.playlist.id, s.inSession, [s.d.id]);
    deletePlaylist(t.store, s.playlist.id);
    expect(getTrackOrders(t.store)).toEqual({});
  });

  it("refuses the playlist's own place (null), an unknown playlist or place, and ids that are not a list", () => {
    const s = sample();
    expect(() => setTrackOrder(t.store, s.playlist.id, null as never, [s.a.id])).toThrow(ValidationError);
    expect(() => setTrackOrder(t.store, "nope", s.inScene, [])).toThrow(NotFoundError);
    expect(() => setTrackOrder(t.store, s.playlist.id, { ...s.inScene, sceneId: "nope" }, [])).toThrow(NotFoundError);
    expect(() => setTrackOrder(t.store, s.playlist.id, s.inScene, "a,b" as unknown as string[])).toThrow(ValidationError);
  });
});
