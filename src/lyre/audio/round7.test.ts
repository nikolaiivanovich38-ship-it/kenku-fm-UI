/**
 * Round 7 in the audio host, on the real engine over the fake audio graph: one model for every trigger (PLY-8: a
 * scene's own start and a pad's steps, a scene that moves on by itself), Follow with (SHW-3), Pick up where it stopped
 * (PLY-4), play from a marker and the mix-out hand-over (DAT-3), what played per room (PLY-1), the crossfade setting,
 * read-ahead of what follows (PLY-11) and the preview's device and ear (PRV-2).
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { CueStep, DomainScene } from "../../common/domain";
import type { NowPlaying } from "./lyreAudio";
import { lyreAudioOnFakes, testTrack, type AudioTestData } from "./testing/onFakes";

const S1 = { campaignId: "c", sessionId: "s", sceneId: "s1" };
const S2 = { campaignId: "c", sessionId: "s", sceneId: "s2" };
const S3 = { campaignId: "c", sessionId: "s", sceneId: "s3" };

function scene(id: string, music: DomainScene["music"], over: Partial<DomainScene> = {}): DomainScene {
  return { id, name: id.toUpperCase(), music, ambience: null, boardIds: [], ...over };
}

function makeData(): AudioTestData {
  return {
    // Music is 20 seconds long; the ambience 30 s; the effect 2 s.
    tracks: [
      ...["m1", "m2", "m3", "m4", "m5", "m6"].map((id) => testTrack(id, 20)),
      testTrack("long", 60, { resume: true }),
      testTrack("st", 10, { role: "sting", profile: { after: "loop" } }),
      testTrack("a1", 30, { kind: "amb" }),
      testTrack("fx1", 2, { kind: "fx", role: "effect" }),
    ],
    playlists: [
      { id: "P", name: "Battle", lane: "music", kind: "manual", trackIds: ["m2", "m3"] },
      { id: "Q", name: "Quiet", lane: "music", kind: "manual", trackIds: ["m4", "m5"] },
    ],
    pads: [
      { boardId: "b", padId: "bell", label: "Abbey bell", trackIds: ["fx1"], order: "random", mode: "oneshot", fadeMs: 500, volume: 1 },
      { boardId: "b", padId: "storm", label: "Storm", trackIds: ["fx1"], order: "random", mode: "toggle", fadeMs: 500, volume: 1, steps: [{ do: "sound" }, { do: "fade", level: 0.3, ms: 1000 }] },
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
              scene("s1", [{ kind: "track", id: "m1" }, { kind: "playlist", id: "P" }], { ambience: { kind: "track", id: "a1" } }),
              scene("s2", [{ kind: "track", id: "m6" }]),
              scene("s3", [{ kind: "track", id: "m1" }, { kind: "playlist", id: "P" }]),
            ],
          },
        ],
      },
    ],
  };
}

let rig: ReturnType<typeof lyreAudioOnFakes>;
let errors: string[];
const state = (): NowPlaying => rig.audio.getNowPlaying();
const first = () => state().rooms[0];
const playing = () => first().music?.trackId ?? null;
const s3 = () => rig.data.campaigns[0].sessions[0].scenes[2];
const setSteps = (steps: CueStep[], movesOn?: DomainScene["movesOn"]) => Object.assign(s3(), { steps, ...(movesOn ? { movesOn } : {}) });

beforeEach(() => {
  rig = lyreAudioOnFakes(makeData());
  errors = [];
  rig.audio.on("error", (message) => errors.push(message));
});

describe("PLY-8: a scene's own start runs its steps in order", () => {
  it("plays the music from the item and marker it names, fades it, waits, fires a pad and shows a board", async () => {
    const boards: string[] = [];
    rig.audio.on("show-board", (at) => boards.push(at.boardId));
    setSteps([
      { do: "music", what: { kind: "playlist", id: "P" }, how: "crossfade", upNext: "replace", fromMs: 5000 },
      { do: "fade", level: 0.3, ms: 1000 },
      { do: "wait", ms: 2000 },
      { do: "pad", boardId: "b", padId: "bell" },
      { do: "board", boardId: "b" },
    ]);
    expect(rig.audio.startScene(S3)).toEqual({ ok: true });
    await rig.advance(1.5);
    expect(playing()).toBe("m2");
    expect(first().music?.position).toBeGreaterThanOrEqual(6);
    expect(first().music?.level).toBeCloseTo(0.3, 1);
    expect(first().effects).toEqual([]);
    await rig.advance(1);
    expect(first().effects.map((e) => e.padKey)).toEqual(["b/bell"]);
    expect(boards).toEqual(["b"]);
    expect(errors).toEqual([]);
  });

  it("a start without a music or ambience step leaves them silent; Up next and Stop steps act on the room's list", async () => {
    rig.audio.startScene(S1);
    await rig.advance(1);
    expect(first().ambience?.trackId).toBe("a1");
    setSteps([{ do: "stop", what: "music" }]);
    rig.audio.startScene(S3);
    await rig.advance(5);
    expect(first().music).toBeNull();
    expect(first().ambience).toBeNull();
    // A silent room plays what is added to the queue at once, as Add to queue does.
    setSteps([{ do: "play", what: { kind: "track", id: "m5" }, how: "cut", upNext: "addToQueue", fromMs: null }]);
    rig.audio.startScene(S3);
    await rig.advance(1);
    expect(playing()).toBe("m5");
    rig.audio.startScene(S1);
    await rig.advance(1);
    setSteps([
      { do: "music", what: { kind: "track", id: "m1" }, how: "cut", upNext: "replace", fromMs: null },
      { do: "play", what: { kind: "track", id: "m5" }, how: "cut", upNext: "playNext", fromMs: null },
      { do: "stop", what: "ambience" },
    ]);
    rig.audio.startScene(S3);
    await rig.advance(1);
    expect(playing()).toBe("m1");
    expect(first().upNextList[0]).toMatchObject({ kind: "playNext", trackIds: ["m5"] });
    expect(first().ambience).toBeNull();
  });

  it("a step starts another scene; a scene starting itself stops after a few rounds", async () => {
    const started: string[] = [];
    rig.audio.on("scene-started", (at) => started.push(`${at.scene.sceneId}:${at.by}`));
    setSteps([{ do: "scene", scene: S2 }]);
    rig.audio.startScene(S3);
    await rig.advance(1);
    expect(playing()).toBe("m6");
    expect(started).toEqual(["s3:press", "s2:step"]);
    setSteps([{ do: "scene", scene: S3 }]);
    rig.audio.startScene(S3);
    await rig.advance(1);
    expect(errors.some((e) => /starts itself|over and over/i.test(e))).toBe(true);
  });

  it("Undo of the scene start brings back what played before, and stops its waiting steps", async () => {
    rig.audio.startScene(S2);
    await rig.advance(1);
    setSteps([{ do: "music", what: { kind: "track", id: "m1" }, how: "cut", upNext: "replace", fromMs: null }, { do: "wait", ms: 3000 }, { do: "pad", boardId: "b", padId: "bell" }]);
    rig.audio.startScene(S3);
    await rig.advance(1);
    expect(rig.audio.undoSceneStart()).toEqual({ ok: true });
    await rig.advance(4);
    expect(playing()).toBe("m6");
    expect(first().effects).toEqual([]);
  });
});

describe("PLY-8: a pad's own steps", () => {
  it("a press runs them; pressing a sounding toggle pad only stops it", async () => {
    rig.audio.startScene(S1);
    await rig.advance(1);
    rig.audio.firePad("b", "storm");
    await rig.advance(1.5);
    expect(first().effects.map((e) => e.padKey)).toEqual(["b/storm"]);
    expect(first().music?.level).toBeCloseTo(0.3, 1);
    rig.audio.firePad("b", "storm");
    await rig.advance(1);
    expect(first().effects).toEqual([]);
  });
});

describe("PLY-8 Then: a scene that moves on by itself", () => {
  it("after a time", async () => {
    setSteps(undefined as never, { when: "after", ms: 5000 });
    delete (s3() as { steps?: unknown }).steps;
    rig.audio.startScene(S3);
    await rig.advance(4);
    expect(playing()).toBe("m1");
    await rig.advance(2);
    // s3 is the last scene: nothing comes after it, so it stays.
    expect(playing()).toBe("m1");
    Object.assign(rig.data.campaigns[0].sessions[0].scenes[0], { movesOn: { when: "after", ms: 3000 } });
    rig.audio.startScene(S1);
    await rig.advance(3.5);
    expect(playing()).toBe("m6");
  });

  it("when its music ends: the scene's list plays once, then the next scene starts", async () => {
    Object.assign(rig.data.campaigns[0].sessions[0].scenes[0], { movesOn: { when: "musicEnds" } });
    rig.audio.startScene(S1);
    await rig.advance(1);
    await rig.advance(60);
    expect(playing()).toBe("m6");
  });
});

describe("SHW-3: Follow with", () => {
  it("plays what it names when the track ends with nothing waiting", async () => {
    rig.data.tracks[0].follow = { kind: "playlist", id: "Q" };
    rig.audio.playTrack("m1");
    await rig.advance(21);
    expect(playing()).toBe("m4");
  });

  it("gives way to Play next and to a scene's own next item", async () => {
    rig.data.tracks[0].follow = { kind: "track", id: "m6" };
    rig.audio.playTrack("m1");
    await rig.advance(1);
    rig.audio.playNext({ kind: "track", trackId: "m3" });
    await rig.advance(20);
    expect(playing()).toBe("m3");
    rig.audio.startScene(S1);
    await rig.advance(21);
    expect(playing()).toBe("m2");
  });

  it("is read ahead while the track plays (PLY-11)", async () => {
    rig.data.tracks[0].follow = { kind: "track", id: "m6" };
    rig.audio.playTrack("m1");
    await rig.advance(1);
    expect(rig.wanted[rig.wanted.length - 1]?.map((m) => m.trackId)).toContain("m6");
  });
});

describe("DAT-3, PLY-4: where a track starts", () => {
  it("plays on air from a marker, now and from Play next", async () => {
    rig.audio.playTrack("m1", { fromMs: 5000 });
    await rig.advance(1);
    expect(first().music?.position).toBeGreaterThanOrEqual(5.5);
    rig.audio.playNext({ kind: "track", trackId: "m2", fromMs: 12_000 });
    await rig.advance(15);
    expect(playing()).toBe("m2");
    expect(first().music?.position).toBeGreaterThanOrEqual(12);
  });

  it("picks up where it stopped this evening", async () => {
    rig.audio.playTrack("long");
    await rig.advance(10);
    rig.audio.playTrack("m1");
    await rig.advance(3);
    rig.audio.playTrack("long");
    await rig.advance(1);
    expect(first().music?.position).toBeGreaterThanOrEqual(10);
    expect(first().music?.position).toBeLessThan(14);
  });

  it("hands over at the mix-out marker, or when the track ends", async () => {
    rig.data.tracks[0].profile = { markers: [{ atMs: 8000, label: "Low swell", mix: true }] };
    rig.audio.playTrack("m1");
    await rig.advance(1);
    // A pad that only cues the next track, at the playing track's mix-out marker (8 s), then one when it ends.
    rig.data.pads?.push(
      { boardId: "b", padId: "mix", label: "Mix", trackIds: [], order: "random", mode: "oneshot", fadeMs: 0, volume: 1, steps: [{ do: "play", what: { kind: "track", id: "m4" }, how: "mixOut", upNext: "replace", fromMs: null }] },
      { boardId: "b", padId: "end", label: "End", trackIds: [], order: "random", mode: "oneshot", fadeMs: 0, volume: 1, steps: [{ do: "play", what: { kind: "track", id: "m5" }, how: "trackEnds", upNext: "replace", fromMs: null }] },
    );
    expect(rig.audio.firePad("b", "mix")).toEqual({ ok: true });
    await rig.advance(5);
    expect(playing()).toBe("m1");
    await rig.advance(3);
    expect(playing()).toBe("m4");
    rig.audio.firePad("b", "end");
    await rig.advance(5);
    expect(playing()).toBe("m4");
    await rig.advance(17);
    expect(playing()).toBe("m5");
  });
});

describe("PLY-4: tracks behave as tagged", () => {
  it("a sting plays once, even when its profile says loop", async () => {
    rig.audio.playTrack("st");
    await rig.advance(5);
    expect(playing()).toBe("st");
    await rig.advance(7);
    expect(playing()).toBeNull();
  });
});

describe("PLY-1: what played in each room this evening", () => {
  it("is newest first, with where each came from for Play again", async () => {
    rig.audio.startScene(S1);
    await rig.advance(1);
    rig.audio.next("music");
    await rig.advance(1);
    rig.audio.playTrack("m6");
    await rig.advance(1);
    const played = first().played;
    expect(played.map((p) => p.trackId)).toEqual(["m6", "m2", "m1"]);
    expect(played[1]).toMatchObject({ title: "M2", from: { scene: S1, at: 1 } });
    expect(played[0].from).toBeNull();
    expect(typeof played[0].at).toBe("number");
    // Play again plays it the same way.
    rig.audio.playTrack(played[1].trackId, { from: played[1].from ?? undefined });
    await rig.advance(1);
    expect(first().music).toMatchObject({ trackId: "m2", origin: { kind: "scene" } });
  });
});

describe("PRV-2: the preview's device and ear", () => {
  it("uses the device chosen in Settings and says which ear has the preview", async () => {
    rig = lyreAudioOnFakes(makeData(), { devices: [{ deviceId: "hs", label: "Headset" }] });
    await rig.audio.setAudioDevices({ airDevice: "", previewDevice: "hs", split: true, previewEar: "right" });
    expect(rig.sinkIds[rig.sinkIds.length - 1]).toBe("hs");
    expect(state().previewEar).toBe("right");
    await rig.audio.setAudioDevices({ airDevice: "", previewDevice: "", split: false, previewEar: "right" });
    expect(state().previewEar).toBe("both");
  });
});

describe("CR-1 (review 0.5.0): Stop all and Fade all cancel everything waiting to start", () => {
  const s1 = () => rig.data.campaigns[0].sessions[0].scenes[0];
  const addDelayedPad = () =>
    rig.data.pads?.push({
      boardId: "b",
      padId: "delayed",
      label: "Delayed",
      trackIds: ["fx1"],
      order: "random",
      mode: "oneshot",
      fadeMs: 500,
      volume: 1,
      steps: [{ do: "sound" }, { do: "wait", ms: 3000 }, { do: "play", what: { kind: "track", id: "m5" }, how: "cut", upNext: "replace", fromMs: null }],
    });

  for (const how of ["stopAll", "fadeAll"] as const) {
    it(`${how}: a scene set to move on after a time stays stopped`, async () => {
      Object.assign(s1(), { movesOn: { when: "after", ms: 5000 } });
      rig.audio.startScene(S1);
      await rig.advance(1);
      expect(playing()).toBe("m1");
      rig.audio[how]();
      await rig.advance(10);
      expect(playing()).toBeNull();
    });

    it(`${how}: a scene's steps after a wait do not run`, async () => {
      setSteps([{ do: "music", what: { kind: "track", id: "m1" }, how: "cut", upNext: "replace", fromMs: null }, { do: "wait", ms: 3000 }, { do: "play", what: { kind: "track", id: "m4" }, how: "cut", upNext: "replace", fromMs: null }, { do: "pad", boardId: "b", padId: "bell" }]);
      rig.audio.startScene(S3);
      await rig.advance(1);
      rig.audio[how]();
      await rig.advance(5);
      expect(playing()).toBeNull();
      expect(first().effects).toEqual([]);
    });

    it(`${how}: a pad's steps after a wait do not run`, async () => {
      addDelayedPad();
      rig.audio.startScene(S1);
      await rig.advance(1);
      rig.audio.firePad("b", "delayed");
      await rig.advance(0.5);
      rig.audio[how]();
      await rig.advance(5);
      expect(playing()).toBeNull();
    });

    it(`${how}: a scene's music waiting for the loop to end does not come in`, async () => {
      rig.data.tracks.push(testTrack("lp", 20, { profile: { after: "loop" } }));
      rig.audio.playTrack("lp");
      await rig.advance(2);
      setSteps([{ do: "music", what: { kind: "track", id: "m1" }, how: "loopEnds", upNext: "replace", fromMs: null }]);
      rig.audio.startScene(S3);
      await rig.advance(1);
      rig.audio[how]();
      await rig.advance(25);
      expect(playing()).toBeNull();
    });

    it(`${how}: ends the scene's Undo, so nothing waiting comes back with it`, async () => {
      Object.assign(s1(), { movesOn: { when: "after", ms: 5000 } });
      rig.audio.startScene(S2);
      await rig.advance(1);
      rig.audio.startScene(S1);
      await rig.advance(1);
      rig.audio[how]();
      expect(state().canUndo).toBe(false);
      expect(rig.audio.undoSceneStart().ok).toBe(false);
      await rig.advance(10);
      expect(playing()).toBeNull();
    });
  }

  it("what the game master starts afterwards runs as usual, its own waits included", async () => {
    addDelayedPad();
    rig.audio.firePad("b", "delayed");
    await rig.advance(0.5);
    rig.audio.stopAll();
    rig.audio.firePad("b", "delayed");
    await rig.advance(3.5);
    expect(playing()).toBe("m5");
  });
});
