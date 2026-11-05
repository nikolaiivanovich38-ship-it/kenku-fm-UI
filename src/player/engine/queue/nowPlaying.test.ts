import { beforeEach, describe, expect, it } from "vitest";

import { keyOfPlace, shuffledOrder, tracksInOrder, type DomainTrack } from "../../../common/domain";
import { SceneRef, ShowData, ShowLibrary, staticLibrary } from "./library";
import {
  advance,
  EMPTY_LANE,
  MusicLane,
  placesOf,
  playlistItem,
  playNow,
  previous,
  queueNext,
  removeQueued,
  sceneItem,
  sequenceOf,
  single,
  stepFrom,
  upNext,
} from "./nowPlaying";

const ref: SceneRef = { campaignId: "c1", sessionId: "s1", sceneId: "sc1" };

function track(id: string): DomainTrack & { url: string } {
  return { id, kind: "music", title: id.toUpperCase(), metaTitle: "", fileName: `${id}.ogg`, durationMs: 60_000, role: null, loop: null, energy: null, tags: {}, url: `file:///${id}.ogg` };
}

let data: ShowData;
let lib: ShowLibrary;

beforeEach(() => {
  data = {
    tracks: ["a", "b", "c", "d", "x", "y"].map(track),
    playlists: [
      { id: "P", name: "Battle", lane: "music", kind: "manual", trackIds: ["a", "b"] },
      { id: "L", name: "Long", lane: "music", kind: "manual", trackIds: ["a", "b", "c", "d"] },
      { id: "D", name: "Dupes", lane: "music", kind: "manual", trackIds: ["a", "b", "a", "c"] },
    ],
    campaigns: [
      {
        id: "c1",
        playlistIds: [],
        boardIds: [],
        sessions: [
          {
            id: "s1",
            campaignId: "c1",
            playlistIds: [],
            boardIds: [],
            scenes: [
              // Sequence: a (track), a b (playlist P), c (track).
              { id: "sc1", name: "Tavern", music: [{ kind: "track", id: "a" }, { kind: "playlist", id: "P" }, { kind: "track", id: "c" }], ambience: null, boardIds: [] },
            ],
          },
        ],
      },
    ],
  };
  lib = staticLibrary(data);
});

const trackOf = (lane: MusicLane) => lane.current?.trackId ?? null;
const startScene = () => playNow(EMPTY_LANE, sceneItem(ref, 0, lib)!, lib);

describe("scene music in order (PLY-10)", () => {
  it("steps through the scene's sequence, never playing a track twice in a row, and wraps", () => {
    let lane = startScene();
    const heard = [trackOf(lane)];
    for (let i = 0; i < 4; i++) {
      const step = advance(lane, lib, { sequence: true });
      lane = step.lane;
      heard.push(step.play?.trackId ?? null);
    }
    expect(heard).toEqual(["a", "b", "c", "a", "b"]);
  });

  it("previous goes back through the sequence and wraps to the end", () => {
    const step = previous(startScene(), lib);
    expect(step.play).toMatchObject({ trackId: "c", origin: { kind: "scene", at: 3 } });
  });

  it("a track that came through a playlist in the scene knows both places, scene first", () => {
    const item = sceneItem(ref, 2, lib)!;
    expect(item).toMatchObject({ trackId: "b", playlistId: "P" });
    expect(placesOf(item)).toEqual([
      { kind: "scene", ...ref },
      { kind: "playlist", playlistId: "P" },
    ]);
    expect(placesOf(playlistItem("L", "c", lib)!)).toEqual([{ kind: "playlist", playlistId: "L" }]);
    expect(placesOf(single("x"))).toEqual([]);
  });

  it("a playlist on its own plays in its order and wraps", () => {
    let lane = playNow(EMPTY_LANE, playlistItem("P", null, lib)!, lib);
    expect(trackOf(lane)).toBe("a");
    lane = advance(lane, lib, { sequence: true }).lane;
    expect(trackOf(lane)).toBe("b");
    lane = advance(lane, lib, { sequence: true }).lane;
    expect(trackOf(lane)).toBe("a");
  });
});

describe("Now Playing queue (PLY-1)", () => {
  it("Play next plays after the current track, before the sequence goes on, in the order queued", () => {
    let lane = startScene();
    lane = queueNext(lane, { entryId: "q1", item: single("x") });
    lane = queueNext(lane, { entryId: "q2", item: single("y") });
    expect(upNext(lane, lib)?.trackId).toBe("x");
    const heard: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      lane = advance(lane, lib, { sequence: true }).lane;
      heard.push(trackOf(lane));
    }
    // After the detour the scene goes on from where it was: the step after "a".
    expect(heard).toEqual(["x", "y", "b", "c"]);
    expect(lane.queued).toEqual([]);
  });

  it("an item can be removed from the queue", () => {
    let lane = startScene();
    lane = queueNext(lane, { entryId: "q1", item: single("x") });
    lane = queueNext(lane, { entryId: "q2", item: single("y") });
    lane = removeQueued(lane, "q1");
    expect(lane.queued.map((q) => q.entryId)).toEqual(["q2"]);
    expect(removeQueued(lane, "nope")).toBe(lane);
  });

  it("an off-script track returns to the scene at the next step; a second detour keeps that return point", () => {
    let lane = startScene();
    lane = playNow(lane, single("x"), lib);
    expect(upNext(lane, lib)?.trackId).toBe("b");
    lane = playNow(lane, single("y"), lib);
    lane = advance(lane, lib, { sequence: true }).lane;
    expect(lane.current).toMatchObject({ trackId: "b", origin: { kind: "scene", at: 2 } });
    expect(lane.returnTo).toBeNull();
  });

  it("playing from the scene again forgets the return point", () => {
    let lane = playNow(startScene(), single("x"), lib);
    lane = playNow(lane, sceneItem(ref, 3, lib)!, lib);
    expect(lane.returnTo).toBeNull();
    expect(advance(lane, lib, { sequence: true }).play?.trackId).toBe("a");
  });

  it("a track that stops at its end still lets the queue play, but not the sequence", () => {
    let lane = startScene();
    expect(advance(lane, lib, { sequence: false })).toEqual({ lane: { ...lane, current: null }, play: null });
    lane = queueNext(lane, { entryId: "q1", item: single("x") });
    expect(advance(lane, lib, { sequence: false }).play?.trackId).toBe("x");
  });

  it("previous ignores the queue", () => {
    const lane = queueNext(startScene(), { entryId: "q1", item: single("x") });
    expect(previous(lane, lib).play?.trackId).toBe("c");
  });

  it("a queued track deleted from the library is skipped", () => {
    let lane = queueNext(startScene(), { entryId: "q1", item: single("x") });
    lane = queueNext(lane, { entryId: "q2", item: single("y") });
    data.tracks = data.tracks.filter((t) => t.id !== "x");
    expect(advance(lane, lib, { sequence: true }).play?.trackId).toBe("y");
  });

  it("an off-script track with nothing after it stops at its end", () => {
    const lane = playNow(EMPTY_LANE, single("x"), lib);
    expect(advance(lane, lib, { sequence: true }).play).toBeNull();
  });
});

describe("BUG-11: deleting a track never changes which track is current", () => {
  const playingC = () => playNow(EMPTY_LANE, playlistItem("L", "c", lib)!, lib);
  const removeFromL = (id: string) => {
    const pl = data.playlists.find((p) => p.id === "L")!;
    if (pl.kind === "manual") pl.trackIds = pl.trackIds.filter((t) => t !== id);
  };

  it("deleting a track before the current one keeps next and previous right", () => {
    const lane = playingC();
    removeFromL("b");
    expect(trackOf(lane)).toBe("c");
    expect(stepFrom(lane.current!, 1, lib)?.trackId).toBe("d");
    expect(stepFrom(lane.current!, -1, lib)?.trackId).toBe("a");
  });

  it("deleting the current track keeps it playing; next is the track after it", () => {
    const lane = playingC();
    removeFromL("c");
    expect(trackOf(lane)).toBe("c");
    expect(stepFrom(lane.current!, 1, lib)?.trackId).toBe("d");
    expect(stepFrom(lane.current!, -1, lib)?.trackId).toBe("b");
  });

  it("with the same track twice, the copy nearest the current place stays current", () => {
    // D = a b a c, playing the second a.
    const lane = playNow(EMPTY_LANE, { trackId: "a", origin: { kind: "playlist", playlistId: "D", at: 2 }, playlistId: "D" }, lib);
    const pl = data.playlists.find((p) => p.id === "D")!;
    if (pl.kind === "manual") pl.trackIds = ["a", "a", "c"];
    expect(stepFrom(lane.current!, 1, lib)?.trackId).toBe("c");
  });

  it("deleting tracks of the scene's own playlist keeps the scene's place", () => {
    let lane = playNow(EMPTY_LANE, sceneItem(ref, 2, lib)!, lib); // b, through P
    const pl = data.playlists.find((p) => p.id === "P")!;
    if (pl.kind === "manual") pl.trackIds = ["b"]; // "a" left P: the sequence is now a, b, c
    lane = advance(lane, lib, { sequence: true }).lane;
    expect(trackOf(lane)).toBe("c");
  });
});

describe("PLY-13 play order per place in the sequence", () => {
  const scenePlace = { kind: "scene" as const, ...ref };
  const ended = { sequence: true, ended: true };

  it("a playlist on its own repeats all by default: after its last track it starts again", () => {
    let lane = playNow(EMPTY_LANE, playlistItem("P", "b", lib)!, lib);
    lane = advance(lane, lib, ended).lane;
    expect(lane.current?.trackId).toBe("a");
  });

  it("No repeat: a playlist on its own stops after its last track; Next still goes round", () => {
    data.playlists[0].order = { shuffle: false, repeat: "off" };
    const lane = playNow(EMPTY_LANE, playlistItem("P", "b", lib)!, lib);
    expect(advance(lane, lib, ended).play).toBeNull();
    expect(advance(lane, lib, { sequence: true }).play?.trackId).toBe("a");
  });

  it("Repeat one plays the same track again when it ends, until Next", () => {
    data.playlists[1].order = { shuffle: false, repeat: "one" };
    const lane = playNow(EMPTY_LANE, playlistItem("L", "b", lib)!, lib);
    expect(advance(lane, lib, ended).play).toMatchObject({ trackId: "b", origin: { kind: "playlist", playlistId: "L", at: 1 } });
    expect(advance(lane, lib, { sequence: true }).play?.trackId).toBe("c");
  });

  it("a choice made for the scene applies there: Repeat all keeps the scene on that playlist until Next", () => {
    data.playOrders = { [keyOfPlace(scenePlace)]: { P: { shuffle: false, repeat: "all" } } };
    // Sequence: a (track), a b (playlist P), c (track). At P's last track (step 2) it goes back to P's first (step 1).
    let lane = playNow(EMPTY_LANE, sceneItem(ref, 2, lib)!, lib);
    lane = advance(lane, lib, ended).lane;
    expect(lane.current).toMatchObject({ trackId: "a", origin: { kind: "scene", at: 1 }, playlistId: "P" });
    // Next moves past it.
    expect(advance(playNow(EMPTY_LANE, sceneItem(ref, 2, lib)!, lib), lib, { sequence: true }).play?.trackId).toBe("c");
  });

  it("in a scene without a choice the playlist plays in order and the scene moves on (round 3)", () => {
    const lane = playNow(EMPTY_LANE, sceneItem(ref, 2, lib)!, lib);
    expect(advance(lane, lib, ended).play).toMatchObject({ trackId: "c", origin: { kind: "scene", at: 3 } });
  });

  it("a session's choice reaches a playlist played from the session's list, not the session's scenes", () => {
    const session = { kind: "session" as const, campaignId: "c1", sessionId: "s1" };
    data.playOrders = { [keyOfPlace(session)]: { P: { shuffle: false, repeat: "off" } } };
    const fromList = playNow(EMPTY_LANE, playlistItem("P", "b", lib, { place: session })!, lib);
    expect(advance(fromList, lib, ended).play).toBeNull();
    const alone = playNow(EMPTY_LANE, playlistItem("P", "b", lib)!, lib);
    expect(advance(alone, lib, ended).play?.trackId).toBe("a");
  });

  it("Shuffle plays the playlist in the order its seed deals, which Up next and the sequence show", () => {
    data.playlists[1].order = { shuffle: true, repeat: "all" };
    const dealt = shuffledOrder(["a", "b", "c", "d"], 7);
    const first = playlistItem("L", null, lib, { seed: 7 })!;
    expect(first.trackId).toBe(dealt[0]);
    expect(sequenceOf(first.origin, lib).map((s) => s.trackId)).toEqual(dealt);
    const lane = playNow(EMPTY_LANE, first, lib);
    expect(upNext(lane, lib)?.trackId).toBe(dealt[1]);
    expect(advance(lane, lib, ended).play?.trackId).toBe(dealt[1]);
  });

  it("a shuffled playlist inside a scene is dealt by the scene's seed; tracks around it keep their place", () => {
    data.playlists.push({ id: "Q", name: "Many", lane: "music", kind: "manual", trackIds: ["b", "c", "d", "x", "y"] });
    data.campaigns[0].sessions[0].scenes[0].music = [{ kind: "track", id: "a" }, { kind: "playlist", id: "Q" }];
    data.playOrders = { [keyOfPlace(scenePlace)]: { Q: { shuffle: true, repeat: "off" } } };
    const start = sceneItem(ref, 0, lib, 11)!;
    const seq = sequenceOf(start.origin, lib).map((s) => s.trackId);
    expect(seq[0]).toBe("a");
    expect(seq.slice(1)).toEqual(tracksInOrder(["b", "c", "d", "x", "y"], { shuffle: true, repeat: "off" }, 11 + 1));
  });

  it("a track played from a session list uses the session's own audio settings first (PLY-14)", () => {
    const session = { kind: "session" as const, campaignId: "c1", sessionId: "s1" };
    expect(placesOf(playlistItem("P", "a", lib, { place: session })!)).toEqual([session, { kind: "playlist", playlistId: "P" }]);
  });
});
