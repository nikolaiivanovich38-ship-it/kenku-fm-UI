/**
 * Schema version 11 (0.6.0, round 9 §10): a track can be a part of another, playing its part of the same file. The
 * indexes that keep one track per file let a part share its whole's file, and still find the whole track by its file.
 */
import { afterEach, describe, expect, it } from "vitest";
import { openConnection, type DatabaseSync } from "../sqlite";
import { migrate, schemaVersion } from "./migrate";
import { MIGRATIONS } from "./index";

const all = (db: DatabaseSync, sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args);
const BASE = `
  INSERT INTO library_roots (id, name, path, created_at) VALUES ('r', 'Scores', '/scores', 1);
  INSERT INTO tracks (id, title, root_id, path, file_name, duration_ms, created_at, updated_at) VALUES
    ('whole', '', 'r', 'a/Bridge.flac', 'Bridge.flac', 441000, 1, 1),
    ('loose', '', NULL, '/elsewhere/b.flac', 'b.flac', 1000, 1, 1);
`;

describe("schema version 11 (track parts)", () => {
  let db: DatabaseSync;
  afterEach(() => db.close());

  it("is in place: parts share their whole's file; two whole tracks still cannot", () => {
    db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(MIGRATIONS[10].version).toBe(11);
    db.exec(BASE);
    db.exec(`INSERT INTO tracks (id, title, root_id, path, file_name, duration_ms, part_of, part_start_ms, part_end_ms, created_at, updated_at) VALUES
      ('p1', 'Opening', 'r', 'a/Bridge.flac', 'Bridge.flac', 441000, 'whole', 0, 64000, 2, 2),
      ('p2', 'Choir', 'r', 'A/BRIDGE.FLAC', 'Bridge.flac', 441000, 'whole', 64000, 318000, 2, 2),
      ('p3', 'Loose part', NULL, '/elsewhere/b.flac', 'b.flac', 1000, 'loose', 0, 500, 2, 2)`);
    expect(() => db.exec(`INSERT INTO tracks (id, title, root_id, path, file_name, created_at, updated_at) VALUES ('again', '', 'r', 'a/bridge.flac', 'x', 1, 1)`)).toThrow(/UNIQUE/);
    expect(() => db.exec(`INSERT INTO tracks (id, title, path, file_name, created_at, updated_at) VALUES ('again2', '', '/elsewhere/B.flac', 'x', 1, 1)`)).toThrow(/UNIQUE/);
    expect(() => db.exec("UPDATE tracks SET part_start_ms = -1 WHERE id = 'p1'")).toThrow(/CHECK/);
    // The whole track is found by its file through the same index; its parts by part_of.
    expect(all(db, "SELECT id FROM tracks WHERE root_id = ? AND path = ? COLLATE NOCASE AND part_of IS NULL", "r", "a/bridge.flac")).toEqual([{ id: "whole" }]);
    expect(all(db, "SELECT id FROM tracks WHERE part_of = ? ORDER BY part_start_ms", "whole")).toEqual([{ id: "p1" }, { id: "p2" }]);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("upgrades a version 10 library: every track is whole, and nothing else changes", () => {
    db = openConnection(":memory:");
    migrate(db, MIGRATIONS.slice(0, 10));
    db.exec(BASE);
    expect(migrate(db, MIGRATIONS.slice(0, 11))).toEqual({ from: 10, to: 11, applied: [11] });
    expect(all(db, "SELECT id, part_of, part_start_ms, part_end_ms, duration_ms FROM tracks ORDER BY id")).toEqual([
      { id: "loose", part_of: null, part_start_ms: null, part_end_ms: null, duration_ms: 1000 },
      { id: "whole", part_of: null, part_start_ms: null, part_end_ms: null, duration_ms: 441000 },
    ]);
    expect(all(db, "PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
  });
});
