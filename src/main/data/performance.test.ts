/**
 * Performance targets for the data layer with a large library
 * (20,000 tracks, 500 playlists of about 80 entries):
 * - opening the database (version check, undo set-up; the integrity check starts on a
 *   worker thread) under 200 ms; the blocking check and the background check are timed too;
 * - a search under 50 ms;
 * - a single edit under 5 ms;
 * - loading a campaign tree (50 sessions of 8 scenes) as domain objects under 50 ms, and reading the
 *   whole library for a dynamic playlist under 500 ms (DAT-11; about 5 ms and 130 ms here).
 *
 * Each figure is the median of several runs, so one slow moment on a busy
 * machine does not fail the test. Skip on slow CI with CUE_DESK_SKIP_PERF=1.
 * Set CUE_DESK_PERF_REPORT=<file> to write the measured numbers to a JSON file.
 */
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openLibrary, type Library } from "./library";
import { search } from "./repo/search";
import { getTrack, updateTrack } from "./repo/tracks";
import { listPlaylists, listPlaylistItems, addTracksToPlaylist, movePlaylistItems } from "./repo/playlists";
import { listTags, tagTracks } from "./repo/tags";
import { generateLibrary } from "./test/generateLibrary";
import { generateCampaign } from "./test/generateCampaign";
import { getDomainCampaign, getDomainLookup } from "./repo/domain";
import { playlistTracks, sceneSequence, usesOfPlaylist } from "../../common/domain";
import { makeTempFolder } from "./test/helpers";

const TRACKS = 20_000;
const PLAYLISTS = 500;
const results: Record<string, number> = {};

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(runs: number, fn: (run: number) => void): number {
  const times: number[] = [];
  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    fn(run);
    times.push(performance.now() - start);
  }
  return median(times);
}

describe.skipIf(process.env.CUE_DESK_SKIP_PERF === "1")("performance with 20,000 tracks and 500 playlists", () => {
  let temp: ReturnType<typeof makeTempFolder>;
  let folder: string;
  let library: Library;
  let trackIds: string[];

  beforeAll(() => {
    temp = makeTempFolder("cue-desk-perf-");
    folder = path.join(temp.folder, "library");
    const start = performance.now();
    const building = openLibrary({ folder });
    trackIds = generateLibrary(building, { tracks: TRACKS, playlists: PLAYLISTS }).trackIds;
    building.close();
    results.generateMs = Math.round(performance.now() - start);
    results.databaseBytes = fs.statSync(path.join(folder, "library.sqlite")).size;
    library = openLibrary({ folder });
  }, 300_000);

  afterAll(() => {
    library?.close();
    temp?.cleanup();
    if (process.env.CUE_DESK_PERF_REPORT) {
      fs.writeFileSync(process.env.CUE_DESK_PERF_REPORT, JSON.stringify(results, null, 2));
    }
  });

  it("holds the generated library", () => {
    expect(library.store.get("SELECT count(*) AS n FROM tracks")).toEqual({ n: TRACKS });
    expect(listPlaylists(library.store)).toHaveLength(PLAYLISTS);
  });

  it("opens the database in under 200 ms", async () => {
    library.close();
    const ms = measure(5, () => openLibrary({ folder }).close());
    results.openMs = ms;
    results.openWithBlockingCheckMs = measure(3, () => openLibrary({ folder, integrityCheck: "blocking" }).close());
    const start = performance.now();
    library = openLibrary({ folder });
    expect(await library.checkIntegrity()).toEqual({ status: "ok" });
    results.backgroundCheckMs = Math.round(performance.now() - start);
    expect(ms).toBeLessThan(200);
  });

  it.each([
    ["one letter", "d"],
    ["two letters", "da"],
    ["a word start", "tav"],
    ["two words", "dark for"],
    ["a tag", "harbour mood"],
    ["a composer", "przy"],
    ["a file number", "1234"],
    ["no match", "xylophone"],
  ])("searches (%s) in under 50 ms", (name, text) => {
    const ms = measure(7, () => search(library.store, text));
    results[`search ${name} ms`] = ms;
    expect(ms).toBeLessThan(50);
  });

  it("finds within one playlist in under 50 ms", () => {
    const playlist = listPlaylists(library.store)[250];
    const ms = measure(7, () => search(library.store, "d", { playlistId: playlist.id }));
    results["search in playlist ms"] = ms;
    expect(ms).toBeLessThan(50);
  });

  it("makes a single edit in under 5 ms", () => {
    const store = library.store;
    const playlist = listPlaylists(store)[100];
    const tag = listTags(store)[3];
    const edits: [string, (run: number) => void][] = [
      ["rename track", (run) => updateTrack(store, trackIds[run * 7], { title: `Renamed ${run}` })],
      ["set energy and notes", (run) => updateTrack(store, trackIds[run * 11], { energy: 3, notes: `note ${run}` })],
      ["add track to playlist", (run) => addTracksToPlaylist(store, playlist.id, [trackIds[run * 13]], "start")],
      [
        "move playlist entry",
        () => {
          const items = listPlaylistItems(store, playlist.id);
          movePlaylistItems(store, [items[items.length - 1].id], { after: items[0].id });
        },
      ],
      ["tag track", (run) => tagTracks(store, [trackIds[run * 17]], [tag.id])],
    ];
    for (const [name, edit] of edits) {
      const ms = measure(21, edit);
      results[`edit ${name} ms`] = ms;
      expect(ms, name).toBeLessThan(5);
    }
    expect(getTrack(store, trackIds[0])!.title).toBe("Renamed 0");
  });

  it("makes and undoes a single edit in under 5 ms", () => {
    const store = library.store;
    const ms = measure(11, (run) => {
      updateTrack(store, trackIds[run * 19], { title: `Undo me ${run}` });
      library.history.undo();
    });
    results["edit and undo ms"] = ms;
    expect(ms).toBeLessThan(5);
  });

  it("loads a campaign of 50 sessions with 8 scenes each in under 50 ms", () => {
    const store = library.store;
    const { campaignId, playlistIds } = generateCampaign(library, { sessions: 50, scenesPerSession: 8, trackIds });
    const tree = getDomainCampaign(store, campaignId)!;
    expect(tree.sessions).toHaveLength(50);
    expect(tree.sessions.every((s) => s.scenes.length === 8)).toBe(true);
    const ms = measure(7, () => getDomainCampaign(store, campaignId));
    results["campaign tree ms"] = ms;
    expect(ms).toBeLessThan(50);
    // The shared rules on the loaded tree stay quick too.
    results["usesOfPlaylist on the tree ms"] = measure(7, () => usesOfPlaylist(playlistIds[0], [tree]));
    const lookup = getDomainLookup(store);
    results["scene sequence ms"] = measure(7, () => sceneSequence(tree.sessions[10].scenes[3], lookup));
  });

  it("evaluates a dynamic playlist over the whole library in under 500 ms", () => {
    const store = library.store;
    const mood = listTags(store)[0];
    const rule = { conds: [{ group: mood.groupId, match: "any" as const, values: [mood.name] }], energy: [2, 4] as [number, number] };
    const ms = measure(5, () => {
      const lookup = getDomainLookup(store);
      playlistTracks({ id: "x", name: "x", lane: "music", kind: "dynamic", rule }, lookup);
    });
    results["dynamic playlist over 20,000 tracks ms"] = ms;
    expect(ms).toBeLessThan(500);
  });

  it("backs up the large library", () => {
    const start = performance.now();
    library.backupNow();
    results.backupMs = Math.round(performance.now() - start);
    expect(results.backupMs).toBeLessThan(10_000);
  });
});
