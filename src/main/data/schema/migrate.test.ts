import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConnection } from "../sqlite";
import { LibraryDatabaseError } from "../errors";
import { Store } from "../store";
import { makeTempFolder } from "../test/helpers";
import { migrate, rebuildTable, schemaVersion, type Migration } from "./migrate";
import { MIGRATIONS } from "./index";

let temp: ReturnType<typeof makeTempFolder>;
beforeEach(() => {
  temp = makeTempFolder();
});
afterEach(() => temp.cleanup());

function tableNames(db: ReturnType<typeof openConnection>) {
  return (
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as { name: string }[]
  ).map((row) => row.name);
}

/**
 * A later version as a test stands in for it: cue lists hang off sessions,
 * pad actions off pads, and a new column lands on tracks. Mirrors what WPD will add.
 */
const cueListsLater: Migration = {
  version: MIGRATIONS.length + 1,
  name: "cue lists and pads (test stand-in)",
  up(db) {
    db.exec(`
      CREATE TABLE standin_cue_sheets (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        scene_id TEXT REFERENCES scenes(id) ON DELETE CASCADE,
        name TEXT NOT NULL
      );
      CREATE TABLE cues (
        id TEXT PRIMARY KEY,
        standin_sheet_id TEXT NOT NULL REFERENCES standin_cue_sheets(id) ON DELETE CASCADE,
        number TEXT NOT NULL,
        steps TEXT NOT NULL DEFAULT '[]',
        position REAL NOT NULL
      );
      CREATE TABLE pad_actions (
        id TEXT PRIMARY KEY,
        pad_id TEXT NOT NULL REFERENCES pads(id) ON DELETE CASCADE,
        steps TEXT NOT NULL DEFAULT '[]'
      );
      ALTER TABLE tracks ADD COLUMN bpm REAL;
    `);
  },
};

describe("schema upgrades", () => {
  it("creates a new database at the latest version with every table", () => {
    const db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        "schema_migrations",
        "library_roots",
        "tracks",
        "track_follow_with",
        "markers",
        "folders",
        "playlists",
        "playlist_items",
        "boards",
        "pads",
        "pad_sounds",
        "tag_groups",
        "tags",
        "tag_synonyms",
        "track_tags",
        "campaigns",
        "sessions",
        "scenes",
        "campaign_playlists",
        "campaign_boards",
        "session_playlists",
        "session_boards",
        "scene_music",
        "scene_ambience",
        "scene_boards",
        "rule_conditions",
        "rule_condition_tags",
        "audio_profiles",
        "audio_profile_markers",
        "search_docs",
        "search_fts",
      ]),
    );
    // Cue lists and pad actions wait for their design (WPD).
    expect(tableNames(db)).not.toContain("standin_cue_sheets");
    expect(tableNames(db)).not.toContain("pad_actions");
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: MIGRATIONS.length });
    db.close();
  });

  it("records each upgrade with its number and name", () => {
    const db = openConnection(":memory:");
    migrate(db, MIGRATIONS, () => 1234);
    expect(db.prepare("SELECT version, name, applied_at FROM schema_migrations").all()).toEqual(
      MIGRATIONS.map((m) => ({ version: m.version, name: m.name, applied_at: 1234 })),
    );
    db.close();
  });

  it("offers the default tag groups and the Mood vocabulary (DAT-10, DAT-11)", () => {
    const db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    const groups = db.prepare("SELECT name FROM tag_groups ORDER BY position").all() as { name: string }[];
    expect(groups.map((g) => g.name)).toEqual(["Mood", "Leitmotif", "Scene type"]);
    const moods = db
      .prepare(
        "SELECT t.name FROM tags t JOIN tag_groups g ON g.id = t.group_id WHERE g.name = 'Mood' ORDER BY t.position",
      )
      .all() as { name: string }[];
    expect(moods.map((t) => t.name)).toEqual([
      "Melancholy",
      "Heroic",
      "Tense",
      "Wistful",
      "Warm",
      "Triumphant",
      "Eerie",
    ]);
    db.close();
  });

  it("does nothing when the database is already up to date", () => {
    const file = path.join(temp.folder, "library.sqlite");
    let db = openConnection(file);
    migrate(db, MIGRATIONS);
    db.prepare("INSERT INTO tag_groups (id, name, position) VALUES ('g1', 'Weather', 99)").run();
    db.close();
    db = openConnection(file);
    const latest = MIGRATIONS.length;
    expect(migrate(db, MIGRATIONS)).toEqual({ from: latest, to: latest, applied: [] });
    expect(db.prepare("SELECT count(*) AS n FROM tag_groups").get()).toEqual({ n: 4 });
    db.close();
  });

  it("upgrades an old database to a later version and keeps every row", () => {
    const file = path.join(temp.folder, "library.sqlite");
    let db = openConnection(file);
    migrate(db, MIGRATIONS);
    db.exec(`
      INSERT INTO tracks (id, title, path, file_name, created_at, updated_at)
        VALUES ('t1', 'Tavern bustle', 'C:\\Music\\tavern.mp3', 'tavern.mp3', 1, 1);
      INSERT INTO boards (id, title, background, position, created_at, updated_at)
        VALUES ('b1', 'Effects', 'tavern', 1, 1, 1);
      INSERT INTO campaigns (id, name, position, created_at, updated_at) VALUES ('c1', 'Curse of Strahd', 1, 1, 1);
      INSERT INTO sessions (id, campaign_id, name, position, created_at, updated_at)
        VALUES ('s1', 'c1', 'Session 1', 1, 1, 1);
    `);
    db.close();

    db = openConnection(file);
    const result = migrate(db, [...MIGRATIONS, cueListsLater]);
    const latest = MIGRATIONS.length;
    expect(result).toEqual({ from: latest, to: latest + 1, applied: [latest + 1] });
    expect(db.prepare("SELECT id, title, bpm FROM tracks").all()).toEqual([
      { id: "t1", title: "Tavern bustle", bpm: null },
    ]);
    expect(db.prepare("SELECT title, background FROM boards").get()).toEqual({ title: "Effects", background: "tavern" });
    // The new tables work with the old rows.
    db.exec("INSERT INTO standin_cue_sheets (id, session_id, name) VALUES ('q1', 's1', 'Main')");
    db.exec("INSERT INTO pads (id, board_id, label, grid_row, grid_col) VALUES ('p1', 'b1', 'Door', 0, 0)");
    db.exec("INSERT INTO pad_actions (id, pad_id) VALUES ('a1', 'p1')");
    // Search still follows the old rows after the upgrade (edits go through a Store, which keeps the index).
    new Store(db).change("Rename", () => db.exec("UPDATE tracks SET title = 'Quiet tavern' WHERE id = 't1'"));
    expect(db.prepare("SELECT title FROM search_fts WHERE search_fts MATCH 'quiet'").all()).toEqual([
      { title: "Quiet tavern" },
    ]);
    db.close();
  });

  it("rolls an upgrade back completely when one step fails, and says which", () => {
    const db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    db.exec("INSERT INTO tag_groups (id, name, position) VALUES ('g1', 'Weather', 99)");
    const broken: Migration = {
      version: MIGRATIONS.length + 1,
      name: "half-finished change",
      up(conn) {
        conn.exec("CREATE TABLE half_done (id TEXT PRIMARY KEY)");
        conn.exec("DELETE FROM tag_groups");
        throw new Error("disk full");
      },
    };
    expect(() => migrate(db, [...MIGRATIONS, broken])).toThrow(LibraryDatabaseError);
    try {
      migrate(db, [...MIGRATIONS, broken]);
    } catch (error) {
      expect((error as LibraryDatabaseError).code).toBe("upgrade-failed");
      expect((error as Error).message).toContain("half-finished change");
    }
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(tableNames(db)).not.toContain("half_done");
    expect(db.prepare("SELECT count(*) AS n FROM tag_groups").get()).toEqual({ n: 4 });
    db.close();
  });

  it("names the real error when SQLite has already rolled a failed step back (review 5)", () => {
    const db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    const broken: Migration = {
      version: MIGRATIONS.length + 1,
      name: "ran out of space",
      up(conn) {
        conn.exec("CREATE TABLE half_done (id TEXT PRIMARY KEY)");
        // What SQLite does by itself on a full disk or an I/O error.
        conn.exec("ROLLBACK");
        throw new Error("database or disk is full");
      },
    };
    expect(() => migrate(db, [...MIGRATIONS, broken])).toThrow(
      expect.objectContaining({ code: "upgrade-failed", message: expect.stringContaining("database or disk is full") }),
    );
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(tableNames(db)).not.toContain("half_done");
    expect((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1);
    db.close();
  });

  it("can rebuild a table (foreign keys paused) and refuses an upgrade that breaks a link", () => {
    const db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    db.exec(`
      INSERT INTO tracks (id, title, path, file_name, created_at, updated_at) VALUES ('t1', 'A', '/a.mp3', 'a.mp3', 1, 1);
      INSERT INTO markers (id, track_id, time_ms, kind, label, created_at) VALUES ('m1', 't1', 92000, 'marker', 'swell', 1);
    `);
    // The table rebuild from the SQLite manual: needs foreign keys off.
    const rebuildMarkers: Migration = {
      version: MIGRATIONS.length + 1,
      name: "rebuild markers",
      up(conn) {
        rebuildTable(
          conn,
          "markers",
          `id TEXT PRIMARY KEY,
           track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
           time_ms INTEGER NOT NULL CHECK (time_ms >= 0),
           kind TEXT NOT NULL,
           label TEXT NOT NULL DEFAULT '',
           colour TEXT,
           created_at INTEGER NOT NULL`,
          ["id", "track_id", "time_ms", "kind", "label", "created_at"],
        );
      },
    };
    migrate(db, [...MIGRATIONS, rebuildMarkers]);
    expect(db.prepare("SELECT id, label, colour FROM markers").all()).toEqual([
      { id: "m1", label: "swell", colour: null },
    ]);
    // The index came back with the rebuilt table, and a Store opened afterwards keeps search following it.
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'markers_track'").get()).toEqual({
      name: "markers_track",
    });
    new Store(db).change("Rename marker", () => db.exec("UPDATE markers SET label = 'crescendo' WHERE id = 'm1'"));
    expect(db.prepare("SELECT markers FROM search_fts WHERE search_fts MATCH 'crescendo'").all()).toEqual([
      { markers: "crescendo" },
    ]);

    const breaksLinks: Migration = {
      version: MIGRATIONS.length + 2,
      name: "leaves a marker without its track",
      up(conn) {
        conn.exec("INSERT INTO markers (id, track_id, time_ms, kind, created_at) VALUES ('m2', 'gone', 1, 'marker', 1)");
      },
    };
    expect(() => migrate(db, [...MIGRATIONS, rebuildMarkers, breaksLinks])).toThrow(/leaves a marker/);
    expect(schemaVersion(db)).toBe(MIGRATIONS.length + 1);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.close();
  });

  it("refuses to open a library saved by a newer version of Lyre", () => {
    const db = openConnection(":memory:");
    migrate(db, [...MIGRATIONS, cueListsLater]);
    expect(() => migrate(db, MIGRATIONS)).toThrow(LibraryDatabaseError);
    try {
      migrate(db, MIGRATIONS);
    } catch (error) {
      expect((error as LibraryDatabaseError).code).toBe("newer-version");
      expect((error as Error).message).toMatch(/newer version of Lyre/);
    }
    db.close();
  });

  it("checks the list of upgrades is numbered 1, 2, 3 … with no gaps", () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    const gap: Migration = { version: MIGRATIONS.length + 2, name: "gap", up: () => undefined };
    const db = openConnection(":memory:");
    expect(() => migrate(db, [...MIGRATIONS, gap])).toThrow(/numbered/);
    db.close();
  });
});

describe("connection settings", () => {
  it("turns on foreign keys and write-ahead logging for files", () => {
    const db = openConnection(path.join(temp.folder, "x.sqlite"));
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    db.close();
  });
});
