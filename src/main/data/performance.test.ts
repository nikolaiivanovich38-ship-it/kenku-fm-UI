/**
 * Performance targets for the data layer with a large library (20,000 tracks,
 * 500 playlists of about 80 entries, and 3 campaigns of 50 sessions with 8
 * scenes each, every scene with four music items, an ambience and two boards):
 * - opening the database (version check, undo set-up; the integrity check starts on a
 *   worker thread) under 200 ms; the blocking check and the background check are timed too;
 * - a search under 50 ms;
 * - a single edit under 5 ms;
 * - DAT-11: loading one campaign tree under 50 ms (all three under 150 ms); working out a
 *   dynamic playlist in the database under 50 ms; finding where a playlist, board or track
 *   is used under 50 ms; reading the whole library for the shared rules (DomainLookup.tracks)
 *   under 500 ms. docs/data-model.md lists the figures measured.
 *
 * Each figure is the median of several runs, so one slow moment on a busy
 * machine does not fail the test. Skip on slow CI with CUE_DESK_SKIP_PERF=1; CI multiplies the budgets with CUE_DESK_PERF_SLACK
 * (testing/perfBudget.ts).
 * Set CUE_DESK_PERF_REPORT=<file> to write the measured numbers to a JSON file.
 */
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { budget } from "./testing/perfBudget";
import { openLibrary, type Library } from "./library";
import { search } from "./repo/search";
import { deleteTracks, getTrack, listTracks, updateTrack } from "./repo/tracks";
import {
  addTracksToPlaylist,
  createPlaylist,
  listPlaylistItems,
  listPlaylistTrackIds,
  listPlaylists,
  movePlaylistItems,
} from "./repo/playlists";
import { createTag, deleteTag, deleteTagGroup, listTagGroups, listTags, mergeTags, tagTracks, untagTracks } from "./repo/tags";
import { addRoot, listRoots, removeRoot } from "./repo/roots";
import { applyRelink } from "./import/relink";
import { generateLibrary } from "./test/generateLibrary";
import { generateCampaign } from "./test/generateCampaign";
import { getDomainCampaign, getDomainLookup, listDomainCampaigns, listUses } from "./repo/domain";
import { sceneSequence, usesOfPlaylist, type TagCondition } from "../../common/domain";
import { makeTempFolder } from "./test/helpers";

const TRACKS = 20_000;
const PLAYLISTS = 500;
const CAMPAIGNS = 3;
/** generateCampaign adds 20 playlists and 6 boards of its own per campaign. */
const CAMPAIGN_PLAYLISTS = 20;
const results: Record<string, number> = {};

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * The longest time the event loop was held while `work` ran, in milliseconds
 * (DB review 1): a turn that takes longer than 200 ms makes Discord's audio
 * queue run dry. A synchronous call holds it for its whole length; bulk work
 * that yields between batches holds it for its longest batch. `cpu` counts the
 * processor time this thread used in that turn, which other programs on a busy
 * machine cannot inflate (the test may run alongside others), and which
 * leaves out worker threads (a backup's copy); `wall` is the clock time.
 */
async function longestHold(work: () => unknown): Promise<{ wall: number; cpu: number }> {
  const cpuNow = () => {
    const used = process.threadCpuUsage();
    return (used.user + used.system) / 1000;
  };
  let wall = 0;
  let cpu = 0;
  let lastWall = performance.now();
  let lastCpu = cpuNow();
  let running = true;
  const turn = () => {
    const nowWall = performance.now();
    const nowCpu = cpuNow();
    wall = Math.max(wall, nowWall - lastWall);
    cpu = Math.max(cpu, nowCpu - lastCpu);
    lastWall = nowWall;
    lastCpu = nowCpu;
  };
  const tick = () => {
    turn();
    if (running) setImmediate(tick);
  };
  setImmediate(tick);
  lastWall = performance.now();
  lastCpu = cpuNow();
  try {
    await work();
  } finally {
    running = false;
  }
  turn();
  return { wall, cpu };
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
  let campaigns: ReturnType<typeof generateCampaign>[];

  beforeAll(() => {
    temp = makeTempFolder("cue-desk-perf-");
    folder = path.join(temp.folder, "library");
    const start = performance.now();
    const building = openLibrary({ folder });
    trackIds = generateLibrary(building, { tracks: TRACKS, playlists: PLAYLISTS }).trackIds;
    campaigns = Array.from({ length: CAMPAIGNS }, () => generateCampaign(building, { sessions: 50, scenesPerSession: 8, trackIds }));
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

  it("holds the generated library", async () => {
    expect(library.store.get("SELECT count(*) AS n FROM tracks")).toEqual({ n: TRACKS });
    expect(listPlaylists(library.store)).toHaveLength(PLAYLISTS + CAMPAIGNS * CAMPAIGN_PLAYLISTS);
    expect(library.store.get("SELECT count(*) AS n FROM scenes")).toEqual({ n: CAMPAIGNS * 50 * 8 });
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
    expect(ms).toBeLessThan(budget(200));
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
    expect(ms).toBeLessThan(budget(50));
  });

  it.each([
    ["music", "d"],
    ["amb", "da"],
    ["fx", "d"],
    ["fx", "dark for"],
  ] as const)("searches the Library's %s lane (%s) in under 50 ms (ORG-1)", (lane, text) => {
    const ms = measure(7, () => search(library.store, text, { lane }));
    results[`search lane ${lane} ${text} ms`] = ms;
    expect(ms).toBeLessThan(budget(50));
  });

  it("finds within one playlist in under 50 ms", async () => {
    const playlist = listPlaylists(library.store)[250];
    const ms = measure(7, () => search(library.store, "d", { playlistId: playlist.id }));
    results["search in playlist ms"] = ms;
    expect(ms).toBeLessThan(budget(50));
  });

  it("makes a single edit in under 5 ms", async () => {
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
      expect(ms, name).toBeLessThan(budget(5));
    }
    expect(getTrack(store, trackIds[0])!.title).toBe("Renamed 0");
  });

  it("makes and undoes a single edit in under 5 ms", async () => {
    const store = library.store;
    const ms = measure(11, (run) => {
      updateTrack(store, trackIds[run * 19], { title: `Undo me ${run}` });
      // A one-row step is undone before undo() returns.
      void library.history.undo();
    });
    results["edit and undo ms"] = ms;
    expect(ms).toBeLessThan(budget(5));
  });

  it("loads a campaign of 50 sessions with 8 scenes each in under 50 ms", async () => {
    const store = library.store;
    const { campaignId } = campaigns[1];
    const tree = getDomainCampaign(store, campaignId)!;
    expect(tree.sessions).toHaveLength(50);
    expect(tree.sessions.every((s) => s.scenes.length === 8 && s.scenes.every((sc) => sc.music.length === 4))).toBe(true);
    const ms = measure(7, () => getDomainCampaign(store, campaignId));
    results["campaign tree ms"] = ms;
    expect(ms).toBeLessThan(budget(50));
    const all = measure(5, () => listDomainCampaigns(store));
    results["all three campaign trees ms"] = all;
    expect(all).toBeLessThan(budget(150));
    // The shared rules on the loaded tree stay quick too.
    results["usesOfPlaylist on the tree ms"] = measure(7, () => usesOfPlaylist(campaigns[1].playlistIds[0], [tree]));
    const lookup = getDomainLookup(store);
    results["scene sequence ms"] = measure(7, () => sceneSequence(tree.sessions[10].scenes[3], lookup));
  });

  it("works out a dynamic playlist in the database in under 50 ms", async () => {
    const store = library.store;
    const tags = listTags(store);
    const rules = {
      "tag and energy": { conds: [{ group: tags[0].groupId, match: "any" as const, values: [tags[0].name, tags[1].name] }], energy: [2, 4] as [number, number] },
      "all of two tags": { conds: [{ group: tags[0].groupId, match: "all" as const, values: [tags[0].name, tags[2].name] }] },
      "energy only": { conds: [] as TagCondition[], energy: [4, 5] as [number, number] },
      "FX lane, leaving a tag out": { conds: [{ group: tags[0].groupId, match: "none" as const, values: [tags[0].name] }] },
    };
    for (const [name, rule] of Object.entries(rules)) {
      const playlist = createPlaylist(store, { title: name, kind: "dynamic", lane: name.startsWith("FX") ? "fx" : "music", rule });
      const ms = measure(7, () => listPlaylistTrackIds(store, playlist.id));
      results[`dynamic playlist (${name}) ms`] = ms;
      expect(ms, name).toBeLessThan(budget(50));
    }
    expect(listPlaylistTrackIds(store, listPlaylists(store).find((p) => p.title === "energy only")!.id).length).toBeGreaterThan(1000);
  });

  it("finds where a playlist, board or track is used in under 50 ms", async () => {
    const store = library.store;
    const { playlistIds, boardIds } = campaigns[0];
    const track = store.get<{ track_id: string }>("SELECT track_id FROM scene_music WHERE track_id IS NOT NULL LIMIT 1")!.track_id;
    const items = { playlist: { playlistId: playlistIds[3] }, board: { boardId: boardIds[2] }, track: { trackId: track } };
    for (const [name, item] of Object.entries(items)) {
      expect(listUses(store, item).length, name).toBeGreaterThan(0);
      const ms = measure(7, () => listUses(store, item));
      results[`uses of a ${name} ms`] = ms;
      expect(ms, name).toBeLessThan(budget(50));
    }
  });

  it("reads the whole library for the shared rules in under 500 ms", async () => {
    const store = library.store;
    const ms = measure(5, () => [...getDomainLookup(store).tracks()]);
    results["whole library as DomainTrack ms"] = ms;
    expect(ms).toBeLessThan(budget(500));
  });

  it("backs up the large library", async () => {
    const start = performance.now();
    await library.backupNow();
    results.backupMs = Math.round(performance.now() - start);
    expect(results.backupMs).toBeLessThan(budget(10_000));
  });

  it("never holds the main process for more than 200 ms, even for bulk work and its undo (DB review 1)", async () => {
    const { store, history } = library;
    const holds: Record<string, number> = {};
    const hold = async (name: string, work: () => unknown) => {
      const { wall, cpu } = await longestHold(work);
      holds[name] = Math.round(cpu);
      results[`longest hold (clock): ${name} ms`] = Math.round(wall);
    };
    const tags = listTags(store);
    const busiest = store.get<{ tag_id: string }>("SELECT tag_id FROM track_tags GROUP BY tag_id ORDER BY count(*) DESC LIMIT 1")!.tag_id;
    const spare = createTag(store, { groupId: tags[0].groupId, name: "Bulk test" });

    await hold("back up now (on a worker thread)", () => library.backupNow());
    await hold("tag 10,000 tracks", () => tagTracks(store, trackIds.slice(0, 10_000), [spare.id]));
    await hold("undo tagging 10,000 tracks", () => history.undo());
    await hold("redo tagging 10,000 tracks", () => history.redo());
    await hold("untag 10,000 tracks", () => untagTracks(store, trackIds.slice(0, 10_000), [spare.id]));
    await hold("delete the busiest tag", () => deleteTag(store, busiest));
    await hold("undo deleting the busiest tag", () => history.undo());
    const busy = tags.slice(-4).map((tag) => tag.id);
    await hold("merge three tags", () => mergeTags(store, busy.slice(0, 3), busy[3]));
    await hold("undo merging three tags", () => history.undo());
    await hold("delete a tag group", () => deleteTagGroup(store, listTagGroups(store)[0].id));
    await hold("undo deleting a tag group", () => history.undo());
    await hold("delete 5,000 tracks", () => deleteTracks(store, trackIds.slice(0, 5_000)));
    await hold("undo deleting 5,000 tracks", () => history.undo());
    const moved = trackIds.slice(5_000, 8_000).map((trackId, i) => ({ trackId, to: `E:\\Moved\\${i}.flac` }));
    await hold("relink 3,000 tracks", () => applyRelink(store, moved));
    await hold("undo relinking 3,000 tracks", () => history.undo());
    await hold("add a library folder holding every track", () => addRoot(store, { name: "Soundtracks", path: "H:\\Audio\\Soundtracks" }));
    await hold("remove that library folder", () => removeRoot(store, listRoots(store)[0].id));
    await hold("undo removing it", () => history.undo());
    await hold("read the whole library for the shared rules", () => [...getDomainLookup(store).tracks()]);
    await hold("a page of the track list", () => listTracks(store, { limit: 200, offset: 10_000 }));

    expect(store.get("SELECT count(*) AS n FROM tracks")).toEqual({ n: TRACKS });
    for (const [name, ms] of Object.entries(holds)) results[`longest hold (processor): ${name} ms`] = ms;
    const tooLong = Object.entries(holds).filter(([, ms]) => ms >= budget(200));
    expect(tooLong, JSON.stringify(holds)).toEqual([]);
  }, 600_000);
});
