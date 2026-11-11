/**
 * Round 6 (PLY-16, PLY-17, ORG-13) in the audio host: each room's running list for the evening (Play next, Add to
 * queue, Up next with ×, Clear added, Undo, a new scene clearing what was added, loading another session clearing
 * everything) and the room's own Repeat (never saved), on the real engine over the fake audio graph. The rules
 * themselves are src/common/domain/roomList.ts; here they meet what plays.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { keyOfPlace, type Room } from "../../common/domain";
import type { NowPlaying } from "./lyreAudio";
import { lyreAudioOnFakes, testTrack, type AudioTestData } from "./testing/onFakes";

const S1 = { campaignId: "c", sessionId: "s", sceneId: "s1" };
const S2 = { campaignId: "c", sessionId: "s", sceneId: "s2" };
const SCENE1 = { kind: "scene" as const, ...S1 };
const SESSION = { kind: "session" as const, campaignId: "c", sessionId: "s" };
const DUNGEON: Room = { botId: "bot-b", name: "Dungeon" };
const TAVERN: Room = { botId: "bot-a", name: "Tavern" };

function makeData(): AudioTestData {
  return {
    // Every track is 20 seconds long.
    tracks: ["m1", "m2", "m3", "m4", "m5", "m6"].map((id) => testTrack(id, 20)),
    playlists: [
      { id: "P", name: "Battle", lane: "music", kind: "manual", trackIds: ["m2", "m3"] },
      { id: "Q", name: "Quiet", lane: "music", kind: "manual", trackIds: ["m4", "m5", "m6"] },
    ],
    campaigns: [
      {
        id: "c",
        playlistIds: [],
        boardIds: [],
        sessions: [
          {
            id: "s",
            campaignId: "c",
            playlistIds: ["Q"],
            boardIds: [],
            scenes: [
              { id: "s1", name: "Tavern brawl", music: [{ kind: "track", id: "m1" }, { kind: "playlist", id: "P" }], ambience: null, boardIds: [] },
              { id: "s2", name: "Crypt", music: [{ kind: "track", id: "m6" }], ambience: null, boardIds: [] },
            ],
          },
        ],
      },
    ],
  };
}

let rig: ReturnType<typeof lyreAudioOnFakes>;
beforeEach(() => {
  rig = lyreAudioOnFakes(makeData());
  errors = [];
  rig.audio.on("error", (message) => errors.push(message));
});
let errors: string[];
const state = (): NowPlaying => rig.audio.getNowPlaying();
const first = () => state().rooms[0];
const playing = () => first().music?.trackId ?? null;
/** Up next as "kind:track" for each track still to play, top to bottom. */
const upNext = () => first().upNextList.flatMap((e) => e.trackIds.map((t) => `${e.kind}:${t}`));

/** The tracks the first room plays from now, each to its end (20 s each). */
async function playsThrough(count: number): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (let i = 0; i < count; i++) {
    await rig.advance(20);
    out.push(playing());
  }
  return out;
}

describe("Play next and Add to queue (Nik, 6 Nov 12:14)", () => {
  it("Play next plays right after the current track, the newest first; Add to queue after the bottom of the plan", async () => {
    rig.audio.startScene(S1);
    await rig.advance(1);
    expect(rig.audio.addToQueue({ kind: "track", trackId: "m6" })).toEqual({ ok: true });
    rig.audio.playNext({ kind: "track", trackId: "m4" });
    rig.audio.playNext({ kind: "track", trackId: "m5" });
    expect(upNext()).toEqual(["playNext:m5", "playNext:m4", "planned:m2", "planned:m3", "added:m6"]);
    expect(first().upNext).toEqual({ trackId: "m5", title: "M5" });
    expect(await playsThrough(6)).toEqual(["m5", "m4", "m2", "m3", "m6", "m1"]);
    // Added once each: with no Repeat, what was added has gone; the scene starts again from its top.
    expect(upNext()).toEqual(["planned:m2", "planned:m3"]);
  });

  it("a playlist is one item, with its tracks in its place's order (ORG-13), named for Up next", async () => {
    rig.data.trackOrders = { [keyOfPlace(SESSION)]: { Q: ["m6", "m4", "m5"] } };
    rig.audio.playTrack("m1");
    rig.audio.addToQueue({ kind: "playlist", playlistId: "Q", place: SESSION });
    await rig.advance(1);
    expect(first().upNextList).toEqual([
      expect.objectContaining({ kind: "added", trackIds: ["m6", "m4", "m5"], title: "Quiet", playlistId: "Q", ref: { kind: "added", itemId: expect.any(String) } }),
    ]);
    expect(await playsThrough(4)).toEqual(["m6", "m4", "m5", null]);
  });

  it("in a room with nothing playing, Play next and Add to queue play at once", async () => {
    rig.audio.addToQueue({ kind: "playlist", playlistId: "P" });
    await rig.advance(1);
    expect(first().music).toMatchObject({ trackId: "m2", playlistId: "P" });
    expect(first().upNextList).toEqual([expect.objectContaining({ kind: "planned", trackIds: ["m3"] })]);
  });

  it("Play on air of a single track while the plan plays: it plays now and the plan carries on after it", async () => {
    rig.audio.startScene(S1);
    await rig.advance(1);
    rig.audio.playTrack("m5");
    await rig.advance(1);
    expect(playing()).toBe("m5");
    expect(await playsThrough(2)).toEqual(["m2", "m3"]);
  });

  it("the old Play next (playTrack when: next) and removeQueued work on the same list", async () => {
    rig.audio.playTrack("m1");
    rig.audio.playTrack("m2", { when: "next" });
    expect(first().queued).toEqual([{ entryId: expect.any(String), trackId: "m2", title: "M2" }]);
    rig.audio.removeQueued(first().queued[0].entryId);
    expect(first().queued).toEqual([]);
    expect(first().upNextList).toEqual([]);
  });

  it("each room keeps its own list", async () => {
    rig.setRooms([TAVERN, DUNGEON]);
    rig.audio.playTrack("m1", { target: { room: TAVERN.botId } });
    rig.audio.playTrack("m2", { target: { room: DUNGEON.botId } });
    rig.audio.addToQueue({ kind: "track", trackId: "m3" }, { target: { room: DUNGEON.botId } });
    expect(state().rooms.map((r) => r.upNextList.length)).toEqual([0, 1]);
  });
});

describe("Up next: ×, Clear added and Undo, a new scene, another session", () => {
  it("× takes a planned track out for this evening, or an added item; Undo puts the last one back", async () => {
    rig.audio.startScene(S1);
    rig.audio.addToQueue({ kind: "track", trackId: "m6" });
    const planned = first().upNextList.find((e) => e.kind === "planned" && e.trackIds[0] === "m2")!;
    expect(rig.audio.removeFromUpNext(planned.ref)).toEqual({ ok: true });
    expect(upNext()).toEqual(["planned:m3", "added:m6"]);
    expect(first().canUndoUpNext).toBe(true);
    rig.audio.undoUpNext();
    expect(upNext()).toEqual(["planned:m2", "planned:m3", "added:m6"]);
    expect(first().canUndoUpNext).toBe(false);
    expect(rig.audio.undoUpNext()).toEqual({ ok: false, message: "There is nothing in Up next to undo." });
    expect(errors).toEqual(["There is nothing in Up next to undo."]);
    const added = first().upNextList.find((e) => e.kind === "added")!;
    rig.audio.removeFromUpNext(added.ref);
    expect(upNext()).toEqual(["planned:m2", "planned:m3"]);
  });

  it("Clear added empties Play next and the queue; Undo brings them back", async () => {
    rig.audio.startScene(S1);
    rig.audio.addToQueue({ kind: "track", trackId: "m6" });
    rig.audio.playNext({ kind: "track", trackId: "m4" });
    rig.audio.clearAdded();
    expect(upNext()).toEqual(["planned:m2", "planned:m3"]);
    rig.audio.undoUpNext();
    expect(upNext()).toEqual(["playNext:m4", "planned:m2", "planned:m3", "added:m6"]);
  });

  it("a new scene clears what was added (Nik, 6 Nov 13:55); the scene's Undo brings it back", async () => {
    rig.audio.startScene(S1);
    rig.audio.addToQueue({ kind: "track", trackId: "m5" });
    rig.audio.startScene(S2);
    await rig.advance(1);
    expect(playing()).toBe("m6");
    expect(first().upNextList).toEqual([]);
    rig.audio.undoSceneStart();
    await rig.advance(1);
    expect(playing()).toBe("m1");
    expect(upNext()).toEqual(["planned:m2", "planned:m3", "added:m5"]);
  });

  it("loading another session clears every room's list; what plays goes on", async () => {
    rig.audio.startScene(S1);
    rig.audio.addToQueue({ kind: "track", trackId: "m5" });
    rig.audio.sessionLoaded();
    expect(upNext()).toEqual(["planned:m2", "planned:m3"]);
    expect(playing()).toBe("m1");
  });
});

describe("Repeat per room (Nik, 6 Nov 12:24: for what plays now, never saved, ends when the music stops)", () => {
  it("shows what the music does by itself until pressed, then goes off, all, one", async () => {
    rig.audio.playPlaylist("P");
    expect(first().repeat).toEqual({ shown: "all", chosen: null });
    expect(rig.audio.cycleRepeat()).toEqual({ ok: true });
    expect(first().repeat).toEqual({ shown: "one", chosen: "one" });
    rig.audio.cycleRepeat();
    expect(first().repeat).toEqual({ shown: "off", chosen: "off" });
    rig.audio.cycleRepeat();
    expect(first().repeat).toEqual({ shown: "all", chosen: "all" });
    // The playlist's own play order is not changed (PLY-13 is saved; this is not).
    expect(rig.data.playlists[0].order ?? null).toBeNull();
  });

  it("Repeat one plays the track again; Repeat all keeps what was added coming round", async () => {
    rig.audio.playTrack("m1");
    rig.audio.addToQueue({ kind: "track", trackId: "m2" });
    rig.audio.setRepeat("one");
    expect(await playsThrough(2)).toEqual(["m1", "m1"]);
    rig.audio.setRepeat("all");
    expect(await playsThrough(4)).toEqual(["m2", "m1", "m2", "m1"]);
  });

  it("goes back to not chosen when the room's music stops, and when a new plan starts", async () => {
    rig.audio.playPlaylist("P");
    rig.audio.setRepeat("one");
    rig.audio.stopLane("music", { fadeMs: 0 });
    expect(first().repeat.chosen).toBeNull();
    rig.audio.playPlaylist("P");
    rig.audio.setRepeat("off");
    rig.audio.startScene(S1);
    expect(first().repeat).toEqual({ shown: "off", chosen: null });
  });

  it("PLY-17: a scene's track with Repeat one saved plays again when it ends, in that scene", async () => {
    rig.data.repeatOnes = { [keyOfPlace(SCENE1)]: ["m1"] };
    rig.audio.startScene(S1);
    expect(first().repeat).toEqual({ shown: "one", chosen: null });
    expect(await playsThrough(2)).toEqual(["m1", "m1"]);
    rig.audio.next("music");
    await rig.advance(1);
    expect(playing()).toBe("m2");
  });

  it("PLY-17: pressing Repeat one on the track that plays clears a Repeat chosen in that room, so the saved one shows", async () => {
    rig.audio.startScene(S1);
    rig.audio.setRepeat("all");
    rig.data.repeatOnes = { [keyOfPlace(SCENE1)]: ["m1"] };
    rig.audio.savedRepeatOneChanged(S1, "m1");
    expect(first().repeat).toEqual({ shown: "one", chosen: null });
  });
});
