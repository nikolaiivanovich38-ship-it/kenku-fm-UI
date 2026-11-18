/**
 * Schema version 8 (0.5.2, Nik's play test of 14 Nov): a track with a tag is no longer New (item 10), and a library
 * folder can say what kind its new tracks are (item 40). The new column and trigger, and the upgrade from version 7.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConnection, type DatabaseSync } from "../sqlite";
import { migrate, schemaVersion } from "./migrate";
import { MIGRATIONS } from "./index";

const all = (db: DatabaseSync, sql: string) => db.prepare(sql).all();

const BASE = `
  INSERT INTO library_roots (id, name, path, watched, created_at) VALUES ('r', 'Sounds', '/sounds', 1, 1);
  INSERT INTO tracks (id, title, path, file_name, file_size, file_mtime_ms, created_at, updated_at, is_new) VALUES
    ('untitled', '', '/a.flac', 'a.flac', 10, 20, 1, 1, 1),
    ('plain', '', '/b.flac', 'b.flac', 10, 20, 1, 1, 1);
  INSERT INTO tag_groups (id, name, position) VALUES ('g8', 'Group 8', 99);
  INSERT INTO tags (id, group_id, name, position) VALUES ('eerie', 'g8', 'Eerie', 1);
`;

describe("schema version 8 (New after a tag, a folder's kind of new tracks)", () => {
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
      expect(MIGRATIONS.length).toBe(8);
      expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
    });

    it("item 10: a tag settles a New track, even with no title of its own", () => {
      db.exec("INSERT INTO track_tags (track_id, tag_id) VALUES ('untitled', 'eerie')");
      expect(all(db, "SELECT id, is_new FROM tracks ORDER BY id")).toEqual([
        { id: "plain", is_new: 1 },
        { id: "untitled", is_new: 0 },
      ]);
      // A title alone does not.
      db.exec("UPDATE tracks SET title = 'Bells' WHERE id = 'plain'");
      expect(all(db, "SELECT is_new FROM tracks WHERE id = 'plain'")).toEqual([{ is_new: 1 }]);
    });

    it("item 40: a library folder's new tracks are guessed (NULL) or always music, ambience or effects", () => {
      expect(all(db, "SELECT new_kind FROM library_roots")).toEqual([{ new_kind: null }]);
      for (const kind of ["music", "amb", "fx"]) {
        db.exec(`UPDATE library_roots SET new_kind = '${kind}'`);
        expect(all(db, "SELECT new_kind FROM library_roots")).toEqual([{ new_kind: kind }]);
      }
      expect(() => db.exec("UPDATE library_roots SET new_kind = 'sting'")).toThrow(/CHECK/);
    });
  });

  it("upgrades a version 7 library: tagged New tracks settle, folders keep guessing", () => {
    db = openConnection(":memory:");
    migrate(db, MIGRATIONS.slice(0, 7));
    db.exec(BASE);
    // Version 7 kept a tagged track with no title New.
    db.exec("INSERT INTO track_tags (track_id, tag_id) VALUES ('untitled', 'eerie')");
    expect(all(db, "SELECT is_new FROM tracks WHERE id = 'untitled'")).toEqual([{ is_new: 1 }]);
    migrate(db, MIGRATIONS);
    expect(schemaVersion(db)).toBe(8);
    expect(all(db, "SELECT id, is_new FROM tracks ORDER BY id")).toEqual([
      { id: "plain", is_new: 1 },
      { id: "untitled", is_new: 0 },
    ]);
    expect(all(db, "SELECT id, path, watched, new_kind FROM library_roots")).toEqual([{ id: "r", path: "/sounds", watched: 1, new_kind: null }]);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
  });
});
