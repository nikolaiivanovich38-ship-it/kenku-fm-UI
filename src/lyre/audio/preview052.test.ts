/**
 * 0.5.2, from Nik's play test (14 Nov): the preview plays as the players would hear it.
 * - 9: a track's "Followed by" plays when the track ends in a preview too, not only on air.
 * - 30: previewing a playlist plays the whole playlist with its shuffle and repeat, and the place's play order.
 * - 37: Repeat one in a preview goes round by the track's loop setting and crossfade.
 * - 28, 24: changePreview applies the Audio profile to the playing preview at once, and lets it go on as the players
 *   would hear it when the screen is left.
 * - 52: a track whose file is longer than the library thinks plays all of it, and Save diagnostics hears why a track
 *   ended early.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { keyOfPlace, type AudioProfile } from "../../common/domain";
import type { NowPlaying } from "./lyreAudio";
import { lyreAudioOnFakes, testTrack, type AudioTestData } from "./testing/onFakes";

const SESSION = { kind: "session" as const, campaignId: "c", sessionId: "s" };

function makeData(): AudioTestData {
  return {
    tracks: [
      testTrack("m1", 10),
      testTrack("m2", 10),
      testTrack("m3", 10),
      testTrack("m4", 10),
      testTrack("lw", 10, { loop: "yes", profile: { after: "next", loopStartMs: 2000 } }),
      testTrack("amb1", 30, { kind: "amb" }),
    ],
    playlists: [
      { id: "P", name: "Battle", lane: "music", kind: "manual", trackIds: ["m1", "m2", "m3"] },
      { id: "Q", name: "Quiet", lane: "music", kind: "manual", trackIds: ["m4"] },
    ],
    campaigns: [],
  };
}

let rig: ReturnType<typeof lyreAudioOnFakes>;
const state = (): NowPlaying => rig.audio.getNowPlaying();
const previewing = () => state().preview?.trackId ?? null;

/** Plays on, noting each track the preview plays. */
async function previewsThrough(seconds: number): Promise<(string | null)[]> {
  const heard: (string | null)[] = [previewing()];
  for (let t = 0; t < seconds; t += 0.25) {
    await rig.advance(0.25);
    const now = previewing();
    if (now !== heard[heard.length - 1]) heard.push(now);
  }
  return heard;
}

beforeEach(() => {
  rig = lyreAudioOnFakes(makeData());
});

describe("9: Followed by plays in a preview when the track ends", () => {
  it("a track followed by a track: the preview goes on to it, without a moment of nothing previewing", async () => {
    rig.data.tracks.find((t) => t.id === "m1")!.follow = { kind: "track", id: "m2" };
    rig.audio.previewTrack("m1");
    expect(await previewsThrough(11)).toEqual(["m1", "m2"]);
  });

  it("a track followed by a playlist: the preview plays that playlist", async () => {
    rig.data.tracks.find((t) => t.id === "m4")!.follow = { kind: "playlist", id: "P" };
    rig.audio.previewTrack("m4");
    await rig.advance(10.5);
    expect(state().preview).toMatchObject({ key: "pl:P", trackId: "m1" });
  });

  it("a preview stopped by a press does not go on to what follows", async () => {
    rig.data.tracks.find((t) => t.id === "m1")!.follow = { kind: "track", id: "m2" };
    rig.audio.previewTrack("m1");
    await rig.advance(2);
    rig.audio.stopPreview();
    await rig.advance(10);
    expect(state().preview).toBeNull();
  });

  it("the Audio profile's own preview does not go on by itself while that screen holds it", async () => {
    rig.data.tracks.find((t) => t.id === "m1")!.follow = { kind: "track", id: "m2" };
    const profile: AudioProfile = { startMs: 0, endMs: 3000, after: "next", loopStartMs: 0, loopCrossfadeMs: 0, fadeIn: { ms: 0, shape: 50 }, fadeOut: { ms: 0, shape: 50 }, markers: [] };
    rig.audio.previewTrack("m1", { startAtMs: 0, profile, quiet: true });
    await rig.advance(4);
    expect(state().preview).toBeNull();
  });
});

describe("30: previewing a playlist plays it as its play order says", () => {
  it("plays every track in order, then (Repeat all, as a playlist on its own) its first again", async () => {
    rig.audio.previewPlaylist("P");
    expect(state().preview).toMatchObject({ key: "pl:P", label: "Battle: M1", playlistId: "P" });
    expect(await previewsThrough(31)).toEqual(["m1", "m2", "m3", "m1"]);
    expect(state().preview?.key).toBe("pl:P");
  });

  it("with its own order no repeat, it stops after its last track", async () => {
    rig.data.playlists[0].order = { shuffle: false, repeat: "off" };
    rig.audio.previewPlaylist("P");
    expect(await previewsThrough(31)).toEqual(["m1", "m2", "m3", null]);
  });

  it("shuffled, it plays every track once in a dealt order, each round dealt again", async () => {
    rig.data.playlists[0].order = { shuffle: true, repeat: "all" };
    rig.audio.previewPlaylist("P");
    const heard = (await previewsThrough(59.5)).filter((t): t is string => t !== null);
    expect([...heard.slice(0, 3)].sort()).toEqual(["m1", "m2", "m3"]);
    expect([...heard.slice(3, 6)].sort()).toEqual(["m1", "m2", "m3"]);
    for (let i = 1; i < heard.length; i++) expect(heard[i]).not.toBe(heard[i - 1]);
  });

  it("previewed in a session, the session's own play order and track order apply", async () => {
    rig.data.playOrders = { [keyOfPlace(SESSION)]: { P: { shuffle: false, repeat: "off" } } };
    rig.data.trackOrders = { [keyOfPlace(SESSION)]: { P: ["m3", "m1", "m2"] } };
    rig.audio.previewPlaylist("P", { place: SESSION });
    expect(await previewsThrough(31)).toEqual(["m3", "m1", "m2", null]);
  });

  it("Preview again on the playlist stops it, whichever of its tracks plays", async () => {
    rig.audio.previewPlaylist("P");
    await rig.advance(11);
    expect(previewing()).toBe("m2");
    expect(rig.audio.isPreviewing("pl:P")).toBe(true);
    rig.audio.previewPlaylist("P");
    expect(state().preview).toBeNull();
  });

  it("37: with Repeat one, a track that loops well goes back to its Loop start at End, in the same play", async () => {
    rig.data.playlists.push({ id: "L", name: "Loops", lane: "music", kind: "manual", trackIds: ["lw", "m1"], order: { shuffle: false, repeat: "one" } });
    rig.audio.previewPlaylist("L");
    await rig.advance(10.5);
    expect(previewing()).toBe("lw");
    expect(state().preview!.position!).toBeGreaterThan(2);
    expect(state().preview!.position!).toBeLessThan(3);
  });
});

describe("28, 24: the Audio profile and the playing preview", () => {
  const profile = (over: Partial<AudioProfile>): AudioProfile => ({ startMs: 0, endMs: 10_000, after: "next", loopStartMs: 0, loopCrossfadeMs: 0, fadeIn: { ms: 0, shape: 50 }, fadeOut: { ms: 0, shape: 50 }, markers: [], ...over });

  it("28: a change to the profile reaches the preview at once, from where it is, without starting it again", async () => {
    rig.audio.previewTrack("m1", { startAtMs: 0, profile: profile({ after: "loop" }), quiet: true });
    await rig.advance(3);
    const opened = rig.previewContext.elements.length;
    expect(rig.audio.changePreview("m1", profile({ endMs: 4000, after: "next" }))).toEqual({ ok: true });
    expect(state().preview!.position!).toBeGreaterThan(2.9);
    await rig.advance(1.5);
    expect(state().preview).toBeNull();
    expect(rig.previewContext.elements.length).toBe(opened);
  });

  it("28: nothing changes when another track previews, and nothing is said", async () => {
    const errors: string[] = [];
    rig.audio.on("error", (m) => errors.push(m));
    rig.audio.previewTrack("m2");
    expect(rig.audio.changePreview("m1", profile({ endMs: 4000 }))).toEqual({ ok: false, message: "That track is not previewing." });
    expect(errors).toEqual([]);
  });

  it("24: let go (the Audio profile was left), the preview plays on as the players would hear it, and what follows it plays", async () => {
    rig.data.tracks.find((t) => t.id === "m1")!.follow = { kind: "track", id: "m2" };
    // The Audio profile plays round and round from Start to End until it is stopped (BUG-17).
    rig.audio.previewTrack("m1", { startAtMs: 0, profile: profile({ after: "loop" }), quiet: true });
    await rig.advance(3);
    expect(rig.audio.changePreview("m1")).toEqual({ ok: true });
    expect(previewing()).toBe("m1");
    expect(await previewsThrough(8)).toEqual(["m1", "m2"]);
  });
});

describe("52: a file longer than the library thinks, and why a track ended early", () => {
  it("a preview of a track the library thinks is 3 s long plays its whole 10 s file", async () => {
    rig.data.tracks.find((t) => t.id === "m1")!.durationMs = 3000;
    rig.audio.previewTrack("m1");
    await rig.advance(9);
    expect(previewing()).toBe("m1");
    await rig.advance(1.5);
    expect(state().preview).toBeNull();
  });

  it("logs a line for Save diagnostics when a track's file ran out long before the library's length, on air and in a preview", async () => {
    rig.data.tracks.find((t) => t.id === "m1")!.durationMs = 60_000;
    rig.audio.playTrack("m1");
    await rig.advance(11);
    rig.audio.previewTrack("m1");
    await rig.advance(11);
    expect(rig.logged).toEqual([
      expect.stringMatching(/^Lyre playback: "M1" \(m1\.ogg, streamed\) in Table, music ended early, at 0:10\.0: the file ran out; the file says 0:10\.0, the library has 1:00\.0\.$/),
      expect.stringMatching(/^Lyre playback: "M1" \(m1\.ogg, streamed\) in preview ended early/),
    ]);
  });

  it("logs a line when a track's file is longer than the library says (it plays all of it)", async () => {
    rig.data.tracks.find((t) => t.id === "m1")!.durationMs = 3000;
    rig.audio.playTrack("m1");
    await rig.advance(11);
    expect(rig.logged).toEqual([expect.stringContaining("played to the end of its file at 0:10.0; the file says 0:10.0, the library has 0:03.0, so the library's length is wrong.")]);
  });

  it("logs nothing for tracks that play as long as the library says", async () => {
    rig.audio.playTrack("m1");
    rig.audio.previewPlaylist("P");
    await rig.advance(25);
    expect(rig.logged).toEqual([]);
  });
});
