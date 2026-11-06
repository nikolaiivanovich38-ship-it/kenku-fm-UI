/**
 * DAT-11: the library schema, the agreed design (Lyre design round 4), made by
 * one step (DB review item 8: nothing was released, so versions 1 to 3 were
 * folded into it). Every CHECK, unique key, composite key and integrity trigger.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConnection, type DatabaseSync } from "../sqlite";
import { migrate, schemaVersion } from "./migrate";
import { MIGRATIONS } from "./index";

const all = (db: DatabaseSync, sql: string) => db.prepare(sql).all();
const tableNames = (db: DatabaseSync) =>
  (all(db, "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name") as { name: string }[]).map((r) => r.name);

describe("the library schema (DAT-11)", () => {
  it("makes a new library in one upgrade, with the Mood, Leitmotif and Scene type tag groups", () => {
    const db = openConnection(":memory:");
    // Step 1 is the whole library; step 2 (w3-media) adds loudness peaks per track; step 3 design round 5; step 4 normalisation.
    expect(migrate(db, MIGRATIONS)).toEqual({ from: 0, to: 5, applied: [1, 2, 3, 4, 5] });
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect((all(db, "SELECT name FROM tag_groups ORDER BY position") as { name: string }[]).map((g) => g.name)).toEqual([
      "Mood",
      "Leitmotif",
      "Scene type",
    ]);
    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        "pads",
        "pad_sounds",
        "session_playlists",
        "session_boards",
        "scene_music",
        "scene_ambience",
        "scene_boards",
        "rule_conditions",
        "rule_condition_tags",
        "audio_profiles",
        "audio_profile_markers",
        "track_peaks",
      ]),
    );
    expect(tableNames(db)).not.toContain("board_items");
    expect(tableNames(db)).not.toContain("scene_items");
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
    db.close();
  });

  it("allows at most one next session per campaign", () => {
    const db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    db.exec(`
      INSERT INTO campaigns (id, name, position, created_at, updated_at) VALUES ('c1', 'A', 1, 1, 1), ('c2', 'B', 2, 1, 1);
      INSERT INTO sessions (id, campaign_id, status, position, created_at, updated_at)
        VALUES ('s1', 'c1', 'next', 1, 1, 1), ('s2', 'c2', 'next', 1, 1, 1), ('s3', 'c1', 'draft', 2, 1, 1);
    `);
    expect(() => db.exec("UPDATE sessions SET status = 'next' WHERE id = 's3'")).toThrow(/UNIQUE/);
    db.close();
  });

  it("keeps grid sizes from 1 to 8 and one pad per grid cell", () => {
    const db = openConnection(":memory:");
    migrate(db, MIGRATIONS);
    db.exec("INSERT INTO boards (id, title, position, created_at, updated_at, grid_cols, grid_rows) VALUES ('b', 'B', 1, 1, 1, 8, 8)");
    expect(() => db.exec("UPDATE boards SET grid_cols = 9")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE boards SET grid_rows = 0")).toThrow(/CHECK/);
    db.exec("INSERT INTO pads (id, board_id, grid_row, grid_col) VALUES ('p1', 'b', 0, 0)");
    expect(() => db.exec("INSERT INTO pads (id, board_id, grid_row, grid_col) VALUES ('p2', 'b', 0, 0)")).toThrow(/UNIQUE/);
    // Spare pads have no cell and any number can wait.
    db.exec("INSERT INTO pads (id, board_id, spare_position) VALUES ('p3', 'b', 1), ('p4', 'b', 2)");
    expect(() => db.exec("INSERT INTO pads (id, board_id) VALUES ('p5', 'b')")).toThrow(/CHECK/);
    db.close();
  });

  describe("integrity in the schema", () => {
    let db: DatabaseSync;
    beforeEach(() => {
      db = openConnection(":memory:");
      migrate(db, MIGRATIONS);
      db.exec(`
        INSERT INTO tracks (id, title, path, file_name, created_at, updated_at) VALUES ('t', 'T', '/t.flac', 't.flac', 1, 1);
        INSERT INTO playlists (id, title, position, created_at, updated_at, kind) VALUES ('m', 'Manual', 1, 1, 1, 'manual');
        INSERT INTO playlists (id, title, position, created_at, updated_at, kind) VALUES ('d', 'Dynamic', 2, 1, 1, 'dynamic');
        INSERT INTO campaigns (id, name, position, created_at, updated_at) VALUES ('c', 'C', 1, 1, 1);
        INSERT INTO sessions (id, campaign_id, position, created_at, updated_at) VALUES ('s', 'c', 1, 1, 1);
        INSERT INTO scenes (id, session_id, position, created_at, updated_at) VALUES ('sc', 's', 1, 1, 1);
      `);
    });
    afterEach(() => db.close());
    const fails = (sql: string, error: RegExp) => expect(() => db.exec(sql), sql).toThrow(error);

    it("checks every list of choices and every range", () => {
      for (const [sql, error] of [
        ["UPDATE tracks SET kind = 'voice'", /CHECK/],
        ["UPDATE tracks SET role = 'Sting'", /CHECK/],
        ["UPDATE tracks SET loopable = 'with_crossfade'", /CHECK/],
        ["UPDATE tracks SET energy = 6", /CHECK/],
        ["UPDATE playlists SET lane = 'voice' WHERE id = 'm'", /CHECK/],
        ["UPDATE playlists SET rule_energy_min = 4, rule_energy_max = 2 WHERE id = 'd'", /CHECK/],
        ["UPDATE playlists SET rule_energy_min = 1, rule_energy_max = 2 WHERE id = 'm'", /CHECK/],
        ["UPDATE campaigns SET theme = 'neon'", /CHECK/],
        ["UPDATE campaigns SET color = 'red'", /CHECK/],
        ["UPDATE sessions SET status = 'done'", /CHECK/],
        ["UPDATE sessions SET session_date = '7/11/2026'", /CHECK/],
        ["INSERT INTO markers (id, track_id, time_ms, kind, created_at) VALUES ('x', 't', 1, 'drop', 1)", /CHECK/],
        ["INSERT INTO markers (id, track_id, time_ms, kind, created_at) VALUES ('x', 't', 1, 'loop_in', 1)", /CHECK/],
        ["INSERT INTO markers (id, track_id, time_ms, kind, created_at) VALUES ('x', 't', 1, 'loop_out', 1)", /CHECK/],
        ["UPDATE tracks SET transition_in = '{}'", /no such column/],
        ["INSERT INTO folders (id, scope, name, position) VALUES ('x', 'tracks', 'F', 1)", /CHECK/],
        ["INSERT INTO rule_conditions (id, playlist_id, group_id, match, position) VALUES ('x', 'd', (SELECT id FROM tag_groups LIMIT 1), 'some', 1)", /CHECK/],
        ["INSERT INTO audio_profiles (id, track_id, after_end) VALUES ('x', 't', 'rewind')", /CHECK/],
        ["INSERT INTO audio_profiles (id, track_id, start_ms, end_ms) VALUES ('x', 't', 5000, 5000)", /CHECK/],
        ["INSERT INTO audio_profiles (id, track_id, fade_in_ms, fade_in_shape) VALUES ('x', 't', 100, 101)", /CHECK/],
        ["INSERT INTO audio_profiles (id, track_id, fade_in_ms) VALUES ('x', 't', 100)", /CHECK/],
        ["INSERT INTO audio_profiles (id, track_id, playlist_id, scene_id) VALUES ('x', 't', 'm', 'sc')", /CHECK/],
        ["INSERT INTO scene_music (id, scene_id, track_id, playlist_id, position) VALUES ('x', 'sc', 't', 'm', 1)", /CHECK/],
        ["INSERT INTO scene_music (id, scene_id, position) VALUES ('x', 'sc', 1)", /CHECK/],
      ] as const) {
        fails(sql, error);
      }
    });

    it("keeps each file and each web address to one track (DB review 4)", () => {
      db.exec("INSERT INTO library_roots (id, name, path, created_at) VALUES ('r', 'R', '/music', 1), ('r2', 'R2', '/other', 1)");
      db.exec(`INSERT INTO tracks (id, root_id, path, created_at, updated_at) VALUES ('u1', 'r', 'Witcher/a.flac', 1, 1)`);
      fails(`INSERT INTO tracks (id, root_id, path, created_at, updated_at) VALUES ('u2', 'r', 'witcher/A.FLAC', 1, 1)`, /UNIQUE/);
      db.exec(`INSERT INTO tracks (id, root_id, path, created_at, updated_at) VALUES ('u3', 'r2', 'Witcher/a.flac', 1, 1)`);
      fails(`INSERT INTO tracks (id, path, created_at, updated_at) VALUES ('u4', '/T.FLAC', 1, 1)`, /UNIQUE/);
      db.exec(`INSERT INTO tracks (id, url, created_at, updated_at) VALUES ('u5', 'https://x.org/a.mp3', 1, 1)`);
      fails(`INSERT INTO tracks (id, url, created_at, updated_at) VALUES ('u6', 'https://x.org/a.mp3', 1, 1)`, /UNIQUE/);
    });

    it("stores cue actions (PLY-8) with the facts their type needs and nothing else, and follows deletes (DB review 9)", () => {
      db.exec(`
        INSERT INTO boards (id, title, position, created_at, updated_at) VALUES ('b', 'B', 1, 1, 1);
        INSERT INTO pads (id, board_id, grid_row, grid_col) VALUES ('pad', 'b', 0, 0);
      `);
      const add = (columns: string, values: string) =>
        db.exec(`INSERT INTO cue_actions (id, hotkey, position, ${columns}) VALUES (lower(hex(randomblob(8))), 'f1', (SELECT coalesce(max(position), 0) + 1 FROM cue_actions), ${values})`);
      for (const [columns, values] of [
        ["type, track_id, room, play_when, fade_ms", "'playTrack', 't', 'all', 'next', 3000"],
        ["type, track_id, room, from_playlist_id", "'playTrack', 't', '123456789', 'm'"],
        ["type, track_id, room, from_scene_id, from_step", "'playTrack', 't', 'all', 'sc', 2"],
        ["type, playlist_id, room", "'playPlaylist', 'm', 'all'"],
        ["type, scene_id", "'startScene', 'sc'"],
        ["type, lane, room, fade_ms", "'next', 'music', 'all', 3000"],
        ["type, lane, room", "'previous', 'ambience', 'all'"],
        ["type, lane, room", "'fadeLane', 'effects', 'all'"],
        ["type, fade_ms", "'fadeAll', 3000"],
        ["type, room", "'stopAll', 'all'"],
        ["type, pad_id, room, phase", "'firePad', 'pad', 'all', 'up'"],
        ["type", "'undoSceneStart'"],
      ]) {
        add(columns, values);
      }
      for (const [columns, values] of [
        ["type", "'teleport'"],
        ["type, room", "'removeQueued', 'all'"],
        ["type, room", "'playTrack', 'all'"],
        ["type, track_id", "'playTrack', 't'"],
        ["type, track_id, playlist_id, room", "'playTrack', 't', 'm', 'all'"],
        ["type, scene_id, room", "'startScene', 'sc', 'all'"],
        ["type, lane, room", "'next', 'effects', 'all'"],
        ["type, lane, room", "'fadeLane', 'voices', 'all'"],
        ["type, room, fade_ms", "'stopAll', 'all', 100"],
        ["type, pad_id, room, phase", "'firePad', 'pad', 'all', 'sideways'"],
        ["type, playlist_id, room, phase", "'playPlaylist', 'm', 'all', 'up'"],
        ["type, lane, room, fade_ms", "'next', 'music', 'all', 60001"],
        ["type, playlist_id, room, from_playlist_id", "'playPlaylist', 'm', 'all', 'm'"],
      ]) {
        expect(() => add(columns, values), `${columns} = ${values}`).toThrow(/CHECK/);
      }
      fails("INSERT INTO cue_actions (id, hotkey, position, type) VALUES ('u', 'F1', 99, 'undoSceneStart')", /CHECK/);
      fails("INSERT INTO cue_actions (id, hotkey, position, type) VALUES ('u', 'f1', 1, 'undoSceneStart')", /UNIQUE/);
      // An action whose sound is deleted goes with it; a "picked from" place that goes is forgotten.
      db.exec("DELETE FROM playlists WHERE id = 'm'");
      expect(all(db, "SELECT count(*) AS n FROM cue_actions WHERE type = 'playPlaylist'")).toEqual([{ n: 0 }]);
      expect(all(db, "SELECT count(*) AS n FROM cue_actions WHERE type = 'playTrack'")).toEqual([{ n: 3 }]);
      db.exec("DELETE FROM pads WHERE id = 'pad'");
      db.exec("DELETE FROM tracks WHERE id = 't'");
      expect(all(db, "SELECT type FROM cue_actions ORDER BY position")).toEqual(
        ["startScene", "next", "previous", "fadeLane", "fadeAll", "stopAll", "undoSceneStart"].map((type) => ({ type })),
      );
      expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
    });

    it("stores link and list tables without a separate row id, and has no position default (review nice-to-haves)", () => {
      const withoutRowid = (all(db, "SELECT name FROM pragma_table_list WHERE wr = 1 AND schema = 'main' ORDER BY name") as { name: string }[]).map((r) => r.name);
      expect(withoutRowid).toEqual(
        expect.arrayContaining([
          "audio_profile_markers", "campaign_boards", "campaign_playlists", "pad_sounds", "rule_condition_tags", "scene_boards",
          "session_boards", "session_playlists", "tag_synonyms", "track_follow_with", "track_tags",
        ]),
      );
      const indexes = (all(db, "SELECT name FROM sqlite_schema WHERE type = 'index'") as { name: string }[]).map((r) => r.name);
      expect(indexes).not.toContain("pads_board");
      expect(indexes).toContain("pads_cell");
      fails("INSERT INTO campaign_playlists (campaign_id, playlist_id) VALUES ('c', 'm')", /NOT NULL/);
      db.exec("INSERT INTO campaign_playlists (campaign_id, playlist_id, position) VALUES ('c', 'm', 1)");
    });

    it("keeps an entry or a condition from moving to a playlist of the other kind", () => {
      const group = (all(db, "SELECT id FROM tag_groups LIMIT 1") as { id: string }[])[0].id;
      db.exec(`
        INSERT INTO playlist_items (id, playlist_id, kind, track_id, position) VALUES ('i', 'm', 'track', 't', 1);
        INSERT INTO rule_conditions (id, playlist_id, group_id, match, position) VALUES ('c1', 'd', '${group}', 'any', 1);
      `);
      fails("UPDATE playlist_items SET playlist_id = 'd' WHERE id = 'i'", /dynamic playlist/);
      fails("UPDATE rule_conditions SET playlist_id = 'm' WHERE id = 'c1'", /manual playlist has no rule/);
    });

    it("marks a library folder watched or not (DB review 9)", () => {
      db.exec("INSERT INTO library_roots (id, name, path, created_at) VALUES ('r', 'R', '/music', 1)");
      expect(all(db, "SELECT watched FROM library_roots")).toEqual([{ watched: 0 }]);
      fails("UPDATE library_roots SET watched = 2", /CHECK/);
    });

    it("keeps one profile per track per place, and one per track of its own", () => {
      db.exec("INSERT INTO audio_profiles (id, track_id, end_ms) VALUES ('own', 't', 1000)");
      fails("INSERT INTO audio_profiles (id, track_id) VALUES ('own2', 't')", /UNIQUE/);
      db.exec("INSERT INTO audio_profiles (id, track_id, playlist_id) VALUES ('p1', 't', 'm')");
      fails("INSERT INTO audio_profiles (id, track_id, playlist_id) VALUES ('p2', 't', 'm')", /UNIQUE/);
      db.exec("INSERT INTO audio_profiles (id, track_id, scene_id) VALUES ('s1', 't', 'sc')");
      fails("INSERT INTO audio_profiles (id, track_id, scene_id) VALUES ('s2', 't', 'sc')", /UNIQUE/);
    });

    it("keeps positions unique within each ordered list", () => {
      db.exec("INSERT INTO scene_music (id, scene_id, track_id, position) VALUES ('a', 'sc', 't', 1024)");
      fails("INSERT INTO scene_music (id, scene_id, track_id, position) VALUES ('b', 'sc', 't', 1024)", /UNIQUE/);
      fails("INSERT INTO playlists (id, title, position, created_at, updated_at) VALUES ('x', 'X', 1, 1, 1)", /UNIQUE/);
      fails("INSERT INTO sessions (id, campaign_id, position, created_at, updated_at) VALUES ('s2', 'c', 1, 1, 1)", /UNIQUE/);
    });

    it("lets a rule name only tags of its condition's group, and follows tag renames and deletes by key", () => {
      const [mood, motif] = all(db, "SELECT id FROM tag_groups ORDER BY position") as { id: string }[];
      db.exec(`
        INSERT INTO tags (id, group_id, name, position) VALUES ('villain', '${motif.id}', 'Villain', 1);
        INSERT INTO rule_conditions (id, playlist_id, group_id, match, position) VALUES ('c1', 'd', '${mood.id}', 'any', 1);
      `);
      const eerie = (all(db, `SELECT id FROM tags WHERE name = 'Eerie'`) as { id: string }[])[0].id;
      db.exec(`INSERT INTO rule_condition_tags (condition_id, group_id, tag_id, position) VALUES ('c1', '${mood.id}', '${eerie}', 1)`);
      fails(`INSERT INTO rule_condition_tags (condition_id, group_id, tag_id, position) VALUES ('c1', '${motif.id}', 'villain', 2)`, /FOREIGN KEY/);
      fails(`INSERT INTO rule_condition_tags (condition_id, group_id, tag_id, position) VALUES ('c1', '${mood.id}', 'villain', 2)`, /FOREIGN KEY/);
      db.exec(`UPDATE tags SET name = 'Spooky' WHERE id = '${eerie}'`);
      expect(all(db, "SELECT t.name FROM rule_condition_tags v JOIN tags t ON t.id = v.tag_id")).toEqual([{ name: "Spooky" }]);
      db.exec(`DELETE FROM tags WHERE id = '${eerie}'`);
      expect(all(db, "SELECT count(*) AS n FROM rule_condition_tags")).toEqual([{ n: 0 }]);
      db.exec(`DELETE FROM tag_groups WHERE id = '${mood.id}'`);
      expect(all(db, "SELECT count(*) AS n FROM rule_conditions")).toEqual([{ n: 0 }]);
    });

    it("gives a manual playlist no rule and a dynamic one no entries, and a playlist keeps its kind", () => {
      const group = (all(db, "SELECT id FROM tag_groups LIMIT 1") as { id: string }[])[0].id;
      fails(`INSERT INTO rule_conditions (id, playlist_id, group_id, match, position) VALUES ('x', 'm', '${group}', 'any', 1)`, /manual playlist has no rule/);
      fails("INSERT INTO playlist_items (id, playlist_id, kind, track_id, position) VALUES ('x', 'd', 'track', 't', 1)", /dynamic playlist/);
      fails("UPDATE playlists SET kind = 'dynamic' WHERE id = 'm'", /keeps its kind/);
    });
  });
});

describe("new tracks and library jobs (import stream: EDT-6, DAT-9)", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openConnection(":memory:");
  });
  afterEach(() => db.close());
  const run = (sql: string) => db.exec(sql);
  const get = (sql: string) => db.prepare(sql).get();

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
