/**
 * DAT-11: every hot read path uses an index. Each query below is the exact SQL
 * the repository runs (exported by its module); EXPLAIN QUERY PLAN must show
 * index searches only, never a full scan of a table, and the index named in
 * docs/data-model.md for that path. The full-text search reads its FTS5 index
 * (a "virtual table" scan driven by MATCH, which is how FTS5 is used).
 */
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SQLInputValue } from "./sqlite";
import { openLibrary, type Library } from "./library";
import { generateLibrary } from "./test/generateLibrary";
import { generateCampaign } from "./test/generateCampaign";
import { makeTempFolder } from "./test/helpers";
import { campaignTreeQueries, USES_QUERIES } from "./repo/domain";
import { SCENE_MUSIC_SQL } from "./repo/campaigns";
import { PLAYLIST_ITEMS_SQL, createPlaylist } from "./repo/playlists";
import { NEW_TRACKS_SQL, TRACK_BY_PATH_SQL, tracksWithTagsSql } from "./repo/tracks";
import { BOARD_PADS_SQL } from "./repo/boards";
import { PROFILE_LOOKUP_SQL } from "./repo/profileRows";
import { searchQuery } from "./repo/search";
import { dynamicTracksQuery } from "./repo/ruleRows";
import { listTags, TAG_USAGE_SQL } from "./repo/tags";

let temp: ReturnType<typeof makeTempFolder>;
let library: Library;

beforeAll(() => {
  temp = makeTempFolder("lyre-plan-");
  library = openLibrary({ folder: path.join(temp.folder, "library") });
  const { trackIds } = generateLibrary(library, { tracks: 2000, playlists: 20 });
  generateCampaign(library, { sessions: 10, scenesPerSession: 4, trackIds });
}, 120_000);
afterAll(() => {
  library.close();
  temp.cleanup();
});

function plan(sql: string, params: SQLInputValue[]): string[] {
  return (library.store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((row) => row.detail);
}

/** A full scan of a table; FTS5 answering MATCH shows as a virtual-table scan and is its index. */
const FULL_SCAN = /^SCAN (?!search_fts VIRTUAL TABLE INDEX)/;

function expectIndexed(sql: string, params: SQLInputValue[], index: string) {
  const details = plan(sql, params);
  expect(details.filter((d) => FULL_SCAN.test(d)), details.join("\n")).toEqual([]);
  expect(details.join("\n")).toContain(index);
  return details;
}

describe("query plans of the hot read paths (DAT-11)", () => {
  it.each(Object.entries(campaignTreeQueries(true)))("campaign tree: %s walks the in-order indexes without sorting", (_name, sql) => {
    const details = expectIndexed(sql, ["c"], "USING");
    expect(details.filter((d) => d.startsWith("USE TEMP B-TREE")), details.join("\n")).toEqual([]);
  });

  it("a scene's music in order", () => {
    expectIndexed(SCENE_MUSIC_SQL, ["sc"], "scene_music_order");
  });

  it("a playlist's tracks in order", () => {
    expectIndexed(PLAYLIST_ITEMS_SQL, ["p"], "playlist_items_order");
  });

  it.each(Object.entries(BOARD_PADS_SQL))("drawing a board: its %s", (_name, sql) => {
    expectIndexed(sql, ["b"], "pads_board");
  });

  it("tracks by tag (the library's tag filter)", () => {
    expectIndexed(tracksWithTagsSql(2), ["a", "b", 50, 0], "track_tags_tag");
  });

  it.each([
    ["under a library folder", TRACK_BY_PATH_SQL.root, ["r", "a/b.flac"], "tracks_root_path"],
    ["outside every library folder", TRACK_BY_PATH_SQL.absolute, ["/a/b.flac"], "tracks_absolute_path"],
    ["by web address", TRACK_BY_PATH_SQL.url, ["https://x.org/a.mp3"], "tracks_url"],
    ["every track under a library folder", TRACK_BY_PATH_SQL.underRoot, ["r"], "tracks_root_path"],
  ] as const)("finding a track by its file: %s", (_name, sql, params, index) => {
    expectIndexed(sql, [...params], index);
  });

  it("new tracks (the library's New mark; import stream)", () => {
    expectIndexed(NEW_TRACKS_SQL, [], "tracks_new");
  });

  it.each([
    ["playlist", 0, "campaign_playlists_playlist"],
    ["playlist", 1, "session_playlists_playlist"],
    ["playlist", 2, "scene_music_playlist"],
    ["playlist", 3, "scene_ambience_playlist"],
    ["board", 0, "campaign_boards_board"],
    ["board", 1, "session_boards_board"],
    ["board", 2, "scene_boards_board"],
    ["track", 0, "scene_music_track"],
    ["track", 1, "scene_ambience_track"],
  ] as const)("uses of a %s (query %i) start from %s", (kind, index, name) => {
    expectIndexed(USES_QUERIES[kind][index], ["x"], name);
  });

  it.each([
    ["tracks", "track_tags_tag"],
    ["playlists", "rule_condition_tags_tag"],
    ["pads", "pads_tag"],
  ] as const)("where a tag is used: %s start from %s", (path, index) => {
    expectIndexed(TAG_USAGE_SQL[path], ["x"], index);
  });

  it.each(Object.entries(PROFILE_LOOKUP_SQL))("profile lookup by (track, place): %s", (place, sql) => {
    expectIndexed(sql, place === "own" ? ["t"] : ["p", "t"], place === "own" ? "audio_profiles_own" : `audio_profiles_${place.replace("_id", "")}`);
  });

  it("full-text search over the track names, artist, album and tags", () => {
    const query = searchQuery("dark fo")!;
    expectIndexed(query.sql, query.params, "search_fts VIRTUAL TABLE");
    const inPlaylist = searchQuery("dark", { playlistId: "p" })!;
    expectIndexed(inPlaylist.sql, inPlaylist.params, "playlist_items_order");
    for (const lane of ["music", "fx"] as const) {
      const inLane = searchQuery("dark", { lane })!;
      expectIndexed(inLane.sql, inLane.params, "SEARCH t EXISTS USING INDEX sqlite_autoindex_tracks_1 (id=?)");
    }
  });

  it.each([
    ["a tag condition in the music lane", "music", "any", [2, 4]],
    ["all of two tags, energy from 0", "music", "all", [0, 3]],
    ["an FX lane (effects and stings)", "fx", "any", null],
    ["leaving tags out only", "amb", "none", [1, 5]],
    ["an FX lane with energy only", "fx", null, [2, 4]],
  ] as const)("dynamic playlist: %s", (_name, lane, match, energy) => {
    const store = library.store;
    const tags = listTags(store);
    const playlist = createPlaylist(store, {
      title: `Rule ${lane} ${match}`,
      kind: "dynamic",
      lane,
      rule: {
        conds: match === null ? [] : [{ group: tags[0].groupId, match, values: [tags[0].name, tags[1].name] }],
        ...(energy ? { energy: [energy[0], energy[1]] as [number, number] } : {}),
      },
    });
    const query = dynamicTracksQuery(store, playlist.id)!;
    expectIndexed(query.sql, query.params, match === null ? "tracks_role" : match === "none" ? "tracks_kind" : "track_tags");
  });
});
