/**
 * Schema version 11 (0.6.0, round 9 §10: "Split tracks into multiple at split points in audio profile using markers";
 * Nik, 18 Nov, Q11 a: a part plays its part of the same file). docs/data-model.md "Version 11".
 *
 * - `tracks.part_of`: the id of the whole track a part was split from (no foreign key: removing the whole leaves its
 *   parts playing; the details then stop naming it). `part_start_ms`, `part_end_ms`: where in the file the part was
 *   cut, for "Part of … (2:30–6:01)" and the whole track's list of parts. A part's own audio profile starts and ends
 *   it there; the file is never changed.
 * - A part shares its whole's file, so the indexes that keep one track per file now let parts through: each unique
 *   index takes, after the file, '' for a whole track and the part's own id for a part. A look-up by file still uses
 *   the same index (its leading columns) and asks for the whole track (`part_of IS NULL`).
 *
 * Frozen once released: later changes go in a new step.
 */
import type { Migration } from "./migrate";

export const v011TrackParts: Migration = {
  version: 11,
  name: "track parts (0.6.0)",
  up(db) {
    db.exec(`
      ALTER TABLE tracks ADD COLUMN part_of TEXT CHECK (part_of IS NULL OR length(part_of) > 0);
      ALTER TABLE tracks ADD COLUMN part_start_ms INTEGER CHECK (part_start_ms IS NULL OR part_start_ms >= 0);
      ALTER TABLE tracks ADD COLUMN part_end_ms INTEGER CHECK (part_end_ms IS NULL OR part_end_ms >= 0);
      DROP INDEX tracks_root_path;
      DROP INDEX tracks_absolute_path;
      DROP INDEX tracks_url;
      CREATE UNIQUE INDEX tracks_root_path ON tracks (root_id, path COLLATE NOCASE, iif(part_of IS NULL, '', id)) WHERE root_id IS NOT NULL;
      CREATE UNIQUE INDEX tracks_absolute_path ON tracks (path COLLATE NOCASE, iif(part_of IS NULL, '', id)) WHERE root_id IS NULL AND path IS NOT NULL;
      CREATE UNIQUE INDEX tracks_url ON tracks (url, iif(part_of IS NULL, '', id)) WHERE url IS NOT NULL;
      CREATE INDEX tracks_part_of ON tracks (part_of) WHERE part_of IS NOT NULL;
    `);
  },
};
