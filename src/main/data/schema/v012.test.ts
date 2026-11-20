/**
 * Schema version 12 (0.6.0, f-live; round 9 §11, item 47): a pad's While it plays (pads.dip). An upgraded library keeps
 * every pad, each on the usual (null: a one-shot or Restart on press pad dips the music, a toggle or hold pad does not).
 */
import { afterEach, describe, expect, it } from "vitest";
import { openConnection, type DatabaseSync } from "../sqlite";
import { migrate, schemaVersion } from "./migrate";
import { MIGRATIONS } from "./index";

const all = (db: DatabaseSync, sql: string) => db.prepare(sql).all();
const BASE = `
  INSERT INTO boards (id, title, position, created_at, updated_at) VALUES ('b', 'Combat', 1, 1, 1);
  INSERT INTO pads (id, board_id, grid_row, grid_col, label, mode) VALUES ('door', 'b', 0, 0, 'Door', 'oneshot'), ('rain', 'b', 0, 1, 'Rain', 'toggle');
  INSERT INTO pads (id, board_id, spare_position, label, mode, put_aside) VALUES ('wolf', 'b', 1, 'Wolf', 'hold', 1);
`;

describe("schema version 12 (a pad's While it plays)", () => {
  let db: DatabaseSync;
  afterEach(() => db.close());

  it("upgrades a version 11 library: every pad is kept, each on the usual; nothing else changes", () => {
    db = openConnection(":memory:");
    migrate(db, MIGRATIONS.slice(0, 11));
    db.exec(BASE);
    const before = all(db, "SELECT * FROM pads ORDER BY id");
    expect(migrate(db, MIGRATIONS.slice(0, 12))).toEqual({ from: 11, to: 12, applied: [12] });
    expect(schemaVersion(db)).toBe(12);
    expect(all(db, "SELECT * FROM pads ORDER BY id")).toEqual(before.map((row) => ({ ...(row as object), dip: null as number | null })));
    expect(all(db, "PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("keeps Dip the music (1), Don't dip (0) or the usual (null), nothing else", () => {
    db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    expect(MIGRATIONS[11].version).toBe(12);
    db.exec(BASE);
    db.exec("UPDATE pads SET dip = 1 WHERE id = 'rain'; UPDATE pads SET dip = 0 WHERE id = 'door'");
    expect(all(db, "SELECT id, dip FROM pads ORDER BY id")).toEqual([
      { id: "door", dip: 0 },
      { id: "rain", dip: 1 },
      { id: "wolf", dip: null },
    ]);
    expect(() => db.exec("UPDATE pads SET dip = 2 WHERE id = 'door'")).toThrow(/CHECK/);
  });
});
