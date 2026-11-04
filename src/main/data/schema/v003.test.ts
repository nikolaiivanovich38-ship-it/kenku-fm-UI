/**
 * Schema version 3 (import stream: EDT-6, DAT-9): new tracks are marked New
 * until they have a title of their own and a tag, and long library jobs (moving
 * the old player's library in) record where they got to.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConnection, type DatabaseSync } from "../sqlite";
import { migrate, schemaVersion } from "./migrate";
import { MIGRATIONS } from "./index";

let db: DatabaseSync;
beforeEach(() => {
  db = openConnection(":memory:");
});
afterEach(() => db.close());

const run = (sql: string) => db.exec(sql);
const get = (sql: string) => db.prepare(sql).get();

describe("schema version 3", () => {
  it("is the latest version and upgrades a version-2 library without touching its tracks", () => {
    migrate(db, MIGRATIONS.slice(0, 2), () => 1);
    run(`INSERT INTO tracks (id, title, path, file_name, created_at, updated_at) VALUES ('t1', 'Secunda', '/m/a.flac', 'a.flac', 1, 1)`);
    migrate(db, MIGRATIONS, () => 2);
    expect(schemaVersion(db)).toBe(3);
    expect(MIGRATIONS[2].version).toBe(3);
    expect(get("SELECT id, title, is_new FROM tracks")).toEqual({ id: "t1", title: "Secunda", is_new: 0 });
  });

  it("keeps the New mark to yes or no", () => {
    migrate(db, MIGRATIONS, () => 1);
    expect(() => run(`INSERT INTO tracks (id, path, is_new, created_at, updated_at) VALUES ('t1', '/a.mp3', 2, 1, 1)`)).toThrow(
      /CHECK constraint failed/,
    );
  });

  it("settles a new track once it has a title of its own and a tag, in either order (the prototype's settle)", () => {
    migrate(db, MIGRATIONS, () => 1);
    const tag = (get("SELECT id FROM tags WHERE name = 'Tense'") as { id: string }).id;
    run(`INSERT INTO tracks (id, path, is_new, created_at, updated_at) VALUES
           ('a', '/a.mp3', 1, 1, 1), ('b', '/b.mp3', 1, 1, 1), ('c', '/c.mp3', 1, 1, 1)`);
    const isNew = (id: string) => (get(`SELECT is_new FROM tracks WHERE id = '${id}'`) as { is_new: number }).is_new;

    run(`INSERT INTO track_tags (track_id, tag_id) VALUES ('a', '${tag}')`);
    expect(isNew("a")).toBe(1); // tagged, but no title of its own yet
    run(`UPDATE tracks SET title = 'Ambush' WHERE id = 'a'`);
    expect(isNew("a")).toBe(0);

    run(`UPDATE tracks SET title = 'Rain' WHERE id = 'b'`);
    expect(isNew("b")).toBe(1); // titled, not tagged yet
    run(`INSERT INTO track_tags (track_id, tag_id) VALUES ('b', '${tag}')`);
    expect(isNew("b")).toBe(0);

    run(`UPDATE tracks SET title = '' WHERE id = 'c'`);
    expect(isNew("c")).toBe(1);
  });

  it("records library jobs with a state and a valid JSON detail", () => {
    migrate(db, MIGRATIONS, () => 1);
    run(`INSERT INTO library_jobs (name, state, detail, started_at) VALUES ('legacy-player', 'running', '{}', 1)`);
    expect(() => run(`INSERT INTO library_jobs (name, state, detail, started_at) VALUES ('x', 'paused', '{}', 1)`)).toThrow(/CHECK/);
    expect(() => run(`INSERT INTO library_jobs (name, state, detail, started_at) VALUES ('y', 'done', 'not json', 1)`)).toThrow(/CHECK/);
  });

  it("finds new tracks through their own index", () => {
    migrate(db, MIGRATIONS, () => 1);
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM tracks WHERE is_new = 1").all() as { detail: string }[];
    expect(plan.map((row) => row.detail).join("\n")).toContain("tracks_new");
  });
});
