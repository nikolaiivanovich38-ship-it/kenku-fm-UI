/**
 * The show engine end to end on the fake audio graph: scenes in order with
 * their audio profiles (PLY-10, PLY-12), the Now Playing queue and Undo
 * (PLY-1), cue actions sent to rooms (PLY-8), and track behaviours (PLY-4).
 * Rooms are a fake of the Rooms stream's interface (rooms.contract.ts): each
 * room has its own music, ambience and effects gains feeding its own output,
 * so a test can listen to one room.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainTrack, fadeInGain, placeKey, Room, RoomTarget, shuffledOrder } from "../../../common/domain";
import { PlaybackEngine } from "../engine";
import { RoomLane, RoomsAudio } from "../rooms.contract";
import { SourceLoader } from "../sources/sourceLoader";
import { FakeAudioContext, FakeGain } from "../testing/fakeAudio";
import { CueAction, isCueAction } from "./actions";
import { Director } from "./director";
import { SceneRef, ShowData, staticLibrary } from "./library";

class FakeRooms implements RoomsAudio {
  private list: Room[];
  private readonly buses = new Map<string, Record<RoomLane, FakeGain> & { out: FakeGain }>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly context: FakeAudioContext,
    names: string[],
  ) {
    this.list = names.map((name) => ({ botId: name.toLowerCase(), name }));
  }

  rooms() {
    return this.list;
  }

  getRoomBus(roomId: string, lane: RoomLane) {
    return this.room(roomId)[lane];
  }

  onRoomsChanged(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setRooms(names: string[]) {
    this.list = names.map((name) => ({ botId: name.toLowerCase(), name }));
    this.listeners.forEach((listener) => listener());
  }

  /** What a room hears now: one lane, or its whole mix. */
  hear(roomId: string, lane?: RoomLane) {
    const room = this.room(roomId);
    return this.context.signalAt(lane ? room[lane] : room.out);
  }

  private room(roomId: string) {
    let room = this.buses.get(roomId);
    if (!room) {
      const out = this.context.createGain();
      out.connect(this.context.destination);
      const lane = () => {
        const gain = this.context.createGain();
        gain.connect(out);
        return gain;
      };
      room = { music: lane(), ambience: lane(), effects: lane(), out };
      this.buses.set(roomId, room);
    }
    return room;
  }
}

function track(id: string, seconds: number, over: Partial<DomainTrack> = {}): DomainTrack & { url: string } {
  return { id, kind: "music", title: id.toUpperCase(), metaTitle: "", fileName: `${id}.ogg`, durationMs: seconds * 1000, role: null, loop: null, energy: null, tags: {}, url: `file:///${id}.ogg`, ...over };
}

const S1: SceneRef = { campaignId: "c", sessionId: "s", sceneId: "s1" };
const S2: SceneRef = { campaignId: "c", sessionId: "s", sceneId: "s2" };
const S3: SceneRef = { campaignId: "c", sessionId: "s", sceneId: "s3" };

let context: FakeAudioContext;
let rooms: FakeRooms;
let data: ShowData;
let director: Director;
let errors: string[];

function makeData(): ShowData {
  return {
    tracks: [
      track("m1", 20),
      track("m2", 20),
      track("m3", 20),
      track("x", 10),
      track("sting", 3, { role: "sting", loop: "yes" }),
      track("bed", 10, { role: "loop_bed" }),
      track("amb1", 30, { kind: "amb" }),
      track("amb2", 30, { kind: "amb" }),
      track("fx1", 2, { kind: "fx" }),
      track("fx2", 2, { kind: "fx" }),
      track("soft", 20, { profile: { fadeIn: { ms: 2000, shape: 10 } } }),
    ],
    playlists: [
      { id: "P", name: "Battle", lane: "music", kind: "manual", trackIds: ["m2", "m3"] },
      { id: "A", name: "Weather", lane: "amb", kind: "manual", trackIds: ["amb1", "amb2"] },
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
            playlistIds: [],
            boardIds: [],
            scenes: [
              { id: "s1", name: "Tavern", music: [{ kind: "track", id: "m1" }, { kind: "playlist", id: "P" }], ambience: { kind: "playlist", id: "A" }, boardIds: [] },
              { id: "s2", name: "Road", music: [{ kind: "track", id: "m3" }], ambience: { kind: "track", id: "amb2" }, boardIds: [] },
              { id: "s3", name: "Ambush", music: [{ kind: "track", id: "m1" }, { kind: "track", id: "sting" }, { kind: "track", id: "m2" }], ambience: null, boardIds: [] },
            ],
          },
        ],
      },
    ],
    profiles: {
      // m1 in the Tavern scene ends at 5 s; m2 in Battle ends at 8 s.
      [placeKey({ kind: "scene", campaignId: "c", sessionId: "s", sceneId: "s1" })]: { m1: { endMs: 5000, after: "next" } },
      [placeKey({ kind: "playlist", playlistId: "P" })]: { m2: { endMs: 8000 } },
    },
    pads: [
      { boardId: "b", padId: "door", trackIds: ["fx1"], order: "random", mode: "oneshot", fadeMs: 1000, volume: 1 },
      { boardId: "b", padId: "rain", trackIds: ["amb1"], order: "random", mode: "toggle", fadeMs: 1000, volume: 1 },
      { boardId: "b", padId: "drone", trackIds: ["bed"], order: "random", mode: "hold", fadeMs: 1000, volume: 1 },
      { boardId: "b", padId: "knock", trackIds: ["fx1"], order: "random", mode: "retrigger", fadeMs: 1000, volume: 1 },
      { boardId: "b", padId: "steps", trackIds: ["fx1", "fx2"], order: "roundrobin", mode: "oneshot", fadeMs: 1000, volume: 1 },
    ],
  };
}

beforeEach(() => {
  context = new FakeAudioContext();
  data = makeData();
  for (const t of data.tracks) {
    context.mediaDurations.set(t.url, t.durationMs / 1000);
  }
  const loader = new SourceLoader({ context, createElement: () => context.createMediaElement(), fetchBytes: async () => null });
  const engine = new PlaybackEngine({ context, scheduler: context.clock, loader });
  rooms = new FakeRooms(context, ["Table", "Whisper"]);
  director = new Director({ engine, rooms, library: staticLibrary(data), random: () => 0 });
  errors = [];
  director.on("error", (message) => errors.push(message));
});

const table = { room: "table" } as const;
const whisper = { room: "whisper" } as const;

async function run(action: CueAction) {
  const outcome = director.run(action);
  await context.flush();
  return outcome;
}

const music = (room = "table") => director.report().find((r) => r.roomId === room)?.music?.trackId ?? null;
const ambience = (room = "table") => director.report().find((r) => r.roomId === room)?.ambience?.trackId ?? null;
const effects = (room = "table") => director.report().find((r) => r.roomId === room)?.effects.map((e) => e.trackId) ?? [];

/** Advance, noting the music track whenever it changes. */
async function listenToMusic(seconds: number, room = "table") {
  const heard: string[] = [];
  for (let t = 0; t < seconds; t += 0.25) {
    await context.advance(0.25);
    const now = music(room);
    if (now && heard[heard.length - 1] !== now) heard.push(now);
  }
  return heard;
}

describe("scenes play their music in order (PLY-10) with their audio profiles (PLY-12)", () => {
  it("starting a scene plays its first track and its ambience in the first room", async () => {
    expect(await run({ type: "startScene", scene: S1 })).toEqual({ ok: true });
    await context.advance(4.5);
    expect(music()).toBe("m1");
    expect(ambience()).toBe("amb1");
    expect(rooms.hear("table", "music")).toBeCloseTo(1);
    expect(rooms.hear("table", "ambience")).toBeCloseTo(1);
    expect(rooms.hear("whisper")).toBe(0);
  });

  it("when a track reaches its End the next step plays: the scene's profile first, then the playlist's", async () => {
    await run({ type: "startScene", scene: S1 });
    const heard = await listenToMusic(36);
    // m1 ends at 5 s (scene), m2 8 s later (playlist), m3 20 s later; then the scene starts again.
    expect(heard).toEqual(["m1", "m2", "m3", "m1"]);
  });

  it("follows each track's End to the second", async () => {
    await run({ type: "startScene", scene: S1 });
    await context.advance(4.8);
    expect(music()).toBe("m1");
    await context.advance(0.5);
    expect(music()).toBe("m2");
    await context.advance(7.7);
    expect(music()).toBe("m2");
    await context.advance(0.6);
    expect(music()).toBe("m3");
  });

  it("ambience loops and keeps playing", async () => {
    await run({ type: "startScene", scene: S1 });
    await context.advance(95);
    expect(ambience()).toBe("amb1");
    expect(rooms.hear("table", "ambience")).toBeCloseTo(1);
  });

  it("a track whose profile says stop stops the music there", async () => {
    data.profiles![placeKey({ kind: "scene", ...S1 })].m1 = { endMs: 5000, after: "stop" };
    await run({ type: "startScene", scene: S1 });
    await context.advance(6);
    expect(music()).toBeNull();
    expect(rooms.hear("table", "music")).toBe(0);
    expect(ambience()).toBe("amb1");
  });

  it("a track whose profile loops keeps looping", async () => {
    data.profiles![placeKey({ kind: "scene", ...S1 })].m1 = { endMs: 5000, loopStartMs: 1000, after: "loop" };
    await run({ type: "startScene", scene: S1 });
    await context.advance(30);
    expect(music()).toBe("m1");
    expect(rooms.hear("table", "music")).toBeCloseTo(1);
  });

  it("the track's fade in is heard in the room", async () => {
    await run({ type: "playTrack", trackId: "soft", target: table, fadeMs: 0 });
    await context.advance(1);
    expect(rooms.hear("table", "music")).toBeCloseTo(fadeInGain(0.5, 10), 2);
  });

  it("Next and Previous follow the sequence, crossfading", async () => {
    data.profiles = {};
    await run({ type: "startScene", scene: S1 });
    await context.advance(4.5); // past the scene's 4 s fade in
    await run({ type: "next", lane: "music", target: table });
    expect(music()).toBe("m2");
    await context.advance(1.5);
    // Halfway through the 3 s crossfade both tracks are heard.
    const voices = director.report()[0].music;
    expect(voices?.trackId).toBe("m2");
    expect(rooms.hear("table", "music")).toBeGreaterThan(0.9);
    await context.advance(2);
    await run({ type: "previous", lane: "music", target: table });
    expect(music()).toBe("m1");
    await run({ type: "previous", lane: "music", target: table });
    expect(music()).toBe("m3");
  });

  it("Next and Previous on the ambience step through its playlist", async () => {
    await run({ type: "startScene", scene: S1 });
    await run({ type: "next", lane: "ambience", target: table });
    expect(ambience()).toBe("amb2");
    await run({ type: "previous", lane: "ambience", target: table });
    expect(ambience()).toBe("amb1");
  });

  it("a scene with an ambience track plays it; a scene without ambience fades it out", async () => {
    await run({ type: "startScene", scene: S2 });
    expect(ambience()).toBe("amb2");
    await run({ type: "startScene", scene: S3 });
    expect(ambience()).toBeNull();
    await context.advance(3.5);
    expect(rooms.hear("table", "ambience")).toBe(0);
  });
});

describe("Now Playing queue and Undo (PLY-1)", () => {
  it("Play now crossfades to an off-script track, then goes back to the scene where it was", async () => {
    await run({ type: "startScene", scene: S1 });
    await context.advance(1);
    await run({ type: "playTrack", trackId: "x", target: table });
    expect(director.report()[0].upNext).toBe("m2");
    const heard = await listenToMusic(12);
    expect(heard).toEqual(["x", "m2"]);
  });

  it("Play next waits for the current track to end, then the sequence goes on", async () => {
    await run({ type: "startScene", scene: S1 });
    await run({ type: "playTrack", trackId: "x", target: table, when: "next" });
    await run({ type: "playTrack", trackId: "m3", target: table, when: "next" });
    expect(director.report()[0].queued.map((q) => q.trackId)).toEqual(["x", "m3"]);
    const heard = await listenToMusic(40);
    expect(heard).toEqual(["m1", "x", "m3", "m2"]);
  });

  it("a shuffled playlist after a track the scene just played does not bring that track straight back", async () => {
    // The wave 4 release run: The abbey ruins plays t13, then "Abbey: eerie" (t13, t14, t21, t42, shuffled). With
    // seed 4 the deal was t14, t13, …: Next went to t14 and up next was t13 again. The scene's seed is 4 here.
    data.tracks.push(track("q1", 20), track("q2", 20), track("q3", 20), track("q4", 20));
    data.playlists.push({ id: "Q", name: "Eerie", lane: "music", kind: "manual", trackIds: ["q1", "q2", "q3", "q4"], order: { shuffle: true, repeat: "off" } });
    data.campaigns[0].sessions[0].scenes.push({ id: "s5", name: "Abbey", music: [{ kind: "track", id: "q1" }, { kind: "playlist", id: "Q" }], ambience: null, boardIds: [] });
    const S5: SceneRef = { campaignId: "c", sessionId: "s", sceneId: "s5" };
    const seeded = new Director({ engine: new PlaybackEngine({ context, scheduler: context.clock, loader: new SourceLoader({ context, createElement: () => context.createMediaElement(), fetchBytes: async () => null }) }), rooms, library: staticLibrary(data), random: () => 4 / 2 ** 31 });
    seeded.run({ type: "startScene", scene: S5 });
    await context.flush();
    seeded.run({ type: "next", lane: "music", target: table });
    await context.flush();
    const now = seeded.report()[0];
    expect(now.music?.trackId).not.toBe("q1");
    expect(now.upNext).not.toBe("q1");
    // q1 still plays in the playlist: after its other tracks.
    const heard = [now.music!.trackId];
    for (let i = 0; i < 3; i++) {
      seeded.run({ type: "next", lane: "music", target: table });
      await context.flush();
      heard.push(seeded.report()[0].music!.trackId);
    }
    expect(heard).toHaveLength(4);
    expect(heard.slice(0, 3)).not.toContain("q1");
    seeded.dispose();
  });

  it("a track picked from a shuffled playlist in a scene plays as that scene's step, wherever the new deal puts it", async () => {
    // Live lists a scene's playlist in one order; the Director deals a fresh shuffle when the track is played, so the
    // step the screen named may now hold another track. The track still plays from the scene (so Next goes on there),
    // not off script.
    data.tracks.push(track("q1", 20), track("q2", 20), track("q3", 20), track("q4", 20));
    data.playlists.push({ id: "Q", name: "Shuffled", lane: "music", kind: "manual", trackIds: ["q1", "q2", "q3", "q4"], order: { shuffle: true, repeat: "off" } });
    data.campaigns[0].sessions[0].scenes.push({ id: "s4", name: "Crypt", music: [{ kind: "track", id: "m1" }, { kind: "playlist", id: "Q" }], ambience: null, boardIds: [] });
    const S4: SceneRef = { campaignId: "c", sessionId: "s", sceneId: "s4" };
    // Every seed is 0 here: the deal of item 1 is shuffledOrder([q1..q4], 0 + 1).
    const listed = ["q1", "q2", "q3", "q4"];
    const dealt = shuffledOrder(listed, 1);
    const moved = listed.find((id, i) => dealt[i] !== id)!;
    await run({ type: "playTrack", trackId: moved, target: table, from: { scene: S4, at: 1 + listed.indexOf(moved) } });
    const now = director.report()[0].music!;
    expect(now.trackId).toBe(moved);
    expect(now.origin).toMatchObject({ kind: "scene", scene: S4, at: 1 + dealt.indexOf(moved) });
  });

  it("Play next with nothing playing plays at once", async () => {
    await run({ type: "playTrack", trackId: "x", target: table, when: "next" });
    expect(music()).toBe("x");
  });

  it("an entry can be removed from the queue", async () => {
    await run({ type: "startScene", scene: S1 });
    await run({ type: "playTrack", trackId: "x", target: table, when: "next" });
    const entryId = director.report()[0].queued[0].entryId;
    expect(await run({ type: "removeQueued", entryId, target: table })).toEqual({ ok: true });
    expect(director.report()[0].queued).toEqual([]);
    expect(await listenToMusic(6)).toEqual(["m1", "m2"]);
  });

  it("Undo of a scene start brings back the music, the ambience, where they were, and the queue", async () => {
    await run({ type: "startScene", scene: S1 });
    await context.advance(7); // m2 has played 2 s
    await run({ type: "playTrack", trackId: "x", target: table, when: "next" });
    await run({ type: "startScene", scene: S2 });
    expect([music(), ambience()]).toEqual(["m3", "amb2"]);
    expect(director.report()[0].queued).toEqual([]);
    await context.advance(2);
    expect(await run({ type: "undoSceneStart" })).toEqual({ ok: true });
    expect([music(), ambience()]).toEqual(["m2", "amb1"]);
    expect(director.report()[0].queued.map((q) => q.trackId)).toEqual(["x"]);
    await context.advance(0.1);
    expect(director.report()[0].music?.positionSeconds).toBeCloseTo(4, 0);
    expect(director.report()[0].ambience?.positionSeconds).toBeCloseTo(9, 0);
    // Undo works once.
    expect((await run({ type: "undoSceneStart" })).ok).toBe(false);
  });
});

describe("cue actions go to rooms (PLY-8)", () => {
  it("a track plays only in the room it names", async () => {
    await run({ type: "playTrack", trackId: "m1", target: whisper });
    await context.advance(3.5);
    expect(music("whisper")).toBe("m1");
    expect(music("table")).toBeNull();
    expect(rooms.hear("whisper", "music")).toBeCloseTo(1);
    expect(rooms.hear("table")).toBe(0);
  });

  it("'all' plays in every room; each room then has its own sequence", async () => {
    await run({ type: "playPlaylist", playlistId: "P", target: "all" });
    expect([music("table"), music("whisper")]).toEqual(["m2", "m2"]);
    await run({ type: "next", lane: "music", target: whisper });
    expect([music("table"), music("whisper")]).toEqual(["m2", "m3"]);
  });

  it("a room that has gone falls back to the first room", async () => {
    await run({ type: "playTrack", trackId: "m1", target: { room: "cellar" } });
    expect(music("table")).toBe("m1");
  });

  it("scenes always start in the first room", async () => {
    rooms.setRooms(["Whisper", "Table"]);
    await run({ type: "startScene", scene: S1 });
    expect(music("whisper")).toBe("m1");
    expect(music("table")).toBeNull();
  });

  it("with no room, nothing plays and the outcome says why", async () => {
    rooms.setRooms([]);
    const outcome = await run({ type: "playTrack", trackId: "m1", target: "all" });
    expect(outcome.ok).toBe(false);
    expect(outcome).toMatchObject({ message: expect.stringMatching(/no room/i) });
  });

  it("a room that leaves goes silent", async () => {
    await run({ type: "playTrack", trackId: "m1", target: whisper });
    await run({ type: "playTrack", trackId: "amb1", target: whisper });
    await context.advance(4);
    rooms.setRooms(["Table"]);
    await context.flush();
    expect(rooms.hear("whisper")).toBe(0);
    expect(director.report().map((r) => r.roomId)).toEqual(["table"]);
  });

  it("fade lane fades one lane of one room", async () => {
    await run({ type: "startScene", scene: S1 });
    await context.advance(4);
    await run({ type: "fadeLane", lane: "music", target: table, fadeMs: 2000 });
    await context.advance(1);
    expect(rooms.hear("table", "music")).toBeCloseTo(0.5, 1);
    await context.advance(1.5);
    expect(music()).toBeNull();
    expect(rooms.hear("table", "music")).toBe(0);
    expect(rooms.hear("table", "ambience")).toBeCloseTo(1);
  });

  it("fade all fades every room; stop all silences at once", async () => {
    await run({ type: "startScene", scene: S1 });
    await run({ type: "playTrack", trackId: "m2", target: whisper });
    await context.advance(4);
    await run({ type: "fadeAll" });
    await context.advance(3.5);
    expect(rooms.hear("table")).toBe(0);
    expect(rooms.hear("whisper")).toBe(0);
    expect([music(), ambience(), music("whisper")]).toEqual([null, null, null]);

    await run({ type: "playTrack", trackId: "m2", target: "all" });
    await run({ type: "firePad", boardId: "b", padId: "rain", target: table });
    await context.advance(3.5);
    await run({ type: "stopAll" });
    expect(rooms.hear("table")).toBe(0);
    expect(rooms.hear("whisper")).toBe(0);
  });

  it("checks actions that come from outside", () => {
    expect(isCueAction({ type: "playTrack", trackId: "m1", target: { room: "table" } })).toBe(true);
    expect(isCueAction({ type: "startScene", scene: S1 })).toBe(true);
    expect(isCueAction({ type: "firePad", boardId: "b", padId: "door", target: "all", phase: "up" })).toBe(true);
    expect(isCueAction({ type: "fadeAll" })).toBe(true);
    expect(isCueAction({ type: "stopPads" })).toBe(true);
    expect(isCueAction({ type: "stopPads", target: { room: "table" }, fadeMs: 300 })).toBe(true);
    expect(isCueAction({ type: "stopPads", target: "everywhere" })).toBe(false);
    expect(isCueAction({ type: "playTrack", trackId: "m1", target: "everywhere" })).toBe(false);
    expect(isCueAction({ type: "playTrack", trackId: "", target: "all" })).toBe(false);
    expect(isCueAction({ type: "fadeLane", lane: "preview", target: "all" })).toBe(false);
    expect(isCueAction({ type: "fadeAll", fadeMs: -1 })).toBe(false);
    expect(isCueAction({ type: "deleteEverything" })).toBe(false);
    expect(isCueAction(null)).toBe(false);
  });

  it("an action the director does not know is refused, not thrown", () => {
    expect(director.run({ type: "warp" } as unknown as CueAction).ok).toBe(false);
  });
});

describe("pads (PLY-8)", () => {
  const fire = (padId: string, phase?: "down" | "up", target: RoomTarget = table) =>
    run({ type: "firePad", boardId: "b", padId, phase, target });

  it("a one-shot pad plays once over the music and ends by itself", async () => {
    await run({ type: "startScene", scene: S1 });
    await fire("door");
    await context.advance(0.5);
    expect(effects()).toEqual(["fx1"]);
    expect(rooms.hear("table", "effects")).toBeCloseTo(1);
    await context.advance(3);
    expect(effects()).toEqual([]);
    expect(music()).toBe("m1");
  });

  it("BUG-20: pressing a pad that plays stops it with a short fade, whatever its play mode", async () => {
    await run({ type: "startScene", scene: S1 });
    for (const pad of ["door", "knock", "rain", "drone"]) {
      await fire(pad, "down");
      await context.advance(0.5);
      expect(effects(), pad).toHaveLength(1);
      await fire(pad, "down");
      // Gone from what sounds at once; silent after a short fade (a toggle loop after its own, 1 s here).
      expect(effects(), pad).toEqual([]);
      await context.advance(1.1);
      expect(rooms.hear("table", "effects"), pad).toBe(0);
      await fire(pad, "up");
    }
    await fire("door");
    await fire("door");
    await context.advance(0.35);
    expect(rooms.hear("table", "effects")).toBe(0);
    // The scene's music went on throughout (m1 ends at 5 s and hands over to the playlist).
    expect(music()).toBe("m2");
  });

  it("BUG-20: Stop pads stops every pad sound in every room and leaves music, ambience and other effects", async () => {
    await run({ type: "startScene", scene: S1 });
    await fire("rain", "down", table);
    await fire("drone", "down", whisper);
    await run({ type: "playTrack", trackId: "fx2", target: table });
    await context.advance(0.5);
    expect(await run({ type: "stopPads" })).toEqual({ ok: true });
    expect(director.report().flatMap((r) => r.effects.filter((e) => e.padKey))).toEqual([]);
    expect(effects()).toEqual(["fx2"]);
    await context.advance(0.5);
    expect(rooms.hear("whisper", "effects")).toBe(0);
    expect([music(), ambience()]).toEqual(["m1", "amb1"]);
  });

  it("a toggle pad starts a loop and the next press fades it out", async () => {
    await fire("rain");
    await context.advance(40);
    expect(effects()).toEqual(["amb1"]);
    await fire("rain");
    await context.advance(1.2);
    expect(effects()).toEqual([]);
    expect(rooms.hear("table", "effects")).toBe(0);
  });

  it("a hold pad plays while held and fades when let go", async () => {
    await fire("drone", "down");
    await context.advance(25);
    expect(effects()).toEqual(["bed"]);
    await fire("drone", "up");
    await context.advance(0.5);
    expect(effects()).toEqual([]);
  });

  it("variants in turn take each sound in order; a press that stops one uses no turn", async () => {
    const heard: string[] = [];
    for (let i = 0; i < 3; i++) {
      await fire("steps");
      heard.push(...effects());
      await context.advance(2.5);
    }
    expect(heard).toEqual(["fx1", "fx2", "fx1"]);
    await fire("steps");
    await fire("steps");
    await context.advance(0.5);
    await fire("steps");
    expect(effects()).toEqual(["fx1"]);
  });

  it("a toggle pad is on or off per room", async () => {
    await fire("rain", "down", table);
    await fire("rain", "down", whisper);
    await fire("rain", "down", table);
    await context.advance(1.2);
    expect([effects("table"), effects("whisper")]).toEqual([[], ["amb1"]]);
  });
});

describe("behaviours (PLY-4)", () => {
  it("a sting in a scene plays once and hands over to the next step", async () => {
    await run({ type: "startScene", scene: S3 });
    await run({ type: "next", lane: "music", target: table });
    expect(music()).toBe("sting");
    const heard = await listenToMusic(5);
    expect(heard).toEqual(["sting", "m2"]);
  });

  it("a sting played off script hands back to the scene", async () => {
    await run({ type: "startScene", scene: S1 });
    await run({ type: "playTrack", trackId: "sting", target: table, fadeMs: 0 });
    expect(await listenToMusic(4)).toEqual(["sting", "m2"]);
  });

  it("a loop bed loops", async () => {
    await run({ type: "playTrack", trackId: "bed", target: table });
    await context.advance(35);
    expect(music()).toBe("bed");
    expect(rooms.hear("table", "music")).toBeCloseTo(1);
  });

  it("an effect track plays once on the effects lane, over the music", async () => {
    await run({ type: "startScene", scene: S1 });
    await context.advance(1);
    await run({ type: "playTrack", trackId: "fx1", target: table });
    expect([music(), effects()]).toEqual(["m1", ["fx1"]]);
    await context.advance(2.5);
    expect(effects()).toEqual([]);
    expect(music()).toBe("m1");
  });
});

describe("problems", () => {
  it("a track that cannot be played is reported and the next one plays", async () => {
    context.failingUrls.add("file:///m1.ogg");
    await run({ type: "startScene", scene: S1 });
    await context.flush();
    expect(errors).toEqual(["Unable to play track: M1"]);
    expect(music()).toBe("m2");
  });

  it("when every track fails, it gives up instead of trying forever", async () => {
    for (const id of ["m1", "m2", "m3"]) context.failingUrls.add(`file:///${id}.ogg`);
    await run({ type: "startScene", scene: S1 });
    for (let i = 0; i < 10; i++) await context.flush();
    expect(music()).toBeNull();
    expect(errors.length).toBeLessThanOrEqual(3);
  });

  it("a track deleted from the library while it is up next is skipped (BUG-11)", async () => {
    await run({ type: "startScene", scene: S1 });
    const pl = data.playlists.find((p) => p.id === "P")!;
    if (pl.kind === "manual") pl.trackIds = ["m3"];
    expect(await listenToMusic(7)).toEqual(["m1", "m3"]);
  });

  it("tells the screen when anything changes", async () => {
    const change = vi.fn();
    director.on("change", change);
    await run({ type: "startScene", scene: S1 });
    expect(change).toHaveBeenCalled();
  });
});

describe("volume normalisation (PLY-15)", () => {
  const at = (id: string) => data.tracks.find((t) => t.id === id)!;
  const report = (room = "table") => director.report().find((r) => r.roomId === room)!;
  beforeEach(() => {
    // At Standard (-18 LUFS): m1 is turned down 6 dB, m2 up 6 dB, m3 up 3 dB; fx1 down 6 dB.
    at("m1").loudness = { lufs: -12, truePeakDb: -2 };
    at("m2").loudness = { lufs: -24, truePeakDb: -10 };
    at("m3").loudness = { lufs: -21, truePeakDb: -10 };
    at("fx1").loudness = { lufs: -12, truePeakDb: -3 };
  });

  it("plays every track as it is while normalising is off, the library's default", async () => {
    await run({ type: "playTrack", trackId: "m1", target: table, fadeMs: 0 });
    await context.advance(0.5);
    expect(report().music?.gainDb).toBe(0);
    expect(rooms.hear("table", "music")).toBeCloseTo(1, 2);
  });

  it("the library's setting evens a track out at its target, and the report says by how much", async () => {
    data.normalise = { on: true, target: "standard" };
    await run({ type: "playTrack", trackId: "m1", target: table, fadeMs: 0 });
    await context.advance(0.5);
    expect(report().music?.gainDb).toBe(-6);
    expect(rooms.hear("table", "music")).toBeCloseTo(0.501, 2);
  });

  it("a playlist's choice applies to the tracks played from it; a track's own choice wins over it", async () => {
    (data.playlists.find((p) => p.id === "P") as { normalise?: string }).normalise = "on";
    at("m3").normalise = "off";
    await run({ type: "playPlaylist", playlistId: "P", target: table, fadeMs: 0 });
    await context.advance(0.5);
    expect(report().music).toMatchObject({ trackId: "m2", gainDb: 6 });
    expect(rooms.hear("table", "music")).toBeCloseTo(1.995, 2);
    await run({ type: "next", lane: "music", target: table, fadeMs: 0 });
    await context.advance(0.5);
    expect(report().music).toMatchObject({ trackId: "m3", gainDb: 0 });
    expect(rooms.hear("table", "music")).toBeCloseTo(1, 2);
  });

  it("a crossfade moves from one track's gain to the next one's", async () => {
    data.normalise = { on: true, target: "standard" };
    await run({ type: "playTrack", trackId: "m1", target: table, fadeMs: 0 });
    await context.advance(0.5);
    await run({ type: "playTrack", trackId: "m2", target: table, fadeMs: 2000 });
    await context.advance(1);
    const between = rooms.hear("table", "music");
    expect(between).toBeGreaterThan(0.4);
    expect(between).toBeLessThan(1.995);
    await context.advance(2);
    expect(rooms.hear("table", "music")).toBeCloseTo(1.995, 2);
  });

  it("effects and pads follow the same settings", async () => {
    data.normalise = { on: true, target: "standard" };
    await run({ type: "firePad", boardId: "b", padId: "door", target: table });
    await context.advance(0.1);
    expect(rooms.hear("table", "effects")).toBeCloseTo(0.501, 2);
  });

  it("what plays follows a change of the settings at once, smoothly", async () => {
    await run({ type: "playTrack", trackId: "m2", target: table, fadeMs: 0 });
    await run({ type: "playTrack", trackId: "amb1", target: table, fadeMs: 0 });
    await context.advance(0.5);
    expect(rooms.hear("table", "music")).toBeCloseTo(1, 2);
    data.normalise = { on: true, target: "loud" };
    director.libraryChanged();
    await context.advance(0.5);
    // Loud (-14 LUFS) would need +10 dB; the true peak (-10 dBTP) allows +9 dB.
    expect(report().music?.gainDb).toBe(9);
    expect(rooms.hear("table", "music")).toBeCloseTo(2.818, 2);
    expect(report().ambience?.gainDb).toBe(0);
  });
});
