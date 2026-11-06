/**
 * Schema version 5 (design round 6: PLY-17 Repeat one per scene and track, ORG-13 a playlist's track order per place):
 * every new CHECK and key, what goes with a scene, a track or a playlist, and the upgrade from version 4 with data in it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConnection, type DatabaseSync } from "../sqlite";
import { migrate, schemaVersion } from "./migrate";
import { MIGRATIONS } from "./index";

const all = (db: DatabaseSync, sql: string) => db.prepare(sql).all();

const BASE = `
  INSERT INTO tracks (id, title, path, file_name, created_at, updated_at) VALUES ('t', 'Bells', '/t.flac', 't.flac', 1, 1), ('u', 'Rain', '/u.flac', 'u.flac', 1, 1), ('w', 'Wind', '/w.flac', 'w.flac', 1, 1);
  INSERT INTO playlists (id, title, position, created_at, updated_at) VALUES ('p', 'Abbey', 1, 1, 1), ('q', 'Crypt', 2, 1, 1);
  INSERT INTO campaigns (id, name, position, created_at, updated_at) VALUES ('c', 'Crown', 1, 1, 1);
  INSERT INTO sessions (id, campaign_id, position, created_at, updated_at) VALUES ('s', 'c', 1, 1, 1);
  INSERT INTO scenes (id, session_id, name, position, created_at, updated_at) VALUES ('x', 's', 'Ruins', 1, 1, 1), ('y', 's', 'Crypt', 2, 1, 1);
`;

describe("schema version 5 (design round 6)", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    db.exec(BASE);
  });
  afterEach(() => db.close());

  it("is the newest version and leaves no broken link", () => {
    expect(schemaVersion(db)).toBe(5);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("PLY-17: Repeat one is a row per scene and track while it is on, gone with the scene or the track", () => {
    db.exec("INSERT INTO repeat_ones (scene_id, track_id) VALUES ('x', 't'), ('x', 'u'), ('y', 't')");
    expect(() => db.exec("INSERT INTO repeat_ones (scene_id, track_id) VALUES ('x', 't')")).toThrow(/UNIQUE|PRIMARY/);
    expect(() => db.exec("INSERT INTO repeat_ones (scene_id, track_id) VALUES ('nope', 't')")).toThrow(/FOREIGN KEY/);
    expect(() => db.exec("INSERT INTO repeat_ones (scene_id, track_id) VALUES ('x', 'nope')")).toThrow(/FOREIGN KEY/);
    db.exec("DELETE FROM scenes WHERE id = 'y'");
    expect(all(db, "SELECT scene_id, track_id FROM repeat_ones ORDER BY track_id")).toEqual([
      { scene_id: "x", track_id: "t" },
      { scene_id: "x", track_id: "u" },
    ]);
    db.exec("DELETE FROM tracks WHERE id = 't'");
    expect(all(db, "SELECT scene_id, track_id FROM repeat_ones")).toEqual([{ scene_id: "x", track_id: "u" }]);
  });

  it("ORG-13: one track order per playlist and place, exactly one place, its tracks once each with unique positions", () => {
    db.exec(`INSERT INTO track_orders (id, playlist_id, scene_id) VALUES ('o1', 'p', 'x');
      INSERT INTO track_orders (id, playlist_id, session_id) VALUES ('o2', 'p', 's');
      INSERT INTO track_orders (id, playlist_id, campaign_id) VALUES ('o3', 'p', 'c');
      INSERT INTO track_orders (id, playlist_id, scene_id) VALUES ('o4', 'q', 'x');`);
    expect(() => db.exec("INSERT INTO track_orders (id, playlist_id, scene_id) VALUES ('o5', 'p', 'x')")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO track_orders (id, playlist_id, session_id) VALUES ('o5', 'p', 's')")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO track_orders (id, playlist_id, campaign_id) VALUES ('o5', 'p', 'c')")).toThrow(/UNIQUE/);
    // The playlist's own order is its own list (playlist_items); a place order always names its one place.
    expect(() => db.exec("INSERT INTO track_orders (id, playlist_id) VALUES ('o5', 'p')")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO track_orders (id, playlist_id, scene_id, session_id) VALUES ('o5', 'q', 'y', 's')")).toThrow(/CHECK/);
    db.exec("INSERT INTO track_order_items (order_id, track_id, position) VALUES ('o1', 'u', 0), ('o1', 't', 1), ('o1', 'w', 2)");
    expect(() => db.exec("INSERT INTO track_order_items (order_id, track_id, position) VALUES ('o1', 't', 3)")).toThrow(/UNIQUE|PRIMARY/);
    expect(() => db.exec("INSERT INTO track_order_items (order_id, track_id, position) VALUES ('o2', 't', 0), ('o2', 'u', 0)")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO track_order_items (order_id, track_id, position) VALUES ('o2', 'nope', 0)")).toThrow(/FOREIGN KEY/);
    expect(all(db, "SELECT track_id FROM track_order_items WHERE order_id = 'o1' ORDER BY position")).toEqual([{ track_id: "u" }, { track_id: "t" }, { track_id: "w" }]);
  });

  it("ORG-13: a deleted track drops out of every order; an order goes with its place or its playlist", () => {
    db.exec(`INSERT INTO track_orders (id, playlist_id, scene_id) VALUES ('o1', 'p', 'x');
      INSERT INTO track_orders (id, playlist_id, session_id) VALUES ('o2', 'p', 's');
      INSERT INTO track_orders (id, playlist_id, scene_id) VALUES ('o3', 'q', 'y');
      INSERT INTO track_order_items (order_id, track_id, position) VALUES ('o1', 'u', 0), ('o1', 't', 1), ('o2', 't', 0), ('o3', 'w', 0);`);
    db.exec("DELETE FROM tracks WHERE id = 't'");
    expect(all(db, "SELECT order_id, track_id FROM track_order_items ORDER BY order_id")).toEqual([
      { order_id: "o1", track_id: "u" },
      { order_id: "o3", track_id: "w" },
    ]);
    db.exec("DELETE FROM scenes WHERE id = 'y'");
    expect(all(db, "SELECT id FROM track_orders ORDER BY id")).toEqual([{ id: "o1" }, { id: "o2" }]);
    db.exec("DELETE FROM playlists WHERE id = 'p'");
    expect(all(db, "SELECT id FROM track_orders")).toEqual([]);
    expect(all(db, "SELECT order_id FROM track_order_items")).toEqual([]);
  });
});

describe("upgrading a version 4 library to version 5", () => {
  it("keeps every scene, playlist, play order and setting; no track order or Repeat one is set yet", () => {
    const db = openConnection(":memory:");
    migrate(db, MIGRATIONS.slice(0, 4));
    db.exec(BASE);
    db.exec(`INSERT INTO play_orders (id, playlist_id, scene_id, shuffle, repeat) VALUES ('o', 'p', 'x', 1, 'one');
      INSERT INTO playlist_items (id, playlist_id, kind, track_id, position) VALUES ('i1', 'p', 'track', 't', 1), ('i2', 'p', 'track', 'u', 2);
      UPDATE library_settings SET normalise_on = 1;`);
    expect(migrate(db, MIGRATIONS)).toMatchObject({ from: 4, to: 5, applied: [5] });
    expect(all(db, "SELECT id, name FROM scenes ORDER BY id")).toEqual([
      { id: "x", name: "Ruins" },
      { id: "y", name: "Crypt" },
    ]);
    expect(all(db, "SELECT track_id FROM playlist_items ORDER BY position")).toEqual([{ track_id: "t" }, { track_id: "u" }]);
    expect(all(db, "SELECT playlist_id, scene_id, shuffle, repeat FROM play_orders")).toEqual([{ playlist_id: "p", scene_id: "x", shuffle: 1, repeat: "one" }]);
    expect(all(db, "SELECT normalise_on FROM library_settings")).toEqual([{ normalise_on: 1 }]);
    expect(all(db, "SELECT * FROM repeat_ones")).toEqual([]);
    expect(all(db, "SELECT * FROM track_orders")).toEqual([]);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
    db.close();
  });
});
