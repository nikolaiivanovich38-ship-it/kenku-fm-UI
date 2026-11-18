/**
 * Schema version 8 (0.5.2, Nik's play test of 14 Nov). docs/data-model.md "Version 8".
 *
 * - Item 10 ("Anything with a manually assigned tag should no longer be 'new'"): a track settles (loses its New mark)
 *   as soon as it has a tag; a title of its own is no longer needed too. Tags come on a track only by the game
 *   master's hand (typing one, Tag…, accepting a suggestion); an import never tags. The upgrade settles the tagged
 *   tracks version 7 kept New. Version 1's "title and tag" trigger goes: the tag trigger is the whole rule now.
 * - Item 40 ("choose what kind of tracks will be in watched folders"): `library_roots.new_kind`, the kind a new file
 *   in that folder gets: NULL guesses from its folder names, as before (import/kindGuess.ts); music, amb or fx always.
 *
 * Frozen once released: later changes go in a new step.
 */
import type { Migration } from "./migrate";

export const v008NewAndFolderKind: Migration = {
  version: 8,
  name: "New until tagged, a folder's kind of new tracks",
  up(db) {
    db.exec(`
      DROP TRIGGER IF EXISTS tracks_settle_on_title;
      DROP TRIGGER IF EXISTS tracks_settle_on_tag;
      CREATE TRIGGER tracks_settle_on_tag AFTER INSERT ON track_tags
        WHEN EXISTS (SELECT 1 FROM tracks WHERE id = NEW.track_id AND is_new = 1)
        BEGIN UPDATE tracks SET is_new = 0 WHERE id = NEW.track_id; END;
      UPDATE tracks SET is_new = 0 WHERE is_new = 1 AND EXISTS (SELECT 1 FROM track_tags WHERE track_id = tracks.id);
      ALTER TABLE library_roots ADD COLUMN new_kind TEXT CHECK (new_kind IS NULL OR new_kind IN ('music', 'amb', 'fx'));
    `);
  },
};
