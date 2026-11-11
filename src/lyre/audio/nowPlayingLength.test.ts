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
