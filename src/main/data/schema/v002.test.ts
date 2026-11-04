/**
 * DAT-11: schema version 2, the agreed design (Lyre design round 4).
 * A wave-1 library (version 1) with something of everything in it must come
 * through the upgrade without losing anything; a new library starts at version 2.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "path";
import { openConnection, type DatabaseSync } from "../sqlite";
import { makeTempFolder } from "../test/helpers";
import { migrate, schemaVersion } from "./migrate";
import { MIGRATIONS } from "./index";
import { v001Initial } from "./v001-initial";

let temp: ReturnType<typeof makeTempFolder>;
beforeEach(() => {
  temp = makeTempFolder();
});
afterEach(() => temp.cleanup());

const all = (db: DatabaseSync, sql: string) => db.prepare(sql).all();
const tableNames = (db: DatabaseSync) =>
  (all(db, "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name") as { name: string }[]).map((r) => r.name);

/** A version-1 library as wave 1 could have written it. */
function fillVersion1(db: DatabaseSync) {
  db.exec(`
    INSERT INTO library_roots (id, name, path, created_at) VALUES ('r1', 'Scores', 'H:\\Audio\\Scores', 1);
    INSERT INTO tracks (id, title, root_id, path, file_name, duration_ms, energy, role, loopable, notes, created_at, updated_at)
      VALUES ('t1', 'Secunda', 'r1', 'Skyrim/2-03 Secunda.flac', '2-03 Secunda.flac', 146000, 3, 'loop_bed', 'yes', 'loops well', 1, 1),
             ('t2', 'Bridge of Death', 'r1', 'Chernobyl/06.flac', '06.flac', 441000, 2, 'underscore', 'with_crossfade', '', 1, 1),
             ('t3', 'Door slam', NULL, 'D:\\Fx\\door.wav', 'door.wav', 1600, NULL, 'sting', 'no', '', 1, 1),
             ('t4', 'Thunder', NULL, 'D:\\Fx\\thunder.wav', 'thunder.wav', 4000, NULL, NULL, NULL, '', 1, 1);
    INSERT INTO markers (id, track_id, time_ms, kind, label, created_at) VALUES ('m1', 't1', 64000, 'marker', 'choir enters', 1);
    INSERT INTO folders (id, scope, name, position) VALUES ('f1', 'boards', 'Weather', 1024);
    INSERT INTO playlists (id, title, background, position, created_at, updated_at)
      VALUES ('p1', 'Coast road', 'forest', 1024, 1, 1), ('p2', 'Abbey', '', 2048, 1, 1);
    INSERT INTO playlist_items (id, playlist_id, kind, track_id, label, position)
      VALUES ('pi1', 'p1', 'track', 't1', '', 1024), ('pi2', 'p1', 'divider', NULL, 'Night', 2048), ('pi3', 'p1', 'track', 't2', '', 3072);
    INSERT INTO boards (id, title, background, folder_id, position, created_at, updated_at)
      VALUES ('b1', 'Storm', 'rain', 'f1', 1024, 1, 1), ('b2', 'Empty', '', NULL, 2048, 1, 1);
    INSERT INTO board_items (id, board_id, kind, track_id, label, loop, volume, fade_in_ms, fade_out_ms, position)
      VALUES ('bi1', 'b1', 'sound', 't4', '', 0, 0.5, 0, 800, 1024),
             ('bi2', 'b1', 'sound', 't3', '', 1, 1, 250, 0, 2048),
             ('bi3', 'b1', 'divider', NULL, 'Wind', 0, 1, 0, 0, 3072),
             ('bi4', 'b1', 'sound', 't1', '', 0, 0.7, 0, 0, 4096);
    INSERT INTO campaigns (id, name, color, notes, position, created_at, updated_at)
      VALUES ('c1', 'The Sunken Crown', '#335577', 'Drowned kingdom', 1024, 1, 1);
    INSERT INTO campaign_playlists (campaign_id, playlist_id) VALUES ('c1', 'p2'), ('c1', 'p1');
    INSERT INTO campaign_boards (campaign_id, board_id) VALUES ('c1', 'b1');
    INSERT INTO sessions (id, campaign_id, name, notes, played_on, position, created_at, updated_at)
      VALUES ('s1', 'c1', 'Smugglers', '', '2026-10-08', 1024, 1, 1),
             ('s2', 'c1', 'The Drowned Abbey', 'bring dice', NULL, 2048, 1, 1);
    INSERT INTO scenes (id, session_id, name, notes, position, created_at, updated_at)
      VALUES ('sc1', 's2', 'The abbey ruins', 'Rain all the way', 1024, 1, 1);
    INSERT INTO scene_items (id, scene_id, playlist_id, board_id, track_id, position)
      VALUES ('si1', 'sc1', NULL, NULL, 't2', 1024), ('si2', 'sc1', NULL, 'b1', NULL, 2048), ('si3', 'sc1', 'p2', NULL, NULL, 3072);
    INSERT INTO tag_groups (id, name, position) VALUES ('g9', 'Weather', 99999);
    INSERT INTO tags (id, group_id, name, position) VALUES ('tg1', 'g9', 'Storm', 1024);
    INSERT INTO track_tags (track_id, tag_id) VALUES ('t4', 'tg1');
  `);
}

function version1File() {
  const file = path.join(temp.folder, "library.sqlite");
  const db = openConnection(file);
  migrate(db, [v001Initial], () => 1000);
  fillVersion1(db);
  db.close();
  return file;
}

describe("schema version 2 (DAT-11)", () => {
  it("is the second upgrade step", () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2]);
  });

  it("upgrades a version-1 library with data in it without losing anything", () => {
    const db = openConnection(version1File());
    expect(migrate(db, MIGRATIONS, () => 2000)).toEqual({ from: 1, to: 2, applied: [2] });

    // Tracks keep everything; the new design fields take their defaults; "with crossfade" is now "crossfade".
    expect(all(db, "SELECT id, title, meta_title, kind, role, loopable, energy, notes, profile FROM tracks ORDER BY id")).toEqual([
      { id: "t1", title: "Secunda", meta_title: "", kind: "music", role: "loop_bed", loopable: "yes", energy: 3, notes: "loops well", profile: null },
      { id: "t2", title: "Bridge of Death", meta_title: "", kind: "music", role: "underscore", loopable: "crossfade", energy: 2, notes: "", profile: null },
      { id: "t3", title: "Door slam", meta_title: "", kind: "music", role: "sting", loopable: "no", energy: null, notes: "", profile: null },
      { id: "t4", title: "Thunder", meta_title: "", kind: "music", role: null, loopable: null, energy: null, notes: "", profile: null },
    ]);
    expect(all(db, "SELECT id, label FROM markers")).toEqual([{ id: "m1", label: "choir enters" }]);

    // Playlists are manual music playlists with their entries (dividers too).
    expect(all(db, "SELECT id, title, background, kind, lane, rule, notes FROM playlists ORDER BY position")).toEqual([
      { id: "p1", title: "Coast road", background: "forest", kind: "manual", lane: "music", rule: null, notes: "" },
      { id: "p2", title: "Abbey", background: "", kind: "manual", lane: "music", rule: null, notes: "" },
    ]);
    expect(all(db, "SELECT id, kind, track_id, label FROM playlist_items ORDER BY position")).toEqual([
      { id: "pi1", kind: "track", track_id: "t1", label: "" },
      { id: "pi2", kind: "divider", track_id: null, label: "Night" },
      { id: "pi3", kind: "track", track_id: "t2", label: "" },
    ]);

    // Soundboard sounds become pads (same ids) on a 4-column grid, in order; a divider starts a new row.
    expect(all(db, "SELECT id, title, background, folder_id, grid_cols, grid_rows FROM boards ORDER BY position")).toEqual([
      { id: "b1", title: "Storm", background: "rain", folder_id: "f1", grid_cols: 4, grid_rows: 2 },
      { id: "b2", title: "Empty", background: "", folder_id: null, grid_cols: 4, grid_rows: 3 },
    ]);
    expect(
      all(db, "SELECT id, board_id, grid_row, grid_col, label, mode, volume, fade_in_ms, fade_ms, sound_kind FROM pads ORDER BY grid_row, grid_col"),
    ).toEqual([
      { id: "bi1", board_id: "b1", grid_row: 0, grid_col: 0, label: "Thunder", mode: "oneshot", volume: 0.5, fade_in_ms: 0, fade_ms: 800, sound_kind: "single" },
      { id: "bi2", board_id: "b1", grid_row: 0, grid_col: 1, label: "Door slam", mode: "toggle", volume: 1, fade_in_ms: 250, fade_ms: 0, sound_kind: "single" },
      { id: "bi4", board_id: "b1", grid_row: 1, grid_col: 0, label: "Secunda", mode: "oneshot", volume: 0.7, fade_in_ms: 0, fade_ms: 0, sound_kind: "single" },
    ]);
    expect(all(db, "SELECT pad_id, track_id FROM pad_sounds ORDER BY pad_id")).toEqual([
      { pad_id: "bi1", track_id: "t4" },
      { pad_id: "bi2", track_id: "t3" },
      { pad_id: "bi4", track_id: "t1" },
    ]);
    expect(tableNames(db)).not.toContain("board_items");

    // Campaign details default to the candle theme; its playlists keep a stable (library) order.
    expect(all(db, "SELECT name, color, notes, theme, system, description, obsidian_vault FROM campaigns")).toEqual([
      { name: "The Sunken Crown", color: "#335577", notes: "Drowned kingdom", theme: "candle", system: "", description: "", obsidian_vault: "" },
    ]);
    expect(all(db, "SELECT playlist_id FROM campaign_playlists ORDER BY position")).toEqual([{ playlist_id: "p1" }, { playlist_id: "p2" }]);
    expect(all(db, "SELECT board_id FROM campaign_boards")).toEqual([{ board_id: "b1" }]);

    // Sessions are numbered in order; one with a date was played.
    expect(all(db, "SELECT id, number, name, session_date, status, notes FROM sessions ORDER BY position")).toEqual([
      { id: "s1", number: 1, name: "Smugglers", session_date: "2026-10-08", status: "played", notes: "" },
      { id: "s2", number: 2, name: "The Drowned Abbey", session_date: null, status: "draft", notes: "bring dice" },
    ]);

    // Scene material splits into the ordered music list and the ordered board list.
    expect(all(db, "SELECT name, notes, starts_when FROM scenes")).toEqual([{ name: "The abbey ruins", notes: "Rain all the way", starts_when: "" }]);
    expect(all(db, "SELECT id, track_id, playlist_id FROM scene_music ORDER BY position")).toEqual([
      { id: "si1", track_id: "t2", playlist_id: null },
      { id: "si3", track_id: null, playlist_id: "p2" },
    ]);
    expect(all(db, "SELECT board_id FROM scene_boards ORDER BY position")).toEqual([{ board_id: "b1" }]);
    expect(all(db, "SELECT * FROM scene_ambience")).toEqual([]);
    expect(tableNames(db)).not.toContain("scene_items");

    // A library that was in use keeps every tag group, its own included.
    expect((all(db, "SELECT name FROM tag_groups ORDER BY position") as { name: string }[]).map((g) => g.name)).toEqual([
      "Mood",
      "Leitmotif",
      "Scene type",
      "Location",
      "Faction",
      "Weather",
    ]);
    expect(all(db, "SELECT track_id, tag_id FROM track_tags")).toEqual([{ track_id: "t4", tag_id: "tg1" }]);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
    expect(all(db, "PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
    db.close();
  });

  it("keeps search working on upgraded rows and finds a track by its file-tag title", () => {
    const db = openConnection(version1File());
    migrate(db, MIGRATIONS);
    const find = (text: string) =>
      all(db, `SELECT d.ref_id AS id, f.title FROM search_fts f JOIN search_docs d ON d.doc_id = f.rowid WHERE d.kind = 'track' AND search_fts MATCH '${text}' ORDER BY d.ref_id`);
    expect(find("secunda")).toEqual([{ id: "t1", title: "Secunda" }]);
    // A track the game master has not titled yet shows (and is found by) its file-tag title.
    db.exec("UPDATE tracks SET title = '', meta_title = 'Far Horizons' WHERE id = 't1'");
    expect(find("horizons")).toEqual([{ id: "t1", title: "Far Horizons" }]);
    // With both, the game master's title shows and the file-tag title still finds it.
    db.exec("UPDATE tracks SET title = 'Open road' WHERE id = 't1'");
    expect(find("horizons")).toEqual([{ id: "t1", title: "Open road" }]);
    // Tagging still reaches the index after the triggers were rebuilt.
    db.exec("INSERT INTO track_tags (track_id, tag_id) VALUES ('t1', 'tg1')");
    expect(find("storm").map((r) => (r as { id: string }).id)).toEqual(["t1", "t4"]);
    db.close();
  });

  it("starts a new library at version 2 with the Mood, Leitmotif and Scene type tag groups", () => {
    const db = openConnection(":memory:");
    expect(migrate(db, MIGRATIONS)).toEqual({ from: 0, to: 2, applied: [1, 2] });
    expect(schemaVersion(db)).toBe(2);
    expect((all(db, "SELECT name FROM tag_groups ORDER BY position") as { name: string }[]).map((g) => g.name)).toEqual([
      "Mood",
      "Leitmotif",
      "Scene type",
    ]);
    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        "pads",
        "pad_sounds",
        "session_playlists",
        "session_boards",
        "scene_music",
        "scene_ambience",
        "scene_boards",
        "profile_overrides",
      ]),
    );
    expect(tableNames(db)).not.toContain("board_items");
    expect(tableNames(db)).not.toContain("scene_items");
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
    db.close();
  });

  it("allows at most one next session per campaign", () => {
    const db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    db.exec(`
      INSERT INTO campaigns (id, name, position, created_at, updated_at) VALUES ('c1', 'A', 1, 1, 1), ('c2', 'B', 2, 1, 1);
      INSERT INTO sessions (id, campaign_id, name, status, position, created_at, updated_at)
        VALUES ('s1', 'c1', '', 'next', 1, 1, 1), ('s2', 'c2', '', 'next', 1, 1, 1), ('s3', 'c1', '', 'draft', 2, 1, 1);
    `);
    expect(() => db.exec("UPDATE sessions SET status = 'next' WHERE id = 's3'")).toThrow(/UNIQUE/);
    db.close();
  });

  it("keeps grid sizes from 1 to 8 and one pad per grid cell", () => {
    const db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    db.exec("INSERT INTO boards (id, title, position, created_at, updated_at, grid_cols, grid_rows) VALUES ('b', 'B', 1, 1, 1, 8, 8)");
    expect(() => db.exec("UPDATE boards SET grid_cols = 9")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE boards SET grid_rows = 0")).toThrow(/CHECK/);
    db.exec("INSERT INTO pads (id, board_id, grid_row, grid_col) VALUES ('p1', 'b', 0, 0)");
    expect(() => db.exec("INSERT INTO pads (id, board_id, grid_row, grid_col) VALUES ('p2', 'b', 0, 0)")).toThrow(/UNIQUE/);
    // Spare pads have no cell and any number can wait.
    db.exec("INSERT INTO pads (id, board_id, spare_position) VALUES ('p3', 'b', 1), ('p4', 'b', 2)");
    expect(() => db.exec("INSERT INTO pads (id, board_id) VALUES ('p5', 'b')")).toThrow(/CHECK/);
    db.close();
  });
});
