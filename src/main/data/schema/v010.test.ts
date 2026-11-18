/**
 * Schema version 10 (0.5.2 review): a waveform saved before 0.5.2 was worked out without checking the track's length,
 * so the length a cut or joined MP3's tags got wrong (3 s for a 20 s file) was never put right. `length_checked` marks
 * the waveforms whose length still needs the whole-file check; the upgrade marks the MP3s' (other formats' lengths
 * come from their headers, which count every sample).
 */
import { afterEach, describe, expect, it } from "vitest";
import { openConnection, type DatabaseSync } from "../sqlite";
import { migrate, schemaVersion } from "./migrate";
import { MIGRATIONS } from "./index";

const all = (db: DatabaseSync, sql: string) => db.prepare(sql).all();

const BASE = `
  INSERT INTO tracks (id, title, path, file_name, file_size, file_mtime_ms, duration_ms, created_at, updated_at) VALUES
    ('joined', '', '/Monster Books.MP3', 'Monster Books.MP3', 10, 20, 3030, 1, 1),
    ('flac', '', '/b.flac', 'b.flac', 10, 20, 20000, 1, 1),
    ('unread', '', '/c.mp3', 'c.mp3', 10, 20, 1000, 1, 1),
    ('none', '', '/d.mp3', 'd.mp3', 10, 20, 1000, 1, 1);
  INSERT INTO track_peaks (track_id, file_size, file_mtime_ms, levels, worked_out_at) VALUES
    ('joined', 10, 20, x'0102', 1), ('flac', 10, 20, x'0102', 1), ('unread', 10, 20, NULL, 1);
`;

describe("schema version 10 (a waveform's length checked)", () => {
  let db: DatabaseSync;
  afterEach(() => db.close());

  it("is in place: a new waveform says whether its length was checked, 0 or 1", () => {
    db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(MIGRATIONS[9].version).toBe(10);
    db.exec(BASE);
    expect(() => db.exec("UPDATE track_peaks SET length_checked = 2")).toThrow(/CHECK/);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("upgrades a version 9 library with waveforms saved: an MP3's waveform needs its length checked, other files' do not", () => {
    db = openConnection(":memory:");
    migrate(db, MIGRATIONS.slice(0, 9));
    db.exec(BASE);
    expect(migrate(db, MIGRATIONS.slice(0, 10))).toEqual({ from: 9, to: 10, applied: [10] });
    expect(all(db, "SELECT track_id, length_checked FROM track_peaks ORDER BY track_id")).toEqual([
      { track_id: "flac", length_checked: 1 },
      { track_id: "joined", length_checked: 0 },
      // A file that could not be read is not read again for its length.
      { track_id: "unread", length_checked: 1 },
    ]);
    expect(all(db, "SELECT id, duration_ms FROM tracks WHERE id = 'joined'")).toEqual([{ id: "joined", duration_ms: 3030 }]);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
  });
});
