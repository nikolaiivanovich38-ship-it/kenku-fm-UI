/**
 * FND-16 (0.5.1, Nik's answer of 11 Nov): before the old player goes, whatever was added to it after Lyre's first
 * import comes across too, once: new playlists and soundboards whole, and new files in the playlists and soundboards
 * that were already brought in. Matched by the old ids the first import kept (and by file), so nothing is doubled.
 */
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlaylistsState } from "../../../player/features/playlists/playlistsSlice";
import type { SoundboardsState } from "../../../player/features/soundboards/soundboardsSlice";
import { encodeFilePath } from "../../../renderer/common/drop";
import { openLibrary, type Library } from "../library";
import { makeClock, makeTempFolder } from "../test/helpers";
import { listTracks, resolveTrackLocation, updateTrack } from "../repo/tracks";
import { deletePlaylist, listPlaylistItems, listPlaylists } from "../repo/playlists";
import { getBoardLayout, listBoards } from "../repo/boards";
import { bringInOldPlayer, catchUpLegacyLibrary, importLegacyLibrary, LEGACY_CATCH_UP_JOB } from "./legacy";
import { writeAudio } from "./testing/fixtures";

let temp: ReturnType<typeof makeTempFolder>;
let library: Library;
let music: string;
const clock = makeClock(new Date(2026, 10, 11, 20, 0, 0).getTime());

beforeEach(() => {
  temp = makeTempFolder("lyre-catch-up-");
  music = path.join(temp.folder, "Music");
  library = openLibrary({ folder: path.join(temp.folder, "library"), now: clock.now });
});
afterEach(() => {
  library.close();
  temp.cleanup();
});

type OldState = { playlists: PlaylistsState; soundboards: SoundboardsState };
const file = (relative: string) => encodeFilePath(writeAudio(music, relative));

/** The old player as Lyre's first start (0.3.0) found it. */
function firstState(): OldState {
  return {
    playlists: {
      playlists: {
        byId: { "pl-combat": { id: "pl-combat", title: "Combat", background: "battle", tracks: ["t-boss", "t-harbour"] } },
        allIds: ["pl-combat"],
      },
      tracks: {
        "t-boss": { id: "t-boss", url: file("Scores/boss.flac"), title: "Boss" },
        "t-harbour": { id: "t-harbour", url: file("Scores/harbour.flac"), title: "Harbour" },
      },
    },
    soundboards: {
      soundboards: { byId: { "sb-weather": { id: "sb-weather", title: "Weather", background: "", sounds: ["s-rain"] } }, allIds: ["sb-weather"] },
      sounds: { "s-rain": { id: "s-rain", url: file("Ambience/rain.ogg"), title: "Rain", loop: true, volume: 0.6, fadeIn: 0, fadeOut: 0 } },
    },
  };
}

/** The old player now: Nik kept using it after Lyre's first start. */
function laterState(): OldState {
  const state = firstState();
  // A new file in a playlist Lyre already has, and one of its files again under another title.
  state.playlists.tracks["t-new-combat"] = { id: "t-new-combat", url: file("Scores/new boss.flac"), title: "New boss" };
  state.playlists.tracks["t-boss-again"] = { id: "t-boss-again", url: file("Scores/boss.flac"), title: "Boss again" };
  state.playlists.playlists.byId["pl-combat"].tracks.push("t-new-combat", "t-boss-again");
  // A new playlist with a file Lyre has and a new one.
  state.playlists.playlists.byId["pl-travel"] = { id: "pl-travel", title: "Travel", background: "", tracks: ["t-harbour-2", "t-road"] };
  state.playlists.playlists.allIds.push("pl-travel");
  state.playlists.tracks["t-harbour-2"] = { id: "t-harbour-2", url: file("Scores/harbour.flac"), title: "Harbour at dusk" };
  state.playlists.tracks["t-road"] = { id: "t-road", url: file("Scores/road.flac"), title: "The road" };
  // A new sound on a board Lyre has, and a new board.
  state.soundboards.sounds["s-thunder"] = { id: "s-thunder", url: file("Effects/thunder.wav"), title: "Thunder", loop: false, volume: 1, fadeIn: 0, fadeOut: 0 };
  state.soundboards.soundboards.byId["sb-weather"].sounds.push("s-thunder");
  state.soundboards.soundboards.byId["sb-doors"] = { id: "sb-doors", title: "Doors", background: "", sounds: ["s-creak"] };
  state.soundboards.soundboards.allIds.push("sb-doors");
  state.soundboards.sounds["s-creak"] = { id: "s-creak", url: file("Effects/creak.wav"), title: "Creak", loop: false, volume: 1, fadeIn: 0, fadeOut: 0 };
  return state;
}

/** The first move as Lyre 0.3.0 to 0.5.0 made it: they did not know the catch-up, so they left no record of it. */
async function firstImportByAnOlderLyre(state: OldState) {
  await importLegacyLibrary(library, persisted(state));
  library.store.run("DELETE FROM library_jobs WHERE name = ?", LEGACY_CATCH_UP_JOB);
}

const persisted = (state: OldState) => JSON.stringify({ playlists: JSON.stringify(state.playlists), soundboards: JSON.stringify(state.soundboards) });
const titlesIn = (playlistId: string) => listPlaylistItems(library.store, playlistId).map((item) => (item.kind === "track" ? item.title : item.label));
const tracksAt = (relative: string) =>
  listTracks(library.store).filter((t) => resolveTrackLocation(library.store, t) === path.join(music, ...relative.split("/")));

describe("catchUpLegacyLibrary (FND-16)", () => {
  it("brings in what the old player gained after the first import, once, and doubles nothing", async () => {
    await firstImportByAnOlderLyre(firstState());
    const tracksBefore = listTracks(library.store).length;
    // Since then, in Lyre: the harbour file was found somewhere else (Find missing files keeps the track's id).
    const harbour = tracksAt("Scores/harbour.flac")[0];
    const moved = writeAudio(music, "Moved/harbour.flac");
    updateTrack(library.store, harbour.id, { file: { path: moved } });

    const later = persisted(laterState());
    expect((await importLegacyLibrary(library, later)).status).toBe("already-done");
    const report = await catchUpLegacyLibrary(library, later);

    expect(report.status).toBe("brought-in");
    expect(report.playlists).toEqual(["Travel"]);
    expect(report.boards).toEqual(["Doors"]);
    expect(report.addedTo).toEqual(["Combat", "Weather"]);
    expect(report.notBroughtBack).toEqual([]);
    expect(report.counts).toMatchObject({ playlists: 1, boards: 1, tracks: 4, playlistEntries: 1, pads: 1 });
    // New files only: new boss, road, thunder and creak. The harbour track (moved, same id) and boss are not doubled.
    expect(listTracks(library.store).length).toBe(tracksBefore + 4);
    expect(tracksAt("Scores/boss.flac")).toHaveLength(1);
    expect(tracksAt("Scores/harbour.flac")).toHaveLength(0);
    expect(titlesIn("pl-combat")).toEqual(["Boss", "Harbour", "New boss"]);
    expect(titlesIn("pl-travel")).toEqual(["Harbour", "The road"]);
    expect(listPlaylists(library.store).map((p) => p.title).sort()).toEqual(["Combat", "Travel"]);
    expect(listBoards(library.store).map((b) => b.title).sort()).toEqual(["Doors", "Weather"]);
    const weather = getBoardLayout(library.store, "sb-weather");
    expect(weather.slots.filter(Boolean).map((pad) => pad!.label)).toEqual(["Rain"]);
    expect(weather.spare.map((pad) => pad.label)).toEqual(["Thunder"]);

    // Once: a second start changes nothing.
    const again = await catchUpLegacyLibrary(library, later);
    expect(again.status).toBe("already-done");
    expect(listTracks(library.store).length).toBe(tracksBefore + 4);
    expect(titlesIn("pl-combat")).toEqual(["Boss", "Harbour", "New boss"]);
  });

  it("does not bring back a playlist made only of files Lyre has (most likely one Nik removed in Lyre), but names it", async () => {
    await firstImportByAnOlderLyre(firstState());
    deletePlaylist(library.store, "pl-combat");
    const report = await catchUpLegacyLibrary(library, persisted(firstState()));
    expect(report.status).toBe("nothing-new");
    expect(report.notBroughtBack).toEqual(["Combat"]);
    expect(report.summary).toMatch(/Not brought back: Combat\./);
    expect(listPlaylists(library.store)).toHaveLength(0);
  });

  it("has nothing to do when the first import happens on this start (it took everything)", async () => {
    const later = persisted(laterState());
    expect((await importLegacyLibrary(library, later)).status).toBe("moved");
    const tracks = listTracks(library.store).length;
    expect((await catchUpLegacyLibrary(library, later)).status).toBe("already-done");
    expect(listTracks(library.store).length).toBe(tracks);
  });

  it("waits for a library that has no first import yet, and for an old player it cannot read", async () => {
    expect((await catchUpLegacyLibrary(library, persisted(laterState()))).status).toBe("no-first-import");
    await firstImportByAnOlderLyre(firstState());
    expect((await catchUpLegacyLibrary(library, "{not json")).status).toBe("unreadable");
    // Unreadable is tried again next start.
    expect((await catchUpLegacyLibrary(library, persisted(laterState()))).status).toBe("brought-in");
  });

  it("takes a backup first and records what it brought in for What came across", async () => {
    await firstImportByAnOlderLyre(firstState());
    const report = await catchUpLegacyLibrary(library, persisted(laterState()));
    expect(report.backupPath && fs.existsSync(report.backupPath)).toBe(true);
    const job = library.store.get<{ state: string; detail: string }>("SELECT state, detail FROM library_jobs WHERE name = ?", LEGACY_CATCH_UP_JOB);
    expect(job?.state).toBe("done");
    expect(JSON.parse(job!.detail).report).toMatchObject({ status: "brought-in", playlists: ["Travel"], boards: ["Doors"] });
  });

  it("runs at each start as part of bringing the old player in: the first move, or else the catch-up", async () => {
    const first = await bringInOldPlayer(library, persisted(firstState()));
    expect(first.status).toBe("moved");
    expect(first.catchUp?.status).toBe("already-done");
    library.store.run("DELETE FROM library_jobs WHERE name = ?", LEGACY_CATCH_UP_JOB);
    const later = await bringInOldPlayer(library, persisted(laterState()));
    expect(later.status).toBe("already-done");
    expect(later.catchUp).toMatchObject({ status: "brought-in", playlists: ["Travel"] });
  });
});
