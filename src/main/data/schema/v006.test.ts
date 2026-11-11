/**
 * Schema version 6 (design round 7): colours from the pad palette for tag groups, tags and folders; dividers on pad
 * boards; steps for scenes and pads (PLY-8) and scenes that move on by themselves; a track's Follow with (SHW-3) and
 * Pick up where it stopped (PLY-4); the mix-out marker (DAT-3); keyboard shortcuts (UX-12) and the crossfade (PLY-8)
 * in the library's settings; pads found by search (UX-12 Find and play). Every CHECK and key, what goes with what,
 * and the upgrade from version 5 with data in it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConnection, type DatabaseSync } from "../sqlite";
import { migrate, schemaVersion } from "./migrate";
import { MIGRATIONS } from "./index";

const all = (db: DatabaseSync, sql: string) => db.prepare(sql).all();

const BASE = `
  INSERT INTO tracks (id, title, path, file_name, created_at, updated_at) VALUES ('t', 'Bells', '/t.flac', 't.flac', 1, 1), ('u', 'Rain', '/u.flac', 'u.flac', 1, 1);
  INSERT INTO playlists (id, title, position, created_at, updated_at) VALUES ('p', 'Abbey', 1, 1, 1);
  INSERT INTO boards (id, title, position, created_at, updated_at) VALUES ('b', 'Weather', 1, 1, 1);
  INSERT INTO pads (id, board_id, grid_row, grid_col, label) VALUES ('k', 'b', 0, 0, 'Thunder crack'), ('l', 'b', 0, 1, 'Abbey bell');
  INSERT INTO campaigns (id, name, position, created_at, updated_at) VALUES ('c', 'Crown', 1, 1, 1);
  INSERT INTO sessions (id, campaign_id, position, created_at, updated_at) VALUES ('s', 'c', 1, 1, 1);
  INSERT INTO scenes (id, session_id, name, position, created_at, updated_at) VALUES ('x', 's', 'Ruins', 1, 1, 1), ('y', 's', 'Crypt', 2, 1, 1);
`;

describe("schema version 6 (design round 7)", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    db.exec(BASE);
  });
  afterEach(() => db.close());

  it("is the newest version and leaves no broken link", () => {
    expect(schemaVersion(db)).toBe(6);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("DAT-10, ORG-4: tag groups, tags and folders take a colour name from the pad palette, or none", () => {
    db.exec("UPDATE tag_groups SET color = 'moss'");
    db.exec("INSERT INTO folders (id, scope, name, color, position) VALUES ('f', 'playlists', 'The abbey', 'sea', 1)");
    expect(() => db.exec("UPDATE tag_groups SET color = '#336699'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE tags SET color = 'pink'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE folders SET color = '#336699'")).toThrow(/CHECK/);
    db.exec("UPDATE tags SET color = NULL");
  });

  it("ORG-4: a board's dividers name a row each, and go with the board", () => {
    db.exec("INSERT INTO board_dividers (board_id, grid_row, label) VALUES ('b', 1, 'Spells'), ('b', 0, 'Weather')");
    expect(() => db.exec("INSERT INTO board_dividers (board_id, grid_row, label) VALUES ('b', 1, 'Again')")).toThrow(/UNIQUE|PRIMARY/);
    expect(() => db.exec("INSERT INTO board_dividers (board_id, grid_row, label) VALUES ('b', 8, 'Off')")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO board_dividers (board_id, grid_row, label) VALUES ('b', 2, '  ')")).toThrow(/CHECK/);
    db.exec("DELETE FROM boards WHERE id = 'b'");
    expect(all(db, "SELECT * FROM board_dividers")).toEqual([]);
  });

  it("PLY-8: a scene's or pad's own steps hang on one cue list per owner; each step has exactly its facts", () => {
    db.exec("INSERT INTO cue_lists (id, scene_id) VALUES ('L1', 'x'); INSERT INTO cue_lists (id, pad_id) VALUES ('L2', 'k')");
    expect(() => db.exec("INSERT INTO cue_lists (id, scene_id) VALUES ('L3', 'x')")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO cue_lists (id) VALUES ('L3')")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO cue_lists (id, scene_id, pad_id) VALUES ('L3', 'y', 'l')")).toThrow(/CHECK/);
    db.exec(`INSERT INTO cue_steps (id, list_id, position, action, playlist_id, comes_in, up_next) VALUES ('a', 'L1', 1, 'music', 'p', 'crossfade', 'replace');
      INSERT INTO cue_steps (id, list_id, position, action, level, duration_ms) VALUES ('b', 'L1', 2, 'fade', 0.3, 2000);
      INSERT INTO cue_steps (id, list_id, position, action, target_pad_id) VALUES ('c', 'L1', 3, 'pad', 'l');
      INSERT INTO cue_steps (id, list_id, position, action, target_scene_id) VALUES ('d', 'L1', 4, 'scene', 'y');
      INSERT INTO cue_steps (id, list_id, position, action) VALUES ('e', 'L2', 1, 'sound');
      INSERT INTO cue_steps (id, list_id, position, action, track_id, comes_in, up_next, from_ms) VALUES ('f', 'L2', 2, 'play', 't', 'mixOut', 'playNext', 1200);
      INSERT INTO cue_steps (id, list_id, position, action, stop_what) VALUES ('g', 'L2', 3, 'stop', 'all');
      INSERT INTO cue_steps (id, list_id, position, action, duration_ms) VALUES ('h', 'L2', 4, 'wait', 5000);
      INSERT INTO cue_steps (id, list_id, position, action, board_id) VALUES ('i', 'L1', 5, 'board', 'b');`);
    const bad = [
      "INSERT INTO cue_steps (id, list_id, position, action) VALUES ('z', 'L1', 9, 'jump')",
      "INSERT INTO cue_steps (id, list_id, position, action, comes_in, up_next) VALUES ('z', 'L1', 9, 'play', 'cut', 'replace')",
      "INSERT INTO cue_steps (id, list_id, position, action, track_id, playlist_id, comes_in, up_next) VALUES ('z', 'L1', 9, 'play', 't', 'p', 'cut', 'replace')",
      "INSERT INTO cue_steps (id, list_id, position, action, track_id, up_next) VALUES ('z', 'L1', 9, 'play', 't', 'replace')",
      "INSERT INTO cue_steps (id, list_id, position, action, track_id, comes_in, up_next) VALUES ('z', 'L1', 9, 'play', 't', 'slowly', 'replace')",
      "INSERT INTO cue_steps (id, list_id, position, action, level, duration_ms) VALUES ('z', 'L1', 9, 'fade', 1.5, 2000)",
      "INSERT INTO cue_steps (id, list_id, position, action, duration_ms) VALUES ('z', 'L1', 9, 'wait', 700000)",
      "INSERT INTO cue_steps (id, list_id, position, action, stop_what, from_ms) VALUES ('z', 'L1', 9, 'stop', 'music', 5)",
      "INSERT INTO cue_steps (id, list_id, position, action, stop_what) VALUES ('z', 'L1', 9, 'stop', 'pads')",
      "INSERT INTO cue_steps (id, list_id, position, action, track_id) VALUES ('z', 'L1', 9, 'sound', 't')",
      "INSERT INTO cue_steps (id, list_id, position, action, target_pad_id) VALUES ('z', 'L1', 9, 'scene', 'k')",
    ];
    for (const sql of bad) expect(() => db.exec(sql), sql).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO cue_steps (id, list_id, position, action) VALUES ('z', 'L2', 1, 'sound')")).toThrow(/UNIQUE/);
    // A step whose pad, scene, track or board is deleted could do nothing: it goes. The owner's list goes with it.
    db.exec("DELETE FROM pads WHERE id = 'l'");
    db.exec("DELETE FROM scenes WHERE id = 'y'");
    db.exec("DELETE FROM tracks WHERE id = 't'");
    expect(all(db, "SELECT id FROM cue_steps ORDER BY id")).toEqual([{ id: "a" }, { id: "b" }, { id: "e" }, { id: "g" }, { id: "h" }, { id: "i" }]);
    db.exec("DELETE FROM pads WHERE id = 'k'");
    expect(all(db, "SELECT id FROM cue_lists")).toEqual([{ id: "L1" }]);
    db.exec("DELETE FROM scenes WHERE id = 'x'");
    expect(all(db, "SELECT * FROM cue_steps")).toEqual([]);
  });

  it("PLY-8: a scene moves on when its music ends or after a time, with the scene", () => {
    db.exec("INSERT INTO scene_moves_on (scene_id, moves_on) VALUES ('x', 'musicEnds'); INSERT INTO scene_moves_on (scene_id, moves_on, after_ms) VALUES ('y', 'after', 300000)");
    expect(() => db.exec("UPDATE scene_moves_on SET after_ms = 5 WHERE scene_id = 'x'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE scene_moves_on SET after_ms = NULL WHERE scene_id = 'y'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE scene_moves_on SET moves_on = 'stay' WHERE scene_id = 'x'")).toThrow(/CHECK/);
    db.exec("DELETE FROM scenes WHERE id = 'y'");
    expect(all(db, "SELECT scene_id FROM scene_moves_on")).toEqual([{ scene_id: "x" }]);
  });

  it("SHW-3, PLY-4: a track follows with one track or playlist; picks up where it stopped", () => {
    db.exec("INSERT INTO track_follows (track_id, follow_playlist_id) VALUES ('t', 'p'); INSERT INTO track_follows (track_id, follow_track_id) VALUES ('u', 't')");
    expect(() => db.exec("INSERT INTO track_follows (track_id, follow_track_id) VALUES ('t', 'u')")).toThrow(/UNIQUE|PRIMARY/);
    expect(() => db.exec("UPDATE track_follows SET follow_track_id = 'u' WHERE track_id = 'u'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE track_follows SET follow_track_id = 'u' WHERE track_id = 't'")).toThrow(/CHECK/);
    db.exec("DELETE FROM playlists WHERE id = 'p'");
    expect(all(db, "SELECT track_id FROM track_follows")).toEqual([{ track_id: "u" }]);
    db.exec("UPDATE tracks SET resume = 1 WHERE id = 't'");
    expect(() => db.exec("UPDATE tracks SET resume = 2")).toThrow(/CHECK/);
  });

  it("DAT-3: one mix-out marker per profile", () => {
    db.exec("INSERT INTO audio_profiles (id, track_id) VALUES ('ap', 't')");
    db.exec("INSERT INTO audio_profile_markers (profile_id, position, at_ms, label, mix_out) VALUES ('ap', 0, 1000, 'Swell', 1), ('ap', 1, 2000, 'Low', 0)");
    expect(() => db.exec("UPDATE audio_profile_markers SET mix_out = 1 WHERE position = 1")).toThrow(/UNIQUE/);
    expect(() => db.exec("UPDATE audio_profile_markers SET mix_out = 2 WHERE position = 0")).toThrow(/CHECK/);
  });

  it("UX-12, PLY-8: changed keys once each and the crossfade in the library's settings", () => {
    expect(all(db, "SELECT crossfade_ms, crossfade_curve, next_scene_guard FROM library_settings")).toEqual([{ crossfade_ms: 3000, crossfade_curve: "even", next_scene_guard: 1 }]);
    db.exec("INSERT INTO shortcut_keys (action, key) VALUES ('palette', 'Ctrl+J')");
    expect(() => db.exec("INSERT INTO shortcut_keys (action, key) VALUES ('find', 'ctrl+j')")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO shortcut_keys (action, key) VALUES ('dance', 'D')")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE library_settings SET crossfade_ms = 30000")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE library_settings SET crossfade_curve = 'steep'")).toThrow(/CHECK/);
  });

  it("DAT-10: a track's tags remember the order they were added in (added), 0 when not said", () => {
    db.exec(`INSERT INTO track_tags (track_id, tag_id, added) SELECT 't', id, 2 FROM tags WHERE name = 'Tense';
      INSERT INTO track_tags (track_id, tag_id) SELECT 'u', id FROM tags WHERE name = 'Tense';`);
    expect(all(db, "SELECT track_id, added FROM track_tags ORDER BY track_id")).toEqual([
      { track_id: "t", added: 2 },
      { track_id: "u", added: 0 },
    ]);
  });

  it("UX-12: pads are found by search with their label", () => {
    const docs = () => all(db, "SELECT d.ref_id AS id, f.title FROM search_docs d JOIN search_fts f ON f.rowid = d.doc_id WHERE d.kind = 'pad' ORDER BY d.ref_id");
    expect(docs()).toEqual([
      { id: "k", title: "Thunder crack" },
      { id: "l", title: "Abbey bell" },
    ]);
    db.exec("UPDATE pads SET label = 'Great bell' WHERE id = 'l'");
    db.exec("DELETE FROM pads WHERE id = 'k'");
    expect(docs()).toEqual([{ id: "l", title: "Great bell" }]);
  });
});

describe("upgrading a version 5 library to version 6", () => {
  it("keeps tags, folders, follow suggestions and markers; colours not in the palette are dropped; pads are found", () => {
    const db = openConnection(":memory:");
    migrate(db, MIGRATIONS.slice(0, 5));
    db.exec(BASE);
    db.exec(`UPDATE tag_groups SET color = CASE WHEN name = 'Mood' THEN 'ember' ELSE '#123456' END;
      UPDATE tags SET color = 'sea' WHERE name = 'Tense';
      INSERT INTO folders (id, scope, name, color, position) VALUES ('f', 'boards', 'Weather', '#aabbcc', 1);
      INSERT INTO track_follow_with (track_id, follow_track_id, position) VALUES ('t', 'u', 1);
      INSERT INTO audio_profiles (id, track_id) VALUES ('ap', 't');
      INSERT INTO audio_profile_markers (profile_id, position, at_ms, label) VALUES ('ap', 0, 1000, 'Swell');
      INSERT INTO repeat_ones (scene_id, track_id) VALUES ('x', 't');`);
    const tags = all(db, "SELECT id, group_id, name, parent_id, position FROM tags ORDER BY position");
    expect(migrate(db, MIGRATIONS)).toMatchObject({ from: 5, to: 6, applied: [6] });
    expect(all(db, "SELECT id, group_id, name, parent_id, position FROM tags ORDER BY position")).toEqual(tags);
    expect(all(db, "SELECT name, color FROM tag_groups ORDER BY position")).toEqual([
      { name: "Mood", color: "ember" },
      { name: "Leitmotif", color: null },
      { name: "Scene type", color: null },
    ]);
    expect(all(db, "SELECT color FROM tags WHERE name = 'Tense'")).toEqual([{ color: "sea" }]);
    expect(all(db, "SELECT id, name, color FROM folders")).toEqual([{ id: "f", name: "Weather", color: null }]);
    // The first suggestion of version 1's list becomes the track's Follow with.
    expect(all(db, "SELECT track_id, follow_track_id, follow_playlist_id FROM track_follows")).toEqual([{ track_id: "t", follow_track_id: "u", follow_playlist_id: null }]);
    expect(all(db, "SELECT label, mix_out FROM audio_profile_markers")).toEqual([{ label: "Swell", mix_out: 0 }]);
    expect(all(db, "SELECT scene_id FROM repeat_ones")).toEqual([{ scene_id: "x" }]);
    expect(all(db, "SELECT count(*) AS n FROM search_docs WHERE kind = 'pad'")).toEqual([{ n: 2 }]);
    // The tag rebuild keeps rules' composite keys and the track tagging working.
    db.exec("INSERT INTO track_tags (track_id, tag_id) SELECT 't', id FROM tags WHERE name = 'Tense'");
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
    db.close();
  });
});

describe("upgrading a version 5 library to version 6: the order of a track's tags", () => {
  it("numbers each track's tags in vocabulary order, so a library looks as it did before", () => {
    const db = openConnection(":memory:");
    migrate(db, MIGRATIONS.slice(0, 5));
    db.exec(BASE);
    // Tagged out of vocabulary order (Melancholy, Heroic, Tense, … Eerie): Eerie first, Heroic last.
    const id = (name: string) => (all(db, `SELECT id FROM tags WHERE name = '${name}'`)[0] as { id: string }).id;
    const [eerie, tense, heroic] = ["Eerie", "Tense", "Heroic"].map(id);
    db.exec(`INSERT INTO track_tags (track_id, tag_id) VALUES ('t', '${eerie}'), ('t', '${tense}'), ('t', '${heroic}'), ('u', '${eerie}')`);
    const vocabulary = all(db, `SELECT tt.track_id, t.name FROM track_tags tt JOIN tags t ON t.id = tt.tag_id JOIN tag_groups g ON g.id = t.group_id
      ORDER BY tt.track_id, g.position, t.position, t.rowid`);
    migrate(db, MIGRATIONS);
    expect(all(db, `SELECT tt.track_id, t.name FROM track_tags tt JOIN tags t ON t.id = tt.tag_id ORDER BY tt.track_id, tt.added`)).toEqual(vocabulary);
    expect(all(db, "SELECT added FROM track_tags WHERE track_id = 'u'")).toEqual([{ added: 1 }]);
    db.close();
  });
});
