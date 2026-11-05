/**
 * Schema version 3 (design round 5): every new CHECK, key and trigger, and the upgrade from version 2 with data in it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConnection, type DatabaseSync } from "../sqlite";
import { Store } from "../store";
import { migrate, schemaVersion } from "./migrate";
import { MIGRATIONS } from "./index";

const one = (db: DatabaseSync, sql: string) => db.prepare(sql).get();
const all = (db: DatabaseSync, sql: string) => db.prepare(sql).all();

const BASE = `
  INSERT INTO tracks (id, title, path, file_name, created_at, updated_at) VALUES ('t', 'Bells', '/t.flac', 't.flac', 1, 1), ('u', 'Rain', '/u.flac', 'u.flac', 1, 1);
  INSERT INTO playlists (id, title, position, created_at, updated_at) VALUES ('p', 'Abbey', 1, 1, 1);
  INSERT INTO playlists (id, title, position, kind, created_at, updated_at) VALUES ('d', 'Eerie', 2, 'dynamic', 1, 1);
  INSERT INTO campaigns (id, name, position, created_at, updated_at) VALUES ('c', 'Crown', 1, 1, 1);
  INSERT INTO sessions (id, campaign_id, position, created_at, updated_at) VALUES ('s', 'c', 1, 1, 1);
  INSERT INTO scenes (id, session_id, name, position, created_at, updated_at) VALUES ('x', 's', 'Ruins', 1, 1, 1);
  INSERT INTO boards (id, title, position, created_at, updated_at) VALUES ('b', 'Combat', 1, 1, 1);
`;

describe("schema version 3 (design round 5)", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    db.exec(BASE);
  });
  afterEach(() => db.close());

  it("is the newest version and leaves no broken link", () => {
    expect(schemaVersion(db)).toBe(3);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("PLY-13: keeps one play order per playlist per place, at most one place, and a known repeat", () => {
    db.exec(`INSERT INTO play_orders (id, playlist_id, shuffle, repeat) VALUES ('o1', 'p', 1, 'all');
      INSERT INTO play_orders (id, playlist_id, scene_id, shuffle, repeat) VALUES ('o2', 'p', 'x', 0, 'one');
      INSERT INTO play_orders (id, playlist_id, session_id, shuffle, repeat) VALUES ('o3', 'p', 's', 1, 'off');
      INSERT INTO play_orders (id, playlist_id, campaign_id, shuffle, repeat) VALUES ('o4', 'p', 'c', 0, 'all');`);
    expect(() => db.exec("INSERT INTO play_orders (id, playlist_id, shuffle, repeat) VALUES ('o5', 'p', 0, 'all')")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO play_orders (id, playlist_id, scene_id, shuffle, repeat) VALUES ('o5', 'p', 'x', 0, 'all')")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO play_orders (id, playlist_id, scene_id, session_id, shuffle, repeat) VALUES ('o5', 'd', 'x', 's', 0, 'all')")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO play_orders (id, playlist_id, shuffle, repeat) VALUES ('o5', 'd', 2, 'all')")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO play_orders (id, playlist_id, shuffle, repeat) VALUES ('o5', 'd', 0, 'twice')")).toThrow(/CHECK/);
    // Each place's choice goes with its place; all of them go with the playlist.
    db.exec("DELETE FROM scenes WHERE id = 'x'");
    expect(all(db, "SELECT id FROM play_orders ORDER BY id")).toEqual([{ id: "o1" }, { id: "o3" }, { id: "o4" }]);
    db.exec("DELETE FROM playlists WHERE id = 'p'");
    expect(all(db, "SELECT id FROM play_orders")).toEqual([]);
  });

  it("DAT-14: a track has at most one name per scene, never blank, gone with the scene or the track", () => {
    db.exec("INSERT INTO scene_track_names (scene_id, track_id, name) VALUES ('x', 't', 'The wight rises')");
    expect(() => db.exec("INSERT INTO scene_track_names (scene_id, track_id, name) VALUES ('x', 't', 'Again')")).toThrow(/UNIQUE|PRIMARY/);
    expect(() => db.exec("INSERT INTO scene_track_names (scene_id, track_id, name) VALUES ('x', 'u', '   ')")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO scene_track_names (scene_id, track_id, name) VALUES ('x', 'u', ' padded ')")).toThrow(/CHECK/);
    expect(() => db.exec(`INSERT INTO scene_track_names (scene_id, track_id, name) VALUES ('x', 'u', '${"n".repeat(201)}')`)).toThrow(/CHECK/);
    db.exec("DELETE FROM tracks WHERE id = 't'");
    expect(one(db, "SELECT count(*) AS n FROM scene_track_names")).toEqual({ n: 0 });
  });

  it("DAT-13: a track's chosen shape and its peaks' suggested shape are one of the five; rule shapes only on dynamic playlists", () => {
    db.exec("UPDATE tracks SET shape = 'builds' WHERE id = 't'");
    expect(() => db.exec("UPDATE tracks SET shape = 'swells' WHERE id = 't'")).toThrow(/CHECK/);
    db.exec("INSERT INTO track_peaks (track_id, suggested_shape, levels, worked_out_at) VALUES ('t', 'steady', x'0102', 1)");
    expect(() => db.exec("UPDATE track_peaks SET suggested_shape = 'flat'")).toThrow(/CHECK/);
    // No levels (the file could not be read): no suggestion.
    expect(() => db.exec("INSERT INTO track_peaks (track_id, suggested_shape, levels, worked_out_at) VALUES ('u', 'steady', NULL, 1)")).toThrow(/CHECK/);
    db.exec("INSERT INTO rule_shapes (playlist_id, shape) VALUES ('d', 'builds'), ('d', 'peaksThenFalls')");
    expect(() => db.exec("INSERT INTO rule_shapes (playlist_id, shape) VALUES ('d', 'builds')")).toThrow(/UNIQUE|PRIMARY/);
    expect(() => db.exec("INSERT INTO rule_shapes (playlist_id, shape) VALUES ('p', 'builds')")).toThrow(/manual playlist has no rule/);
    expect(() => db.exec("UPDATE rule_shapes SET playlist_id = 'p'")).toThrow(/manual playlist has no rule/);
    expect(() => db.exec("INSERT INTO rule_shapes (playlist_id, shape) VALUES ('d', 'wobbly')")).toThrow(/CHECK/);
  });

  it("ORG-12: tracks on hand for a campaign or session, each once, in order, gone with either side", () => {
    db.exec(`INSERT INTO campaign_tracks (campaign_id, track_id, position) VALUES ('c', 't', 1), ('c', 'u', 2);
      INSERT INTO session_tracks (session_id, track_id, position) VALUES ('s', 't', 1);`);
    expect(() => db.exec("INSERT INTO campaign_tracks (campaign_id, track_id, position) VALUES ('c', 't', 3)")).toThrow(/UNIQUE|PRIMARY/);
    expect(() => db.exec("UPDATE campaign_tracks SET position = 1 WHERE track_id = 'u'")).toThrow(/UNIQUE/);
    db.exec("DELETE FROM tracks WHERE id = 't'");
    expect(one(db, "SELECT count(*) AS n FROM session_tracks")).toEqual({ n: 0 });
    db.exec("DELETE FROM campaigns WHERE id = 'c'");
    expect(one(db, "SELECT count(*) AS n FROM campaign_tracks")).toEqual({ n: 0 });
  });

  it("PLY-14: a profile belongs to at most one place, a session list among them, once per track", () => {
    db.exec("INSERT INTO audio_profiles (id, track_id, session_id, end_ms) VALUES ('a1', 't', 's', 5000)");
    expect(() => db.exec("INSERT INTO audio_profiles (id, track_id, session_id) VALUES ('a2', 't', 's')")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO audio_profiles (id, track_id, session_id, scene_id) VALUES ('a3', 'u', 's', 'x')")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO audio_profiles (id, track_id, session_id, playlist_id) VALUES ('a3', 'u', 's', 'p')")).toThrow(/CHECK/);
    // Version 1's checks are kept.
    expect(() => db.exec("INSERT INTO audio_profiles (id, track_id, start_ms, end_ms) VALUES ('a4', 'u', 10, 5)")).toThrow(/CHECK/);
    db.exec("DELETE FROM sessions WHERE id = 's'");
    expect(one(db, "SELECT count(*) AS n FROM audio_profiles")).toEqual({ n: 0 });
  });

  it("SFX-11: only a spare pad can be put aside", () => {
    db.exec("INSERT INTO pads (id, board_id, spare_position, put_aside) VALUES ('p1', 'b', 1, 1)");
    db.exec("INSERT INTO pads (id, board_id, grid_row, grid_col) VALUES ('p2', 'b', 0, 0)");
    expect(one(db, "SELECT put_aside FROM pads WHERE id = 'p2'")).toEqual({ put_aside: 0 });
    expect(() => db.exec("UPDATE pads SET put_aside = 1 WHERE id = 'p2'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE pads SET grid_row = 1, grid_col = 1, spare_position = NULL WHERE id = 'p1'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE pads SET put_aside = 2 WHERE id = 'p1'")).toThrow(/CHECK/);
  });

  it("DAT-14: a track's names in scenes are part of its search entry", () => {
    const store = new Store(db);
    store.change("Name", () => db.exec("INSERT INTO scene_track_names (scene_id, track_id, name) VALUES ('x', 't', 'The wight rises')"));
    expect(all(db, "SELECT title, scene_names FROM search_fts WHERE search_fts MATCH 'wight'")).toEqual([{ title: "Bells", scene_names: "The wight rises" }]);
    store.change("Rename", () => db.exec("UPDATE scene_track_names SET name = 'Dawn' WHERE track_id = 't'"));
    expect(all(db, "SELECT title FROM search_fts WHERE search_fts MATCH 'wight'")).toEqual([]);
    expect(all(db, "SELECT title FROM search_fts WHERE search_fts MATCH 'dawn'")).toEqual([{ title: "Bells" }]);
    store.change("Unname", () => db.exec("DELETE FROM scene_track_names"));
    expect(all(db, "SELECT title FROM search_fts WHERE search_fts MATCH 'dawn'")).toEqual([]);
  });
});

describe("upgrading a version 2 library to version 3", () => {
  it("keeps every profile, peak, pad and search entry, and suggests a shape from the peaks already worked out", () => {
    const db = openConnection(":memory:");
    migrate(db, MIGRATIONS.slice(0, 2));
    db.exec(BASE);
    const rising = Buffer.from(Array.from({ length: 48 }, (_, i) => Math.round(40 + (200 * i) / 47)));
    db.prepare("INSERT INTO track_peaks (track_id, file_size, file_mtime_ms, levels, worked_out_at) VALUES ('t', 10, 20, ?, 30)").run(rising);
    db.exec(`
      INSERT INTO track_peaks (track_id, levels, worked_out_at) VALUES ('u', NULL, 31);
      INSERT INTO audio_profiles (id, track_id, scene_id, end_ms, fade_in_ms, fade_in_shape) VALUES ('a1', 't', 'x', 9000, 500, 40);
      INSERT INTO audio_profiles (id, track_id, playlist_id, after_end) VALUES ('a2', 't', 'p', 'stop');
      INSERT INTO audio_profile_markers (profile_id, position, at_ms, label) VALUES ('a1', 0, 100, 'Choir');
      INSERT INTO pads (id, board_id, spare_position, label) VALUES ('pad', 'b', 1, 'Mugs');
    `);
    // A track's search entry as version 2 wrote it (nine columns; a Store keeps it, but one made for version 3 cannot open
    // a version 2 file).
    db.exec(`UPDATE tracks SET title = 'Abbey bells' WHERE id = 't';
      INSERT INTO search_docs (kind, ref_id) VALUES ('track', 't');
      INSERT INTO search_fts (rowid, title, meta_title, file_name, artist, album, tags, markers, notes, cue)
        SELECT doc_id, 'Abbey bells', '', 't.flac', '', '', '', '', '', '' FROM search_docs WHERE kind = 'track' AND ref_id = 't';`);

    expect(migrate(db, MIGRATIONS)).toEqual({ from: 2, to: 3, applied: [3] });
    expect(all(db, "SELECT id, track_id, playlist_id, scene_id, session_id, end_ms, after_end, fade_in_ms, fade_in_shape FROM audio_profiles ORDER BY id")).toEqual([
      { id: "a1", track_id: "t", playlist_id: null, scene_id: "x", session_id: null, end_ms: 9000, after_end: null, fade_in_ms: 500, fade_in_shape: 40 },
      { id: "a2", track_id: "t", playlist_id: "p", scene_id: null, session_id: null, end_ms: null, after_end: "stop", fade_in_ms: null, fade_in_shape: null },
    ]);
    expect(all(db, "SELECT label FROM audio_profile_markers")).toEqual([{ label: "Choir" }]);
    expect(all(db, "SELECT track_id, file_size, file_mtime_ms, suggested_shape, worked_out_at, length(levels) AS n FROM track_peaks ORDER BY track_id")).toEqual([
      { track_id: "t", file_size: 10, file_mtime_ms: 20, suggested_shape: "builds", worked_out_at: 30, n: 48 },
      { track_id: "u", file_size: null, file_mtime_ms: null, suggested_shape: null, worked_out_at: 31, n: null },
    ]);
    expect(one(db, "SELECT shape FROM tracks WHERE id = 't'")).toEqual({ shape: null });
    expect(one(db, "SELECT put_aside FROM pads WHERE id = 'pad'")).toEqual({ put_aside: 0 });
    // track_peaks stays WITHOUT ROWID, and the profiles' lookup indexes are back.
    expect(one(db, "SELECT sql FROM sqlite_schema WHERE name = 'track_peaks'")).toEqual({ sql: expect.stringMatching(/WITHOUT ROWID$/) });
    const indexes = (all(db, "SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'audio_profiles' AND sql IS NOT NULL ORDER BY name") as { name: string }[]).map((r) => r.name);
    expect(indexes).toEqual(["audio_profiles_own", "audio_profiles_playlist", "audio_profiles_scene", "audio_profiles_session", "audio_profiles_track"]);
    // Search entries came across, and the triggers still follow changes.
    expect(all(db, "SELECT title FROM search_fts WHERE search_fts MATCH 'abbey' ORDER BY title")).toEqual([{ title: "Abbey" }, { title: "Abbey bells" }]);
    db.exec("UPDATE scenes SET name = 'Crypt' WHERE id = 'x'");
    expect(all(db, "SELECT title FROM search_fts WHERE search_fts MATCH 'crypt'")).toEqual([{ title: "Crypt" }]);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
    expect(one(db, "PRAGMA integrity_check")).toEqual({ integrity_check: "ok" });
    db.close();
  });
});
