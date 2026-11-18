/**
 * UX-16: the length the Now playing bar shows ("0:12 / 3:57") is the track's length as the library knows it, the same
 * as every list shows, so the bar and the lists agree. (A track whose length the library does not know shows the
 * length of the file as it plays.)
 */
import { describe, expect, it } from "vitest";

import { lyreAudioOnFakes, testTrack, type AudioTestData } from "./testing/onFakes";

describe("the length of what plays", () => {
  it("is the library's length of the track, even when the file that plays is shorter or longer", async () => {
    const data: AudioTestData = { tracks: [testTrack("m1", 237)], playlists: [], campaigns: [] };
    const rig = lyreAudioOnFakes(data);
    // The file that plays is 20 s long (a stand-in, or a file changed since the library read it).
    rig.context.mediaDurations.set("file:///m1.ogg", 20);
    rig.audio.playTrack("m1");
    await rig.advance(4);
    expect(rig.audio.getNowPlaying().rooms[0].music?.length).toBe(237);
  });
});

describe("round 8 click-through #6: one length for a track everywhere", () => {
  it("a preview shows the library's length too, as on air and every list, whatever length the file that plays has", async () => {
    // Crypt ambush track 1: 5:01 in the Playlists list, 6:00 in the Now playing bar while previewed.
    const data: AudioTestData = { tracks: [testTrack("t31", 301)], playlists: [{ id: "C", name: "Crypt ambush", lane: "music", kind: "manual", trackIds: ["t31"] }], campaigns: [] };
    const rig = lyreAudioOnFakes(data);
    rig.previewContext.mediaDurations.set("file:///t31.ogg", 360);
    rig.audio.previewTrack("t31");
    expect(rig.audio.getNowPlaying().preview?.length).toBe(301);
    await rig.advance(2);
    expect(rig.audio.getNowPlaying().preview?.length).toBe(301);
    rig.audio.previewPlaylist("C");
    await rig.advance(2);
    expect(rig.audio.getNowPlaying().preview?.length).toBe(301);
  });

  it("a track the library has no length for shows its file's length", async () => {
    const data: AudioTestData = { tracks: [testTrack("t0", 0)], playlists: [], campaigns: [] };
    const rig = lyreAudioOnFakes(data);
    rig.previewContext.mediaDurations.set("file:///t0.ogg", 42);
    rig.audio.previewTrack("t0");
    await rig.advance(1);
    expect(rig.audio.getNowPlaying().preview?.length).toBe(42);
  });
});
