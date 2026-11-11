/**
 * Schema version 7 (0.5.1, Nik 11 Nov: "Start at [marker]" in the Audio profile): the new column, its CHECK, and the
 * upgrade from version 6 with a profile in it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConnection, type DatabaseSync } from "../sqlite";
import { migrate, schemaVersion } from "./migrate";
import { MIGRATIONS } from "./index";

const all = (db: DatabaseSync, sql: string) => db.prepare(sql).all();

const BASE = `
  INSERT INTO tracks (id, title, path, file_name, file_size, file_mtime_ms, created_at, updated_at) VALUES ('t', 'Bells', '/t.flac', 't.flac', 10, 20, 1, 1);
  INSERT INTO audio_profiles (id, track_id, start_ms, end_ms) VALUES ('ap', 't', 1000, 90000);
`;

describe("schema version 7 (Start at)", () => {
  let db: DatabaseSync;
  afterEach(() => db.close());

  describe("new", () => {
    beforeEach(() => {
      db = openConnection(":memory:");
      migrate(db, MIGRATIONS);
      db.exec(BASE);
    });

    it("is in place and leaves no broken link", () => {
      expect(schemaVersion(db)).toBe(MIGRATIONS.length);
      expect(MIGRATIONS.length).toBe(7);
      expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
    });

    it("a profile's Start at is a time in the file, or NULL for the Beginning", () => {
      expect(all(db, "SELECT start_at_ms FROM audio_profiles")).toEqual([{ start_at_ms: null }]);
      db.exec("UPDATE audio_profiles SET start_at_ms = 30000");
      expect(all(db, "SELECT start_at_ms FROM audio_profiles")).toEqual([{ start_at_ms: 30000 }]);
      expect(() => db.exec("UPDATE audio_profiles SET start_at_ms = -1")).toThrow(/CHECK/);
    });
  });

  it("upgrades a version 6 library, keeping its profiles, with no Start at", () => {
    db = openConnection(":memory:");
    migrate(db, MIGRATIONS.slice(0, 6));
    db.exec(BASE);
    expect(schemaVersion(db)).toBe(6);
    migrate(db, MIGRATIONS);
    expect(schemaVersion(db)).toBe(7);
    expect(all(db, "SELECT id, start_ms, end_ms, start_at_ms FROM audio_profiles")).toEqual([{ id: "ap", start_ms: 1000, end_ms: 90000, start_at_ms: null }]);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
  });
});
