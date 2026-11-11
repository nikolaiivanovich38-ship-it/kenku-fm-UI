/**
 * Design round 5 in the library (schema version 3): play order per place (PLY-13), a track's name in a scene
 * (DAT-14), track shape (DAT-13), tracks on hand (ORG-12), a session list's own audio settings (PLY-14) and pads
 * put aside by hand (SFX-11). Each write is checked for its refusals here and for undo in undo.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reflowBoard, type TrackShape } from "../../../common/domain";
import { NotFoundError, ValidationError } from "../errors";
import { makeTestStore } from "../test/testStore";
import { UndoHistory } from "../undo";
import { addPad, createBoard, getBoardLayout, movePad, resizeBoard } from "./boards";
import {
  addSceneMusic,
  addToCampaign,
  addToSession,
  createCampaign,
  createScene,
  createSession,
  listCampaignMembers,
  listSessionMembers,
  moveInCampaign,
  moveInSession,
  removeFromCampaign,
  removeFromSession,
  setTrackUses,
} from "./campaigns";
import { getDomainCampaign, getDomainLookup, listUses } from "./domain";
import { savePeaks } from "./peaks";
import { clearPlayOrder, getPlayOrder, getPlayOrderOverrides, ownPlayOrders, setPlayOrder } from "./playOrders";
import { createPlaylist, deletePlaylist, getPlaylist, listPlaylistTrackIds, updatePlaylist } from "./playlists";
import { clearProfileOverride, getProfileOverride, getProfileOverrides, setProfileOverride } from "./profiles";
import { search } from "./search";
import { getTrackNames, listTrackSceneNames, setSceneTrackName } from "./sceneNames";
import { createTracks, deleteTracks, getTrack, listTrackIdsByShape, updateTrack } from "./tracks";

let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  t = makeTestStore();
});
afterEach(() => t.close());

function sample() {
  const [bells, rain, sting] = createTracks(t.store, [
    { title: "Bells", file: { path: "/m/bells.flac", size: 10, mtimeMs: 1 }, durationMs: 200_000 },
    { title: "Rain", kind: "amb", file: { path: "/m/rain.flac", size: 20, mtimeMs: 2 } },
    { title: "Sting", role: "sting", file: { path: "/m/sting.flac", size: 30, mtimeMs: 3 } },
  ]);
  const playlist = createPlaylist(t.store, { title: "Abbey" });
  const campaign = createCampaign(t.store, { name: "Crown" });
  const session = createSession(t.store, { campaignId: campaign.id, name: "Abbey" });
  const scene = createScene(t.store, { sessionId: session.id, name: "Ruins" });
  const other = createScene(t.store, { sessionId: session.id, name: "Crypt" });
  const inScene = { kind: "scene" as const, campaignId: campaign.id, sessionId: session.id, sceneId: scene.id };
  const inSession = { kind: "session" as const, campaignId: campaign.id, sessionId: session.id };
  const inCampaign = { kind: "campaign" as const, campaignId: campaign.id };
  return { bells, rain, sting, playlist, campaign, session, scene, other, inScene, inSession, inCampaign };
}

/** Levels rising from quiet to loud, as savePeaks takes them (bytes). */
const RISING = Uint8Array.from({ length: 48 }, (_, i) => Math.round(40 + (200 * i) / 47));
const STEADY = Uint8Array.from({ length: 48 }, () => 150);

describe("PLY-13 play order per place", () => {
  it("keeps the playlist's own order and each place's, and reads them back keyed by place", () => {
    const s = sample();
    expect(getPlayOrder(t.store, s.playlist.id, null)).toBeNull();
    setPlayOrder(t.store, s.playlist.id, null, { shuffle: true, repeat: "all" });
    setPlayOrder(t.store, s.playlist.id, s.inScene, { shuffle: true, repeat: "off" });
    setPlayOrder(t.store, s.playlist.id, s.inSession, { shuffle: false, repeat: "one" });
    setPlayOrder(t.store, s.playlist.id, s.inCampaign, { shuffle: false, repeat: "all" });
    setPlayOrder(t.store, s.playlist.id, s.inScene, { shuffle: false, repeat: "one" }); // replaces
    expect(getPlayOrder(t.store, s.playlist.id, null)).toEqual({ shuffle: true, repeat: "all" });
    expect(getPlayOrder(t.store, s.playlist.id, s.inScene)).toEqual({ shuffle: false, repeat: "one" });
    expect(ownPlayOrders(t.store, "all")).toEqual(new Map([[s.playlist.id, { shuffle: true, repeat: "all" }]]));
    expect(getPlayOrderOverrides(t.store)).toEqual({
      [`cp:${s.campaign.id}`]: { [s.playlist.id]: { shuffle: false, repeat: "all" } },
      [`sc:${s.campaign.id}:${s.session.id}:${s.scene.id}`]: { [s.playlist.id]: { shuffle: false, repeat: "one" } },
      [`ss:${s.campaign.id}:${s.session.id}`]: { [s.playlist.id]: { shuffle: false, repeat: "one" } },
    });
  });

  it("goes back to the playlist's own order in a place, and a place without a choice changes nothing", () => {
    const s = sample();
    const history = new UndoHistory(t.store);
    setPlayOrder(t.store, s.playlist.id, s.inScene, { shuffle: true, repeat: "off" });
    clearPlayOrder(t.store, s.playlist.id, s.inScene);
    expect(getPlayOrder(t.store, s.playlist.id, s.inScene)).toBeNull();
    const steps = history.recorded;
    clearPlayOrder(t.store, s.playlist.id, s.inScene);
    expect(history.recorded).toBe(steps);
  });

  it("refuses an unknown repeat, an unknown playlist, and a scene named in the wrong session", () => {
    const s = sample();
    expect(() => setPlayOrder(t.store, s.playlist.id, null, { shuffle: true, repeat: "twice" as never })).toThrow(ValidationError);
    expect(() => setPlayOrder(t.store, s.playlist.id, null, { shuffle: "yes" as never, repeat: "all" })).toThrow(ValidationError);
    expect(() => setPlayOrder(t.store, "nope", null, { shuffle: true, repeat: "all" })).toThrow(NotFoundError);
    expect(() => setPlayOrder(t.store, s.playlist.id, { ...s.inScene, sessionId: "elsewhere" }, { shuffle: true, repeat: "all" })).toThrow(ValidationError);
    expect(() => setPlayOrder(t.store, s.playlist.id, { kind: "room" } as never, { shuffle: true, repeat: "all" })).toThrow(ValidationError);
  });

  it("the playlist's own order shows on the domain playlist; every order goes with the playlist", () => {
    const s = sample();
    setPlayOrder(t.store, s.playlist.id, null, { shuffle: true, repeat: "one" });
    setPlayOrder(t.store, s.playlist.id, s.inScene, { shuffle: true, repeat: "off" });
    expect(getDomainLookup(t.store).playlist(s.playlist.id)?.order).toEqual({ shuffle: true, repeat: "one" });
    deletePlaylist(t.store, s.playlist.id);
    expect(getPlayOrderOverrides(t.store)).toEqual({});
    expect(ownPlayOrders(t.store, "all").size).toBe(0);
  });
});

describe("DAT-14 a track's name in a scene", () => {
  it("names a track in one scene, trims it, clears it with an empty name, and reads every name by scene key", () => {
    const s = sample();
    setSceneTrackName(t.store, s.scene.id, s.bells.id, "  The wight rises ");
    setSceneTrackName(t.store, s.other.id, s.bells.id, "Dawn");
    setSceneTrackName(t.store, s.scene.id, s.bells.id, "The wight rises again");
    expect(getTrackNames(t.store)).toEqual({
      [`sc:${s.campaign.id}:${s.session.id}:${s.scene.id}`]: { [s.bells.id]: "The wight rises again" },
      [`sc:${s.campaign.id}:${s.session.id}:${s.other.id}`]: { [s.bells.id]: "Dawn" },
    });
    expect(listTrackSceneNames(t.store, s.bells.id)).toEqual([
      { campaignId: s.campaign.id, sessionId: s.session.id, sceneId: s.scene.id, name: "The wight rises again" },
      { campaignId: s.campaign.id, sessionId: s.session.id, sceneId: s.other.id, name: "Dawn" },
    ]);
    setSceneTrackName(t.store, s.scene.id, s.bells.id, "   ");
    expect(getTrackNames(t.store, { trackId: s.bells.id })).toEqual({ [`sc:${s.campaign.id}:${s.session.id}:${s.other.id}`]: { [s.bells.id]: "Dawn" } });
  });

  it("refuses a name too long, an unknown scene or track; the name goes with the track", async () => {
    const s = sample();
    expect(() => setSceneTrackName(t.store, s.scene.id, s.bells.id, "n".repeat(201))).toThrow(ValidationError);
    expect(() => setSceneTrackName(t.store, "nope", s.bells.id, "X")).toThrow(NotFoundError);
    expect(() => setSceneTrackName(t.store, s.scene.id, "nope", "X")).toThrow(NotFoundError);
    setSceneTrackName(t.store, s.scene.id, s.bells.id, "X");
    await deleteTracks(t.store, [s.bells.id]);
    expect(getTrackNames(t.store)).toEqual({});
  });

  it("is searchable: a track is found by its names in scenes", () => {
    const s = sample();
    setSceneTrackName(t.store, s.scene.id, s.bells.id, "The wight rises");
    expect(search(t.store, "wight").map((h) => h.id)).toEqual([s.bells.id]);
  });
});

describe("DAT-13 track shape", () => {
  it("keeps the game master's choice on the track and clears it with null", () => {
    const s = sample();
    expect(updateTrack(t.store, s.bells.id, { shape: "builds" }).shape).toBe("builds");
    expect(() => updateTrack(t.store, s.bells.id, { shape: "swells" as never })).toThrow(ValidationError);
    expect(updateTrack(t.store, s.bells.id, { shape: null }).shape).toBeNull();
  });

  it("keeps the suggestion with the peaks it comes from, and the domain track has both", () => {
    const s = sample();
    savePeaks(t.store, { trackId: s.bells.id, file: "/m/bells.flac", fileSize: 10, fileMtimeMs: 1 }, RISING);
    savePeaks(t.store, { trackId: s.rain.id, file: "/m/rain.flac", fileSize: 20, fileMtimeMs: 2 }, null);
    updateTrack(t.store, s.sting.id, { shape: "fallsAway" });
    const lookup = getDomainLookup(t.store);
    expect(lookup.track(s.bells.id)).toMatchObject({ shape: null, suggestedShape: "builds" });
    expect(lookup.track(s.rain.id)).toMatchObject({ shape: null, suggestedShape: null });
    expect([...lookup.tracks()].find((x) => x.id === s.sting.id)).toMatchObject({ shape: "fallsAway", suggestedShape: null });
  });

  it("the Shape filter finds tracks by the chosen shape, else the suggested one", () => {
    const s = sample();
    savePeaks(t.store, { trackId: s.bells.id, file: "/m/bells.flac", fileSize: 10, fileMtimeMs: 1 }, RISING);
    savePeaks(t.store, { trackId: s.sting.id, file: "/m/sting.flac", fileSize: 30, fileMtimeMs: 3 }, RISING);
    updateTrack(t.store, s.sting.id, { shape: "steady" });
    expect(listTrackIdsByShape(t.store, ["builds"])).toEqual([s.bells.id]);
    expect(listTrackIdsByShape(t.store, ["steady", "builds"]).sort()).toEqual([s.bells.id, s.sting.id].sort());
    expect(listTrackIdsByShape(t.store, [])).toEqual([]);
    expect(() => listTrackIdsByShape(t.store, ["wobbly" as TrackShape])).toThrow(ValidationError);
  });

  it("a dynamic playlist keeps the shapes its rule asks for, and plays only tracks of those shapes", () => {
    const s = sample();
    savePeaks(t.store, { trackId: s.bells.id, file: "/m/bells.flac", fileSize: 10, fileMtimeMs: 1 }, RISING);
    savePeaks(t.store, { trackId: s.sting.id, file: "/m/sting.flac", fileSize: 30, fileMtimeMs: 3 }, STEADY);
    const dynamic = createPlaylist(t.store, { title: "Builds", kind: "dynamic", lane: "music", rule: { conds: [], shapes: ["builds", "peaksThenFalls"] } });
    expect(getPlaylist(t.store, dynamic.id)?.rule).toEqual({ conds: [], shapes: ["builds", "peaksThenFalls"] });
    expect(listPlaylistTrackIds(t.store, dynamic.id)).toEqual([s.bells.id]);
    updateTrack(t.store, s.sting.id, { shape: "peaksThenFalls" });
    expect(listPlaylistTrackIds(t.store, dynamic.id)).toEqual([s.bells.id, s.sting.id]);
    updatePlaylist(t.store, dynamic.id, { rule: { conds: [] } });
    expect(getPlaylist(t.store, dynamic.id)?.rule).toEqual({ conds: [] });
    expect(() => updatePlaylist(t.store, dynamic.id, { rule: { conds: [], shapes: ["swells" as never] } })).toThrow(ValidationError);
  });
});

describe("ORG-12 tracks on hand", () => {
  it("keeps tracks on hand for a campaign and a session, in order, beside its playlists and boards", () => {
    const s = sample();
    addToCampaign(t.store, s.campaign.id, { trackIds: [s.bells.id, s.sting.id] });
    addToCampaign(t.store, s.campaign.id, { trackIds: [s.bells.id] }); // already there
    moveInCampaign(t.store, s.campaign.id, { trackId: s.sting.id }, "start");
    addToSession(t.store, s.session.id, { trackIds: [s.rain.id], playlistIds: [s.playlist.id] });
    expect(listCampaignMembers(t.store, s.campaign.id)).toEqual({ playlistIds: [], boardIds: [], trackIds: [s.sting.id, s.bells.id] });
    expect(listSessionMembers(t.store, s.session.id)).toEqual({ playlistIds: [s.playlist.id], boardIds: [], trackIds: [s.rain.id] });
    const tree = getDomainCampaign(t.store, s.campaign.id);
    expect(tree?.trackIds).toEqual([s.sting.id, s.bells.id]);
    expect(tree?.sessions[0].trackIds).toEqual([s.rain.id]);
    moveInSession(t.store, s.session.id, { trackId: s.rain.id }, "end");
    removeFromCampaign(t.store, s.campaign.id, { trackIds: [s.sting.id] });
    removeFromSession(t.store, s.session.id, { trackIds: [s.rain.id] });
    expect(getDomainCampaign(t.store, s.campaign.id)?.trackIds).toEqual([s.bells.id]);
    expect(() => moveInCampaign(t.store, s.campaign.id, { trackId: s.rain.id }, "start")).toThrow(ValidationError);
    expect(() => addToCampaign(t.store, s.campaign.id, { trackIds: ["nope"] })).toThrow(NotFoundError);
  });

  it("Use in… on a track: exactly the ticked places use it; ambience becomes the scene's ambience", () => {
    const s = sample();
    setTrackUses(t.store, s.bells.id, [{ campaignId: s.campaign.id }, { sessionId: s.session.id }, { sceneId: s.scene.id }]);
    setTrackUses(t.store, s.rain.id, [{ sceneId: s.other.id }]);
    expect(listUses(t.store, { trackId: s.bells.id })).toEqual([
      { level: "campaign", campaignId: s.campaign.id },
      { level: "session", campaignId: s.campaign.id, sessionId: s.session.id },
      { level: "scene", campaignId: s.campaign.id, sessionId: s.session.id, sceneId: s.scene.id, role: "music", position: 0 },
    ]);
    expect(listUses(t.store, { trackId: s.rain.id })).toEqual([
      { level: "scene", campaignId: s.campaign.id, sessionId: s.session.id, sceneId: s.other.id, role: "ambience", position: 0 },
    ]);
    // Unticking takes it out of the place, every time it comes in a scene's music.
    addSceneMusic(t.store, s.scene.id, [{ kind: "track", id: s.bells.id }]);
    setTrackUses(t.store, s.bells.id, [{ sessionId: s.session.id }]);
    expect(listUses(t.store, { trackId: s.bells.id })).toEqual([{ level: "session", campaignId: s.campaign.id, sessionId: s.session.id }]);
    expect(() => setTrackUses(t.store, s.bells.id, [{ campaignId: "nope" }])).toThrow(NotFoundError);
  });
});

describe("PLY-14 a session list's own audio settings", () => {
  it("keeps, reads and clears a track's own settings in a session list, keyed ss:<campaign>:<session>", () => {
    const s = sample();
    setProfileOverride(t.store, s.inSession, s.bells.id, { endMs: 90_000, after: "stop" });
    expect(getProfileOverride(t.store, s.inSession, s.bells.id)).toEqual({ endMs: 90_000, after: "stop" });
    expect(getProfileOverrides(t.store)).toEqual({ [`ss:${s.campaign.id}:${s.session.id}`]: { [s.bells.id]: { endMs: 90_000, after: "stop" } } });
    expect(() => setProfileOverride(t.store, { ...s.inSession, campaignId: "elsewhere" }, s.bells.id, {})).toThrow(ValidationError);
    clearProfileOverride(t.store, s.inSession, s.bells.id);
    expect(getProfileOverrides(t.store)).toEqual({});
  });
});

describe("SFX-11 pads put aside by hand, and resizing through reflowBoard", () => {
  function board(cols: number, rows: number, labels: (string | null)[]) {
    const b = createBoard(t.store, { title: "Combat", cols, rows });
    const pads: Record<string, string> = {};
    labels.forEach((label, i) => {
      if (label) pads[label] = addPad(t.store, b.id, { label, at: { row: Math.floor(i / cols), col: i % cols } }).id;
    });
    return { id: b.id, pads };
  }
  const labelsOf = (boardId: string) => {
    const layout = getBoardLayout(t.store, boardId);
    return { slots: layout.slots.map((p) => p?.label ?? null), spare: layout.spare.map((p) => `${p.label}${p.putAside ? " (aside)" : ""}`) };
  };

  it("a pad moved to Spare pads by hand is aside; one put back on the grid is not", () => {
    const b = board(2, 1, ["A", "B"]);
    expect(movePad(t.store, b.pads.A, "spare").putAside).toBe(true);
    expect(movePad(t.store, b.pads.A, { row: 0, col: 0 }).putAside).toBe(false);
  });

  it("a spare pad dragged onto a grid pad sends that pad to Spare pads by hand", () => {
    const b = board(1, 1, ["A"]);
    const spare = addPad(t.store, b.id, { label: "S", at: "spare" });
    expect(spare.putAside).toBe(true);
    movePad(t.store, spare.id, { row: 0, col: 0 });
    expect(labelsOf(b.id)).toEqual({ slots: ["S"], spare: ["A (aside)"] });
  });

  it("a pad that lands among the spare pads because the grid is full is not aside", () => {
    const b = board(1, 1, ["A"]);
    expect(addPad(t.store, b.id, { label: "B" }).putAside).toBe(false);
  });

  it("resizing packs pads left to right, top to bottom, as reflowBoard does, and says which moved", () => {
    const b = board(3, 2, ["A", null, "B", null, "C", "D"]);
    expect(resizeBoard(t.store, b.id, { cols: 2, rows: 2 })).toEqual({ movedToSpare: [], cameBack: [] });
    expect(labelsOf(b.id)).toEqual({ slots: ["A", "B", "C", "D"], spare: [] });
    expect(resizeBoard(t.store, b.id, { cols: 3, rows: 1 })).toEqual({ movedToSpare: [b.pads.D], cameBack: [] });
    expect(labelsOf(b.id)).toEqual({ slots: ["A", "B", "C"], spare: ["D"] });
    expect(resizeBoard(t.store, b.id, { cols: 2, rows: 1 })).toEqual({ movedToSpare: [b.pads.C], cameBack: [] });
    // Spilled pads first, then the spare pads already there.
    expect(labelsOf(b.id)).toEqual({ slots: ["A", "B"], spare: ["C", "D"] });
    expect(resizeBoard(t.store, b.id, { cols: 2, rows: 2 })).toEqual({ movedToSpare: [], cameBack: [b.pads.C, b.pads.D] });
    expect(labelsOf(b.id)).toEqual({ slots: ["A", "B", "C", "D"], spare: [] });
  });

  it("a pad put aside by hand stays aside however large the grid gets", () => {
    const b = board(2, 1, ["A", "B"]);
    movePad(t.store, b.pads.B, "spare");
    expect(resizeBoard(t.store, b.id, { cols: 1, rows: 1 })).toEqual({ movedToSpare: [], cameBack: [] });
    expect(resizeBoard(t.store, b.id, { cols: 3, rows: 3 })).toEqual({ movedToSpare: [], cameBack: [] });
    expect(labelsOf(b.id)).toEqual({ slots: ["A", null, null, null, null, null, null, null, null], spare: ["B (aside)"] });
  });

  it("gives the same layout as reflowBoard for every other size from 1 × 1 to 4 × 3 (the same size changes nothing)", () => {
    for (let cols = 1; cols <= 4; cols++) {
      for (let rows = 1; rows <= 3; rows++) {
        if (cols === 3 && rows === 2) continue;
        const b = board(3, 2, ["A", null, "B", "C", null, "D"]);
        movePad(t.store, b.pads.C, "spare");
        const before = getBoardLayout(t.store, b.id);
        const want = reflowBoard(before.slots.map((p) => p?.label ?? null), before.spare.map((p) => p.label), cols, rows, (label) => label === "C");
        resizeBoard(t.store, b.id, { cols, rows });
        const after = labelsOf(b.id);
        expect({ slots: after.slots, spare: after.spare.map((x) => x.replace(" (aside)", "")) }).toEqual({ slots: want.slots, spare: want.spare });
      }
    }
  });

  it("is one undo step that puts every pad back where it was", async () => {
    const history = new UndoHistory(t.store);
    const b = board(3, 2, ["A", null, "B", null, "C", "D"]);
    movePad(t.store, b.pads.D, "spare");
    const before = labelsOf(b.id);
    resizeBoard(t.store, b.id, { cols: 1, rows: 2 });
    await history.undo();
    expect(labelsOf(b.id)).toEqual(before);
    expect(getTrack(t.store, "nothing")).toBeNull();
  });
});
