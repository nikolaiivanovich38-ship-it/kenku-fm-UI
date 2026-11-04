/**
 * Shows the version-1 schema can hold everything the current player stores
 * (DAT-9 does the real move in the next stream): playlists with ordered
 * tracks {id, url, title}, soundboards with sounds {loop, volume, fadeIn,
 * fadeOut}, and backgrounds by name. Ids are kept; nothing is reinterpreted.
 */
import { afterEach, beforeEach, expect, it } from "vitest";
import type { PlaylistsState } from "../../../player/features/playlists/playlistsSlice";
import type { SoundboardsState } from "../../../player/features/soundboards/soundboardsSlice";
import { makeTestStore } from "../test/testStore";
import { createTracks, getTrack, resolveTrackLocation } from "./tracks";
import { addTracksToPlaylist, createPlaylist, listPlaylistItems, listPlaylists } from "./playlists";
import { addSoundsToBoard, createBoard, listBoardItems, listBoards } from "./boards";

let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  t = makeTestStore();
});
afterEach(() => t.close());

const playlists: PlaylistsState = {
  playlists: {
    byId: {
      p1: { id: "p1", title: "Tavern", background: "tavern", tracks: ["t2", "t1"] },
      p2: { id: "p2", title: "Web", background: "https://example.com/bg.jpg", tracks: ["t3"] },
    },
    allIds: ["p2", "p1"],
  },
  tracks: {
    t1: { id: "t1", url: "/music/a.mp3", title: "Lute" },
    t2: { id: "t2", url: "/music/b.mp3", title: "Crowd" },
    t3: { id: "t3", url: "https://example.com/c.mp3", title: "Stream" },
  },
};

const soundboards: SoundboardsState = {
  soundboards: {
    byId: { b1: { id: "b1", title: "Effects", background: "forest", sounds: ["s1", "s2"] } },
    allIds: ["b1"],
  },
  sounds: {
    s1: { id: "s1", url: "/sfx/door.wav", title: "Door", loop: false, volume: 0.5, fadeIn: 0, fadeOut: 250 },
    s2: { id: "s2", url: "/sfx/rain.wav", title: "Rain", loop: true, volume: 1, fadeIn: 1000, fadeOut: 3000 },
  },
};

it("holds the current playlists and soundboards with ids, order, settings and backgrounds", () => {
  const asTrack = (x: { id: string; url: string; title: string }) =>
    x.url.startsWith("http") ? { id: x.id, title: x.title, url: x.url } : { id: x.id, title: x.title, file: { path: x.url } };
  t.store.change("Import", () => {
    createTracks(t.store, Object.values(playlists.tracks).map(asTrack));
    createTracks(t.store, Object.values(soundboards.sounds).map(asTrack));
    for (const id of playlists.playlists.allIds) {
      const p = playlists.playlists.byId[id];
      createPlaylist(t.store, { id: p.id, title: p.title, background: p.background });
      addTracksToPlaylist(t.store, p.id, p.tracks);
    }
    for (const id of soundboards.soundboards.allIds) {
      const b = soundboards.soundboards.byId[id];
      createBoard(t.store, { id: b.id, title: b.title, background: b.background });
      addSoundsToBoard(
        t.store,
        b.id,
        b.sounds.map((soundId) => {
          const s = soundboards.sounds[soundId];
          return { trackId: s.id, loop: s.loop, volume: s.volume, fadeInMs: s.fadeIn, fadeOutMs: s.fadeOut };
        }),
      );
    }
  });

  expect(listPlaylists(t.store).map((p) => [p.id, p.title, p.background])).toEqual([
    ["p2", "Web", "https://example.com/bg.jpg"],
    ["p1", "Tavern", "tavern"],
  ]);
  expect(listPlaylistItems(t.store, "p1").map((item) => item.kind === "track" && [item.trackId, item.title])).toEqual([
    ["t2", "Crowd"],
    ["t1", "Lute"],
  ]);
  expect(resolveTrackLocation(t.store, getTrack(t.store, "t3")!)).toBe("https://example.com/c.mp3");
  expect(listBoards(t.store).map((b) => [b.id, b.background])).toEqual([["b1", "forest"]]);
  expect(listBoardItems(t.store, "b1")).toEqual([
    expect.objectContaining({ trackId: "s1", title: "Door", loop: false, volume: 0.5, fadeInMs: 0, fadeOutMs: 250 }),
    expect.objectContaining({ trackId: "s2", title: "Rain", loop: true, volume: 1, fadeInMs: 1000, fadeOutMs: 3000 }),
  ]);
});
