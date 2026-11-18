/**
 * Schema version 8 (0.5.2, w52-prep, Nik's item 13: session numbers typed by hand): the new columns, their CHECKs,
 * and the upgrade from version 7 with a campaign and its sessions in it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConnection, type DatabaseSync } from "../sqlite";
import { migrate, schemaVersion } from "./migrate";
import { MIGRATIONS } from "./index";

const all = (db: DatabaseSync, sql: string) => db.prepare(sql).all();

const BASE = `
  INSERT INTO campaigns (id, name, first_session_number, position, created_at, updated_at) VALUES ('c', 'Crown', 12, 1, 1, 1);
  INSERT INTO sessions (id, campaign_id, name, status, position, created_at, updated_at) VALUES ('s1', 'c', '', 'played', 1, 1, 1), ('s2', 'c', '', 'next', 2, 1, 1);
`;

describe("schema version 8 (session numbers typed by hand)", () => {
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
      expect(MIGRATIONS[7].version).toBe(8);
      expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
    });

    it("a campaign counts on by itself or keeps typed numbers; a typed number is 0 to 100000", () => {
      expect(all(db, "SELECT session_numbering FROM campaigns")).toEqual([{ session_numbering: "auto" }]);
      db.exec("UPDATE campaigns SET session_numbering = 'typed'");
      expect(() => db.exec("UPDATE campaigns SET session_numbering = 'roman'")).toThrow(/CHECK/);
      expect(all(db, "SELECT typed_number FROM sessions ORDER BY position")).toEqual([{ typed_number: null }, { typed_number: null }]);
      db.exec("UPDATE sessions SET typed_number = 40 WHERE id = 's2'");
      expect(() => db.exec("UPDATE sessions SET typed_number = -1")).toThrow(/CHECK/);
      expect(() => db.exec("UPDATE sessions SET typed_number = 100001")).toThrow(/CHECK/);
    });
  });

  it("upgrades a version 7 library: its campaigns count on from their first number, as before", () => {
    db = openConnection(":memory:");
    migrate(db, MIGRATIONS.slice(0, 7));
    db.exec(BASE);
    expect(schemaVersion(db)).toBe(7);
    migrate(db, MIGRATIONS.slice(0, 8));
    expect(schemaVersion(db)).toBe(8);
    expect(all(db, "SELECT id, first_session_number, session_numbering FROM campaigns")).toEqual([{ id: "c", first_session_number: 12, session_numbering: "auto" }]);
    expect(all(db, "SELECT id, typed_number FROM sessions ORDER BY position")).toEqual([{ id: "s1", typed_number: null }, { id: "s2", typed_number: null }]);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
  });
});
