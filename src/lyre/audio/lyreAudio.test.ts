/**
 * LyreAudio on its real wave 2 parts over the fake audio graph: what each
 * room sends to Discord, what this page's speakers play, what only the game
 * master's headphones hear, and the now-playing state the screens read.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { keyOfPlace, placeKey, shuffledOrder, type Room } from "../../common/domain";
import { padIsOn, type NowPlaying } from "./lyreAudio";
import type { FakeGain } from "../../player/engine/testing/fakeAudio";
import { lyreAudioOnFakes, staticAudioLibrary, testTrack, type AudioTestData } from "./testing/onFakes";

const TAVERN: Room = { botId: "bot-a", name: "Tavern" };
const DUNGEON: Room = { botId: "bot-b", name: "Dungeon" };
const S1 = { campaignId: "c", sessionId: "s", sceneId: "s1" };

function makeData(): AudioTestData {
  return {
    tracks: [
      testTrack("m1", 20),
      testTrack("m2", 20),
      testTrack("m3", 20),
      testTrack("amb1", 30, { kind: "amb" }),
      testTrack("amb2", 30, { kind: "amb" }),
      testTrack("fx1", 2, { kind: "fx" }),
      testTrack("fx2", 2, { kind: "fx" }),
      testTrack("bed", 10, { role: "loop_bed" }),
    ],
    playlists: [
      { id: "P", name: "Battle", lane: "music", kind: "manual", trackIds: ["m2", "m3"] },
      { id: "A", name: "Weather", lane: "amb", kind: "manual", trackIds: ["amb1", "amb2"] },
      { id: "E", name: "Empty", lane: "music", kind: "manual", trackIds: [] },
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
              { id: "s1", name: "Tavern brawl", music: [{ kind: "track", id: "m1" }, { kind: "playlist", id: "P" }], ambience: { kind: "playlist", id: "A" }, boardIds: [] },
            ],
          },
        ],
      },
    ],
    profiles: { [placeKey({ kind: "scene", ...S1 })]: { m1: { endMs: 5000, after: "next" } } },
    pads: [
      { boardId: "b", padId: "door", label: "Door", trackIds: ["fx1"], order: "random", mode: "oneshot", fadeMs: 1000, volume: 1 },
      { boardId: "b", padId: "rain", label: "Rain", trackIds: ["amb1"], order: "random", mode: "toggle", fadeMs: 1000, volume: 1 },
      { boardId: "b", padId: "drone", label: "Drone", trackIds: ["bed"], order: "random", mode: "hold", fadeMs: 1000, volume: 1 },
      { boardId: "b", padId: "knock", label: "Knock", trackIds: ["fx1"], order: "random", mode: "retrigger", fadeMs: 1000, volume: 1 },
      { boardId: "b", padId: "silent", label: "Silent", trackIds: [], order: "random", mode: "oneshot", fadeMs: 1000, volume: 1 },
    ],
  };
}

let rig: ReturnType<typeof lyreAudioOnFakes>;
let announced: string[];
let errors: string[];

beforeEach(() => {
  rig = lyreAudioOnFakes(makeData(), {
    devices: [
      { deviceId: "default", label: "Default" },
      { deviceId: "hp", label: "Headphones" },
    ],
  });
  announced = [];
  errors = [];
  rig.audio.on("announce", (text) => announced.push(text));
  rig.audio.on("error", (message) => errors.push(message));
});

const state = (): NowPlaying => rig.audio.getNowPlaying();
const room = (roomId: string) => state().rooms.find((r) => r.roomId === roomId);
const first = () => state().rooms[0];

/** Two bots in voice channels and a broadcast running. */
function onDiscord() {
  rig.setRooms([TAVERN, DUNGEON]);
  rig.broadcast(true);
}

describe("playing on air (L.play, L.next/L.prev, L.upNext)", () => {
  it("plays a track in the first room, and never on this page's speakers while no bot is in a voice channel (BUG-19)", async () => {
    expect(rig.audio.playTrack("m1")).toEqual({ ok: true });
    await rig.advance(4);
    expect(rig.hearRoom("table")).toBeCloseTo(1);
    expect(rig.hearSpeakers()).toBe(0);
    expect(state().rooms).toHaveLength(1);
    expect(first()).toMatchObject({ roomId: "table", name: "Table", music: { trackId: "m1", title: "M1", paused: false, loading: false, length: 20 } });
    expect(first().music!.position).toBeGreaterThan(3.5);
    expect(announced).toEqual(["Music: M1"]);
  });

  it("puts ambience on the ambience lane and plays an effect over the music", async () => {
    rig.audio.playTrack("m1");
    rig.audio.playTrack("amb1");
    rig.audio.playTrack("fx1");
    await rig.advance(0.5);
    expect(first().music?.trackId).toBe("m1");
    expect(first().ambience?.trackId).toBe("amb1");
    expect(first().effects).toEqual([{ trackId: "fx1", title: "FX1", padKey: null }]);
    expect(announced).toEqual(["Music: M1", "Ambience: AMB1", "Effect: FX1"]);
  });

  it("plays a playlist in order: Next, Previous and Up next follow it", async () => {
    rig.audio.playPlaylist("P");
    await rig.advance(1);
    expect(first().music?.trackId).toBe("m2");
    expect(first().upNext).toEqual({ trackId: "m3", title: "M3" });
    rig.audio.next("music");
    await rig.advance(1);
    expect(first().music?.trackId).toBe("m3");
    rig.audio.previous("music");
    await rig.advance(1);
    expect(first().music?.trackId).toBe("m2");
    expect(announced).toEqual(["Music: Battle", "Music: M3", "Music: M2"]);
  });

  it("queues with Play next and removes from the queue", async () => {
    rig.audio.playTrack("m1");
    rig.audio.playTrack("m2", { when: "next" });
    await rig.advance(0.5);
    expect(first().queued).toEqual([{ entryId: expect.any(String), trackId: "m2", title: "M2" }]);
    expect(first().upNext?.trackId).toBe("m2");
    rig.audio.removeQueued(first().queued[0].entryId);
    expect(first().queued).toEqual([]);
  });

  it("starts a scene in the first room with its ambience, and Undo brings back what played before", async () => {
    rig.audio.playTrack("m3");
    await rig.advance(1);
    expect(rig.audio.startScene(S1)).toEqual({ ok: true });
    await rig.advance(5);
    expect(first().music).toMatchObject({ trackId: "m1", origin: { kind: "scene", at: 0 } });
    expect(first().ambience?.trackId).toBe("amb1");
    expect(state().canUndo).toBe(true);
    expect(announced).toContain("Scene: Tavern brawl");
    rig.audio.undoSceneStart();
    await rig.advance(2);
    expect(first().music?.trackId).toBe("m3");
    expect(state().canUndo).toBe(false);
  });

  it("says plainly what went wrong, once, as an error event", () => {
    expect(rig.audio.playTrack("gone")).toEqual({ ok: false, message: "That track is no longer in the library." });
    rig.audio.next("music");
    rig.audio.firePad("b", "silent");
    expect(errors).toEqual(["That track is no longer in the library.", "There is nothing to move on to.", "Silent has no sound: give it one on its board."]);
  });

  it("reports a file that cannot play", async () => {
    rig.context.failingUrls.add("file:///m1.ogg");
    rig.audio.playTrack("m1");
    await rig.advance(1);
    expect(errors).toContain("Unable to play track: M1");
  });
});

describe("rooms: each room's sound goes only to its own bot (roomsFor, sceneRoom)", () => {
  it("plays in the room a screen names, in every room, and scenes always in the first room", async () => {
    onDiscord();
    rig.audio.playTrack("m1", { target: { room: "bot-b" } });
    await rig.advance(4);
    expect(rig.hearRoom("bot-b")).toBeCloseTo(1);
    expect(rig.hearRoom("bot-a")).toBe(0);
    expect(room("bot-b")?.music?.trackId).toBe("m1");
    expect(room("bot-a")?.music).toBeNull();
    expect(announced).toEqual(["Music in Dungeon: M1"]);

    rig.audio.playTrack("amb1", { target: "all" });
    await rig.advance(4);
    expect(room("bot-a")?.ambience?.trackId).toBe("amb1");
    expect(room("bot-b")?.ambience?.trackId).toBe("amb1");

    rig.audio.startScene(S1);
    await rig.advance(1);
    expect(room("bot-a")?.music?.trackId).toBe("m1");
    expect(room("bot-b")?.music?.trackId).toBe("m1");
  });

  it("names the rooms after their voice channels, the first room first", () => {
    onDiscord();
    expect(state().rooms.map(({ roomId, name }) => ({ roomId, name }))).toEqual([
      { roomId: "bot-a", name: "Tavern" },
      { roomId: "bot-b", name: "Dungeon" },
    ]);
    expect(state().broadcasting).toBe(true);
  });

  it("keeps the music started at the table playing when the first bot joins a voice channel", async () => {
    rig.audio.playTrack("m1");
    await rig.advance(2);
    rig.setRooms([TAVERN]);
    rig.broadcast(true);
    await rig.advance(2);
    expect(first()).toMatchObject({ roomId: "bot-a", music: { trackId: "m1" } });
    expect(rig.hearRoom("bot-a")).toBeCloseTo(1);
    // "table" and the bot's own id both mean that room now.
    rig.audio.next("music", { room: "bot-a" });
    expect(errors).toEqual(["There is nothing to move on to."]);
    expect(rig.audio.togglePause("music", { room: "table" })).toEqual({ ok: true });
    expect(first().music?.paused).toBe(true);
  });

  it('"table" still means the first room after another bot comes first in the list', async () => {
    rig.audio.playTrack("m1");
    rig.setRooms([TAVERN]);
    rig.setRooms([DUNGEON, TAVERN]);
    rig.broadcast(true);
    rig.audio.playTrack("m2");
    await rig.advance(4);
    expect(room("bot-b")?.music?.trackId).toBe("m2");
    expect(room("bot-a")?.music?.trackId).toBe("m1");
    expect(rig.hearRoom("bot-a")).toBeCloseTo(1);
    expect(rig.hearRoom("bot-b")).toBeCloseTo(1);
  });

  it("stops a room's sound when its bot leaves, and the fresh table starts silent", async () => {
    onDiscord();
    rig.audio.playTrack("m1", { target: "all" });
    await rig.advance(2);
    rig.setRooms([TAVERN]);
    await rig.advance(1);
    expect(state().rooms.map((r) => r.roomId)).toEqual(["bot-a"]);
    expect(first().music?.trackId).toBe("m1");
    rig.setRooms([]);
    rig.broadcast(false);
    await rig.advance(1);
    expect(state().rooms).toEqual([expect.objectContaining({ roomId: "table", music: null })]);
    expect(rig.hearSpeakers()).toBe(0);
    expect(rig.engine.voices()).toEqual([]);
  });
});

describe("BUG-19: what goes to the players is heard only through Discord, never on this page's speakers", () => {
  it("keeps the speakers silent before, during and after a broadcast, while the room goes on to its bot", async () => {
    rig.audio.playTrack("m1");
    await rig.advance(4);
    expect(rig.hearSpeakers()).toBe(0);
    rig.setRooms([TAVERN]);
    rig.broadcast(true);
    expect(rig.hearSpeakers()).toBe(0);
    expect(rig.hearRoom("bot-a")).toBeCloseTo(1);
    expect(state().broadcasting).toBe(true);
    rig.broadcast(false);
    rig.setRooms([]);
    rig.audio.playTrack("m2");
    await rig.advance(4);
    expect(state().broadcasting).toBe(false);
    expect(rig.hearRoom("table")).toBeCloseTo(1);
    expect(rig.hearSpeakers()).toBe(0);
  });

  it("keeps every room's graph running into a silent node, so what plays with no bot still moves on (Chromium pulls only what leads somewhere)", async () => {
    const keepAlive = rig.keepAlive;
    expect(rig.context.reaches(rig.mixer.output("table") as FakeGain, keepAlive)).toBe(true);
    expect(rig.context.reaches(keepAlive, rig.context.destination)).toBe(true);
    rig.setRooms([TAVERN, DUNGEON]);
    expect(rig.context.reaches(rig.mixer.output("bot-a") as FakeGain, keepAlive)).toBe(true);
    expect(rig.context.reaches(rig.mixer.output("bot-b") as FakeGain, keepAlive)).toBe(true);
    rig.audio.playTrack("m1");
    await rig.advance(4);
    expect(rig.hearSpeakers()).toBe(0);
  });

  it("plays no room on the speakers, first or other, nor its effects and pads", async () => {
    rig.setRooms([TAVERN, DUNGEON]);
    rig.audio.playTrack("m1");
    rig.audio.playTrack("m2", { target: { room: "bot-b" } });
    rig.audio.firePad("b", "rain");
    rig.audio.testChime("bot-a");
    await rig.advance(1);
    expect(rig.hearRoom("bot-a")).toBeGreaterThan(0);
    expect(rig.hearSpeakers()).toBe(0);
  });
});

describe("pause, fades and stops (L.pauseLane, L.stopLane, L.fadeAll, L.stopAll)", () => {
  it("pauses a lane and carries on from the same place", async () => {
    rig.audio.playTrack("m1");
    await rig.advance(4);
    rig.audio.togglePause("music");
    const at = first().music!.position!;
    expect(first().music?.paused).toBe(true);
    await rig.advance(3);
    expect(first().music!.position).toBeCloseTo(at, 1);
    rig.audio.togglePause("music");
    await rig.advance(1);
    expect(first().music?.paused).toBe(false);
    expect(first().music!.position).toBeGreaterThan(at + 0.5);
    expect(rig.audio.togglePause("ambience")).toEqual({ ok: false, message: "No ambience is playing." });
  });

  it("fades one lane out over the time given", async () => {
    rig.audio.playTrack("m1");
    rig.audio.playTrack("amb1");
    await rig.advance(4);
    rig.audio.stopLane("music", { fadeMs: 2000 });
    expect(first().music).toBeNull();
    await rig.advance(1);
    expect(rig.hearRoom("table")).toBeGreaterThan(1);
    await rig.advance(1.5);
    expect(rig.hearRoom("table")).toBeCloseTo(1);
    expect(first().ambience?.trackId).toBe("amb1");
  });

  it("fades everything in every room, or stops it all at once", async () => {
    onDiscord();
    rig.audio.playTrack("m1", { target: "all" });
    rig.audio.playTrack("amb1");
    await rig.advance(4);
    rig.audio.fadeAll(1000);
    await rig.advance(1.5);
    expect(rig.hearRoom("bot-a") + rig.hearRoom("bot-b")).toBe(0);
    rig.audio.playTrack("m2", { target: "all" });
    await rig.advance(4);
    rig.audio.stopAll();
    expect(rig.hearRoom("bot-a") + rig.hearRoom("bot-b")).toBe(0);
    expect(state().rooms.every((r) => r.music === null && r.ambience === null)).toBe(true);
    expect(announced).toEqual(expect.arrayContaining(["Fading everything out", "Everything stopped"]));
  });
});

describe("pads (L.firePad): one-shot, toggle, hold, retrigger", () => {
  it("BUG-20: a second press stops a one-shot or restart pad that plays, rather than playing it again", async () => {
    rig.audio.firePad("b", "door");
    await rig.advance(0.2);
    expect(padIsOn(state(), "b", "door")).toBe(true);
    rig.audio.firePad("b", "door");
    expect(padIsOn(state(), "b", "door")).toBe(false);
    rig.audio.firePad("b", "knock");
    await rig.advance(0.2);
    rig.audio.firePad("b", "knock");
    await rig.advance(0.5);
    expect(first().effects).toEqual([]);
    expect(rig.hearRoom("table")).toBe(0);
  });

  it("BUG-20: Stop pads stops every pad in every room, says so, and leaves the music and an Off script effect", async () => {
    onDiscord();
    rig.audio.playTrack("m1");
    rig.audio.firePad("b", "rain", "down", { room: "bot-a" });
    rig.audio.firePad("b", "drone", "down", { room: "bot-b" });
    rig.audio.playTrack("fx2", { target: { room: "bot-b" } });
    await rig.advance(0.5);
    expect(rig.audio.stopPads()).toEqual({ ok: true });
    expect(announced).toContain("Pads stopped");
    expect(state().rooms.flatMap((r) => r.effects.map((e) => e.padKey ?? e.trackId))).toEqual(["fx2"]);
    await rig.advance(3);
    expect(room("bot-a")!.music?.trackId).toBe("m1");
    expect(rig.hearRoom("bot-a")).toBeCloseTo(1);
    expect(rig.hearRoom("bot-b")).toBe(0);
  });

  it("toggle turns on, then off; hold plays while held", async () => {
    rig.audio.firePad("b", "rain");
    await rig.advance(0.5);
    expect(padIsOn(state(), "b", "rain")).toBe(true);
    rig.audio.firePad("b", "rain");
    await rig.advance(1.5);
    expect(padIsOn(state(), "b", "rain")).toBe(false);

    rig.audio.firePad("b", "drone", "down");
    await rig.advance(12);
    expect(padIsOn(state(), "b", "drone")).toBe(true);
    rig.audio.firePad("b", "drone", "up");
    await rig.advance(1);
    expect(padIsOn(state(), "b", "drone")).toBe(false);
  });

  it("SFX-12: tries a pad as it plays in Live, in the headphones only: toggle on and off, hold while held, one-shot once", async () => {
    onDiscord();
    expect(rig.audio.tryPad("b", "rain")).toEqual({ ok: true });
    await rig.advance(40);
    // A toggle loop goes round (the bed is 30 s long) until pressed again, and no room hears it.
    expect(state().preview).toMatchObject({ key: "pad:b/rain", kind: "pad", padKey: "b/rain" });
    expect(rig.hearPreview()).toBeGreaterThan(0.5);
    expect(rig.hearRoom("bot-a")).toBe(0);
    expect(padIsOn(state(), "b", "rain")).toBe(false);
    rig.audio.tryPad("b", "rain");
    await rig.advance(0.5);
    expect(state().preview).toBeNull();

    rig.audio.tryPad("b", "drone", "down");
    await rig.advance(12);
    expect(state().preview).toMatchObject({ key: "pad:b/drone" });
    rig.audio.tryPad("b", "drone", "up");
    await rig.advance(0.5);
    expect(state().preview).toBeNull();

    rig.audio.tryPad("b", "door");
    await rig.advance(0.5);
    expect(state().preview).toMatchObject({ key: "pad:b/door" });
    await rig.advance(3);
    expect(state().preview).toBeNull();
    // BUG-20: as in Live, a second press while it plays stops it.
    rig.audio.tryPad("b", "door");
    await rig.advance(0.5);
    rig.audio.tryPad("b", "door");
    expect(state().preview).toBeNull();
    expect(rig.audio.tryPad("b", "silent")).toEqual({ ok: false, message: "Silent has no sound: give it one on its board." });
    // A pad that is gone altogether says so.
    expect(rig.audio.tryPad("b", "gone")).toEqual({ ok: false, message: "That pad is no longer on its board." });
  });

  it("plays a pad only in the room it is sent to", async () => {
    onDiscord();
    rig.audio.firePad("b", "rain", "down", { room: "bot-b" });
    await rig.advance(1);
    expect(padIsOn(state(), "b", "rain", "bot-b")).toBe(true);
    expect(padIsOn(state(), "b", "rain", "bot-a")).toBe(false);
    expect(rig.hearRoom("bot-a")).toBe(0);
  });
});

describe("preview: the game master's headphones only, never on air (PRV-1)", () => {
  it("previews a track in the preview's own output, never in a room or on the speakers", async () => {
    onDiscord();
    rig.audio.playTrack("m1");
    await rig.advance(4);
    rig.audio.previewTrack("m2");
    await rig.advance(1);
    expect(rig.hearPreview()).toBeCloseTo(1);
    expect(rig.hearRoom("bot-a")).toBeCloseTo(1);
    expect(rig.hearRoom("bot-b")).toBe(0);
    expect(state().preview).toMatchObject({ key: "m2", label: "M2" });
    expect(rig.audio.isPreviewing("m2")).toBe(true);
    // The preview's nodes live in another audio context: nothing joins them to the rooms.
    expect(rig.context.allNodes.some((node) => rig.previewContext.allNodes.includes(node as never))).toBe(false);
    expect(announced).toContain("Previewing in your headphones: M2");
  });

  it("previews the file Find missing files found as the track, from its own address (security review w4, Should 5)", async () => {
    const found = "file:///E:/Music/Scores/07%20The%20Storm.flac";
    rig.previewContext.mediaDurations.set(found, 60);
    rig.audio.previewTrack("m2", { file: found, from: "Find missing files" });
    await rig.advance(1);
    expect(rig.previewContext.elements.map((e) => e.src)).toContain(found);
    expect(state().preview).toMatchObject({ key: "m2", label: "M2", from: "Find missing files" });
    expect(rig.hearPreview()).toBeCloseTo(1);
  });

  it("previews on the speakers' context never, even outside a broadcast", async () => {
    rig.audio.previewTrack("m2");
    await rig.advance(1);
    expect(rig.hearPreview()).toBeCloseTo(1);
    expect(rig.hearSpeakers()).toBe(0);
  });

  it("pressing Preview again stops it; another item replaces it", async () => {
    rig.audio.previewTrack("m2");
    rig.audio.previewTrack("m3");
    expect(state().preview?.key).toBe("m3");
    rig.audio.previewTrack("m3");
    expect(state().preview).toBeNull();
    expect(announced).toContain("Preview stopped");
  });

  it("previews a track from a point with its audio profile, quietly, and says where it is (the Audio profile screen)", async () => {
    const positions: { key: string; positionMs: number }[] = [];
    rig.audio.on("preview-position", (at) => positions.push(at));
    const profile = { startMs: 2000, endMs: 6000, after: "loop" as const, loopStartMs: 3000, loopCrossfadeMs: 0, fadeIn: { ms: 0, shape: 0 }, fadeOut: { ms: 0, shape: 0 }, markers: [] as { atMs: number; label: string }[] };
    expect(rig.audio.previewTrack("m2", { startAtMs: 4000, profile, quiet: true })).toEqual({ ok: true });
    await rig.advance(1);
    expect(state().preview).toMatchObject({ key: "m2", label: "M2" });
    expect(positions[positions.length - 1].key).toBe("m2");
    expect(positions[positions.length - 1].positionMs).toBeGreaterThan(4500);
    expect(positions[positions.length - 1].positionMs).toBeLessThan(5500);
    // It loops back to Loop start at End, as the profile says.
    await rig.advance(2);
    expect(positions[positions.length - 1].positionMs).toBeGreaterThanOrEqual(3000);
    expect(positions[positions.length - 1].positionMs).toBeLessThan(5000);
    expect(announced.filter((text) => text.includes("review"))).toEqual([]);
    // From a point, it starts again rather than stopping (a Preview button would stop it).
    rig.audio.previewTrack("m2", { startAtMs: 2000, profile, quiet: true });
    expect(state().preview?.key).toBe("m2");
  });

  it("BUG-22: a file shorter than Lyre thinks: the last 10 s before End play its last 10 s, with sound, and say its real length", async () => {
    // The file is 20 s long (the rig's media), but the library still has 180 s for it (the file was replaced).
    rig.data.tracks.find((t) => t.id === "m2")!.durationMs = 180_000;
    const profile = { startMs: 0, endMs: 180_000, after: "loop" as const, loopStartMs: 60_000, loopCrossfadeMs: 0, fadeIn: { ms: 0, shape: 50 }, fadeOut: { ms: 0, shape: 50 }, markers: [] as { atMs: number; label: string }[] };
    rig.audio.previewTrack("m2", { startAtMs: 170_000, profile, quiet: true });
    await rig.advance(1);
    expect(rig.hearPreview()).toBeCloseTo(1);
    expect(state().preview!.position!).toBeGreaterThan(10);
    expect(state().preview!.position!).toBeLessThan(12);
    expect(state().preview!.length).toBe(20);
    await rig.advance(10);
    // Loop start is past the file's end: nothing to loop back to, so it plays to the end once and stops.
    expect(state().preview).toBeNull();
  });

  it("a quiet preview that cannot play sends preview-failed with why (review w3-polish 1)", async () => {
    const failed: { key: string; message: string }[] = [];
    rig.audio.on("preview-failed", (at) => failed.push(at));
    rig.previewContext.failingUrls.add("file:///m2.ogg");
    rig.audio.previewTrack("m2", { startAtMs: 0, quiet: true });
    await rig.advance(0.5);
    expect(failed).toEqual([{ key: "m2", message: "Could not play the preview of M2." }]);
    expect(announced.filter((t) => t.includes("review"))).toEqual([]);
  });

  it("previews a playlist's first track and a pad's sound, and says when a playlist is empty", async () => {
    rig.audio.previewPlaylist("P");
    expect(state().preview).toMatchObject({ key: "pl:P", label: "Battle: M2" });
    rig.audio.previewPad("b", "door");
    expect(state().preview).toMatchObject({ key: "pad:b/door", label: "Door (pad)" });
    await rig.advance(0.5);
    expect(rig.hearPreview()).toBeCloseTo(1);
    rig.audio.stopPreview();
    expect(state().preview).toBeNull();
    expect(rig.audio.previewPlaylist("E")).toEqual({ ok: false, message: "This playlist has no tracks yet" });
    expect(errors).toEqual(["This playlist has no tracks yet"]);
  });

  it("lists sound devices and plays the preview on the one chosen", async () => {
    expect(await rig.audio.previewDevices()).toEqual([
      { deviceId: "", label: "Default sound device" },
      { deviceId: "hp", label: "Headphones" },
    ]);
    await rig.audio.choosePreviewDevice("hp");
    expect(rig.sinkIds.slice(-1)).toEqual(["hp"]);
    expect(state().previewDevice).toEqual({ deviceId: "hp", label: "Headphones", message: null });
    rig.setDevices([]);
    await rig.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state().previewDevice?.message).toBe("Headphones is not connected, so the preview plays on the default sound device.");
    expect(announced).toContain("Headphones is not connected, so the preview plays on the default sound device.");
  });
});

describe("now-playing state and its events", () => {
  it("keeps the same object until something changes, and tells subscribers once per change", async () => {
    const seen: NowPlaying[] = [];
    const stop = rig.audio.subscribe(() => seen.push(rig.audio.getNowPlaying()));
    const before = state();
    expect(state()).toBe(before);
    rig.audio.playTrack("m1");
    expect(state()).not.toBe(before);
    await Promise.resolve();
    expect(seen).toHaveLength(1);
    stop();
  });

  it("updates positions about once a second while something plays and someone listens", async () => {
    let calls = 0;
    const stop = rig.audio.subscribe(() => calls++);
    rig.audio.playTrack("m1");
    await rig.advance(1);
    const after = calls;
    await rig.advance(3);
    expect(calls - after).toBeGreaterThanOrEqual(3);
    stop();
    const stopped = calls;
    await rig.advance(3);
    expect(calls).toBe(stopped);
  });

  it("keeps the playing track and the next one read ahead", async () => {
    rig.audio.playPlaylist("P");
    await rig.advance(0.5);
    expect(rig.wanted[rig.wanted.length - 1].map((request) => request.trackId)).toEqual(["m2", "m3"]);
  });

  it("stops everything and lets go when disposed", async () => {
    rig.audio.playTrack("m1");
    rig.audio.previewTrack("m2");
    await rig.advance(2);
    await rig.audio.dispose();
    expect(rig.hearSpeakers()).toBe(0);
    expect(rig.hearPreview()).toBe(0);
    expect(rig.engine.voices()).toEqual([]);
    expect(rig.audio.playTrack("m1")).toEqual({ ok: false, message: "Lyre's sound has stopped. Reopen the Lyre tab." });
  });
});

describe("wave 4: the now-playing shape every screen reads, play order and the preview's controls (UX-16, PLY-13)", () => {
  const SESSION = { kind: "session" as const, campaignId: "c", sessionId: "s" };

  it("each room's music and ambience say where they play from and their playlist's play order there", async () => {
    rig.audio.startScene(S1);
    await rig.advance(1);
    expect(first().music).toMatchObject({ trackId: "m1", place: { kind: "scene", ...S1 }, playOrder: null, paused: false });
    expect(first().ambience).toMatchObject({ trackId: "amb1", playlistId: "A", place: { kind: "scene", ...S1 }, playOrder: { shuffle: false, repeat: "all" } });
    rig.audio.next("music");
    await rig.advance(1);
    expect(first().music).toMatchObject({ trackId: "m2", playlistId: "P", place: { kind: "scene", ...S1 }, playOrder: { shuffle: false, repeat: "off" } });
    rig.audio.togglePause("music");
    expect(first().music?.paused).toBe(true);
    rig.audio.playTrack("m3");
    await rig.advance(1);
    expect(first().music).toMatchObject({ trackId: "m3", place: null, playOrder: null });
  });

  it("Repeat one plays the same track again when it ends, until Next", async () => {
    rig.data.playlists[0].order = { shuffle: false, repeat: "one" };
    rig.audio.playPlaylist("P");
    await rig.advance(21);
    expect(first().music).toMatchObject({ trackId: "m2", playOrder: { shuffle: false, repeat: "one" } });
    expect(first().music!.position).toBeLessThan(5);
    rig.audio.next("music");
    await rig.advance(1);
    expect(first().music?.trackId).toBe("m3");
  });

  it("Shuffle deals the playlist by a seed from the host's random numbers; Up next shows that order", async () => {
    rig.data.playlists[0].order = { shuffle: true, repeat: "all" };
    const dealt = shuffledOrder(["m2", "m3"], 0);
    rig.audio.playPlaylist("P");
    await rig.advance(1);
    expect(first().music?.trackId).toBe(dealt[0]);
    expect(first().upNext?.trackId).toBe(dealt[1]);
  });

  it("a playlist played from a session's list plays in the session's order there, and says so", async () => {
    rig.data.playOrders = { [keyOfPlace(SESSION)]: { P: { shuffle: false, repeat: "off" } } };
    rig.audio.playPlaylist("P", { place: SESSION });
    await rig.advance(1);
    expect(first().music).toMatchObject({ trackId: "m2", place: SESSION, playOrder: { shuffle: false, repeat: "off" } });
    await rig.advance(20);
    expect(first().music?.trackId).toBe("m3");
    await rig.advance(21);
    // No repeat: after its last track the playlist stops.
    expect(first().music).toBeNull();
  });

  it("the preview says what it is, where it was started from, its time, whether it is paused and the headphone volume", async () => {
    rig.audio.previewTrack("m2", { from: "the session planner" });
    await rig.advance(2);
    expect(state().preview).toMatchObject({ key: "m2", label: "M2", kind: "track", trackId: "m2", playlistId: null, padKey: null, from: "the session planner", paused: false, length: 20, volume: 1 });
    expect(state().preview!.position).toBeGreaterThan(1.5);
    rig.audio.previewPad("b", "door", { from: "the pad board Combat" });
    expect(state().preview).toMatchObject({ kind: "pad", padKey: "b/door", trackId: "fx1", from: "the pad board Combat" });
    rig.audio.previewPlaylist("P");
    expect(state().preview).toMatchObject({ kind: "playlist", playlistId: "P", trackId: "m2", from: null });
  });

  it("pauses and carries on the preview, and keeps the headphone volume from one preview to the next", async () => {
    rig.audio.previewTrack("m2");
    await rig.advance(1);
    expect(rig.audio.togglePreviewPause()).toEqual({ ok: true });
    await rig.advance(0.5);
    expect(state().preview?.paused).toBe(true);
    expect(rig.hearPreview()).toBeCloseTo(0);
    const at = state().preview!.position!;
    await rig.advance(2);
    expect(state().preview!.position).toBeCloseTo(at, 1);
    rig.audio.togglePreviewPause();
    await rig.advance(0.5);
    expect(state().preview?.paused).toBe(false);
    expect(rig.hearPreview()).toBeCloseTo(1);
    rig.audio.setPreviewVolume(0.5);
    expect(state().preview?.volume).toBe(0.5);
    await rig.advance(0.25);
    expect(rig.hearPreview()).toBeCloseTo(0.5);
    rig.audio.previewTrack("m3");
    await rig.advance(1);
    expect(state().preview).toMatchObject({ key: "m3", volume: 0.5 });
    expect(rig.hearPreview()).toBeCloseTo(0.5);
    rig.audio.setPreviewVolume(7);
    expect(state().preview?.volume).toBe(1);
    rig.audio.stopPreview();
    expect(rig.audio.togglePreviewPause()).toEqual({ ok: false, message: "Nothing is previewing." });
  });
});

describe("w4-outputs: the Outputs screen's Test chime, in one room only", () => {
  it("plays a short chime into that room's effects and nowhere else, and stops by itself", async () => {
    onDiscord();
    expect(rig.audio.testChime("bot-b")).toEqual({ ok: true });
    await rig.advance(0.25);
    expect(rig.hearRoom("bot-b")).toBeGreaterThan(0);
    expect(rig.hearRoom("bot-a")).toBe(0);
    expect(rig.hearPreview()).toBe(0);
    await rig.advance(2);
    expect(rig.hearRoom("bot-b")).toBe(0);
  });

  it("refuses a room that is not in a voice channel, in plain words", () => {
    onDiscord();
    expect(rig.audio.testChime("bot-gone")).toEqual({ ok: false, message: "That room is not in a voice channel now." });
    expect(errors).toEqual(["That room is not in a voice channel now."]);
    expect(rig.hearRoom("bot-a")).toBe(0);
  });
});

// --- w6-rooms ---
describe("OUT-10: a level meter per room (roomLevel)", () => {
  it("reads how loud each room is now, from what that room sends to Discord, and nothing of the others", async () => {
    onDiscord();
    expect(rig.audio.roomLevel("bot-a")).toBe(0);
    rig.audio.testChime("bot-b");
    await rig.advance(0.25);
    expect(rig.audio.roomLevel("bot-b")).toBeGreaterThan(0);
    expect(rig.audio.roomLevel("bot-b")).toBeLessThanOrEqual(1);
    expect(rig.audio.roomLevel("bot-a")).toBe(0);
    await rig.advance(2);
    expect(rig.audio.roomLevel("bot-b")).toBe(0);
  });

  it("is 0 for a room that is not there, and lets go of a room's meter when its bot leaves", async () => {
    onDiscord();
    expect(rig.audio.roomLevel("bot-gone")).toBe(0);
    rig.audio.roomLevel("bot-b");
    expect(rig.meters.open).toBe(1);
    rig.setRooms([{ botId: "bot-a", name: "Table" }]);
    expect(rig.meters.open).toBe(0);
  });

  it("lets go of every meter when the page goes", async () => {
    onDiscord();
    rig.audio.roomLevel("bot-a");
    rig.audio.roomLevel("bot-b");
    await rig.audio.dispose();
    expect(rig.meters.open).toBe(0);
    expect(rig.audio.roomLevel("bot-a")).toBe(0);
  });
});

describe("volume normalisation: what the players hear and what the game master checks (PLY-15)", () => {
  const at = (id: string) => rig.data.tracks.find((t) => t.id === id)!;
  beforeEach(() => {
    // At Standard (-18 LUFS): m1 down 6 dB, m2 up 6 dB, fx1 down 6 dB.
    at("m1").loudness = { lufs: -12, truePeakDb: -2 };
    at("m2").loudness = { lufs: -24, truePeakDb: -10 };
    at("fx1").loudness = { lufs: -12, truePeakDb: -3 };
    rig.data.normalise = { on: true, target: "standard" };
  });

  it("each room's music and ambience say the gain they play at (gainDb), and the room hears it", async () => {
    rig.audio.playTrack("m1");
    rig.audio.playTrack("amb1");
    await rig.advance(4);
    expect(first().music).toMatchObject({ trackId: "m1", gainDb: -6 });
    expect(first().ambience).toMatchObject({ trackId: "amb1", gainDb: 0 });
    expect(rig.hearRoom("table")).toBeCloseTo(0.501 + 1, 1);
  });

  it("a preview hears the same gain as the players would: a track alone, from a playlist, and a pad's sound", async () => {
    (rig.data.playlists.find((p) => p.id === "P") as { normalise?: string }).normalise = "off";
    rig.audio.previewTrack("m2");
    await rig.advance(1);
    expect(state().preview).toMatchObject({ key: "m2", gainDb: 6 });
    expect(rig.hearPreview()).toBeCloseTo(1.995, 2);
    // Previewed from the playlist (its row, or a track on its page): the playlist's Off applies, as on air.
    rig.audio.previewTrack("m2", { playlistId: "P" });
    await rig.advance(1);
    expect(state().preview).toMatchObject({ gainDb: 0 });
    rig.audio.previewPlaylist("P");
    await rig.advance(1);
    expect(state().preview).toMatchObject({ kind: "playlist", gainDb: 0 });
    rig.audio.previewPad("b", "door");
    await rig.advance(0.2);
    expect(state().preview).toMatchObject({ kind: "pad", gainDb: -6 });
    expect(rig.hearPreview()).toBeCloseTo(0.501, 2);
  });

  it("follows a change of the library at once: what plays and the preview move to their new gains", async () => {
    rig.data.normalise = { on: false, target: "standard" };
    rig.audio.playTrack("m1");
    rig.audio.previewTrack("m2");
    await rig.advance(4);
    expect(first().music?.gainDb).toBe(0);
    expect(state().preview?.gainDb).toBe(0);
    rig.data.normalise = { on: true, target: "standard" };
    rig.audio.setLibrary(staticAudioLibrary(rig.data));
    await rig.advance(0.5);
    expect(first().music?.gainDb).toBe(-6);
    expect(rig.hearRoom("table")).toBeCloseTo(0.501, 2);
    expect(state().preview?.gainDb).toBe(6);
    expect(rig.hearPreview()).toBeCloseTo(1.995, 2);
  });
});
