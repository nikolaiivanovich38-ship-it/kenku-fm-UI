/**
 * Schema version 4 (PLY-15, DAT-15 volume normalisation): every new CHECK and key, and the upgrade from version 3
 * with data in it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConnection, type DatabaseSync } from "../sqlite";
import { migrate, schemaVersion } from "./migrate";
import { MIGRATIONS } from "./index";

const one = (db: DatabaseSync, sql: string) => db.prepare(sql).get();
const all = (db: DatabaseSync, sql: string) => db.prepare(sql).all();

const BASE = `
  INSERT INTO tracks (id, title, path, file_name, file_size, file_mtime_ms, created_at, updated_at) VALUES ('t', 'Bells', '/t.flac', 't.flac', 10, 20, 1, 1), ('u', 'Rain', '/u.flac', 'u.flac', 5, 6, 1, 1);
  INSERT INTO playlists (id, title, position, created_at, updated_at) VALUES ('p', 'Abbey', 1, 1, 1);
`;

describe("schema version 4 (volume normalisation)", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    db.exec(BASE);
  });
  afterEach(() => db.close());

  it("is in place and leaves no broken link", () => {
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("PLY-15: the library's setting is one row, off at first with the Standard target, and only known targets", () => {
    expect(all(db, "SELECT id, normalise_on, normalise_target FROM library_settings")).toEqual([{ id: 1, normalise_on: 0, normalise_target: "standard" }]);
    expect(() => db.exec("INSERT INTO library_settings (id) VALUES (2)")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE library_settings SET normalise_target = 'deafening'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE library_settings SET normalise_on = 2")).toThrow(/CHECK/);
    db.exec("UPDATE library_settings SET normalise_on = 1, normalise_target = 'loud'");
    db.exec("UPDATE library_settings SET normalise_target = 'quiet'");
  });

  it("PLY-15: a track's and a playlist's own choice is on, off or none (the library's)", () => {
    db.exec("UPDATE tracks SET normalise = 'off' WHERE id = 't'");
    db.exec("UPDATE playlists SET normalise = 'on' WHERE id = 'p'");
    expect(one(db, "SELECT normalise FROM tracks WHERE id = 'u'")).toEqual({ normalise: null });
    expect(() => db.exec("UPDATE tracks SET normalise = 'library' WHERE id = 'u'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE playlists SET normalise = 'yes' WHERE id = 'p'")).toThrow(/CHECK/);
  });

  it("DAT-15: one loudness row per track, with the file it was measured from, gone with the track", () => {
    db.exec("INSERT INTO track_loudness (track_id, file_size, file_mtime_ms, lufs, true_peak_db, measured_at) VALUES ('t', 10, 20, -22.6, -8.0, 30)");
    // NULL loudness: the file could not be measured (unreadable, or silent).
    db.exec("INSERT INTO track_loudness (track_id, file_size, file_mtime_ms, lufs, true_peak_db, measured_at) VALUES ('u', 5, 6, NULL, NULL, 31)");
    expect(() => db.exec("INSERT INTO track_loudness (track_id, lufs, true_peak_db, measured_at) VALUES ('t', -20, -3, 1)")).toThrow(/UNIQUE|PRIMARY/);
    db.exec("DELETE FROM track_loudness");
    expect(() => db.exec("INSERT INTO track_loudness (track_id, lufs, true_peak_db, measured_at) VALUES ('t', -20, NULL, 1)")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO track_loudness (track_id, lufs, true_peak_db, measured_at) VALUES ('t', -80, -3, 1)")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO track_loudness (track_id, lufs, true_peak_db, measured_at) VALUES ('t', 3, -3, 1)")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO track_loudness (track_id, lufs, true_peak_db, measured_at) VALUES ('t', -20, 30, 1)")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO track_loudness (track_id, file_size, lufs, true_peak_db, measured_at) VALUES ('t', -1, -20, -3, 1)")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO track_loudness (track_id, lufs, true_peak_db, measured_at) VALUES ('nope', -20, -3, 1)")).toThrow(/FOREIGN KEY/);
    db.exec("INSERT INTO track_loudness (track_id, lufs, true_peak_db, measured_at) VALUES ('t', -20, -3, 1)");
    db.exec("DELETE FROM tracks WHERE id = 't'");
    expect(all(db, "SELECT track_id FROM track_loudness")).toEqual([]);
  });
});

describe("upgrading a version 3 library to version 4", () => {
  it("keeps every track, playlist and peak; nothing is measured yet and the library is not normalised", () => {
    const db = openConnection(":memory:");
    migrate(db, MIGRATIONS.slice(0, 3));
    db.exec(BASE);
    db.exec("INSERT INTO track_peaks (track_id, file_size, file_mtime_ms, levels, worked_out_at) VALUES ('t', 10, 20, NULL, 30)");
    expect(migrate(db, MIGRATIONS.slice(0, 4))).toMatchObject({ from: 3, to: 4, applied: [4] });
    expect(all(db, "SELECT id, normalise FROM tracks ORDER BY id")).toEqual([
      { id: "t", normalise: null },
      { id: "u", normalise: null },
    ]);
    expect(all(db, "SELECT id, title, normalise FROM playlists")).toEqual([{ id: "p", title: "Abbey", normalise: null }]);
    expect(all(db, "SELECT track_id FROM track_peaks")).toEqual([{ track_id: "t" }]);
    expect(all(db, "SELECT * FROM track_loudness")).toEqual([]);
    expect(one(db, "SELECT normalise_on, normalise_target FROM library_settings")).toEqual({ normalise_on: 0, normalise_target: "standard" });
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
    db.close();
  });
});
