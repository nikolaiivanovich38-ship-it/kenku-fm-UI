/**
 * Schema version 12 (0.6.0, f-live; round 9 §11, item 47: "Let's definitely build dip music for sound effects (pad
 * effects)"; Nik, 18 Nov 03:14, answer 12.2). docs/data-model.md "Version 12".
 *
 * - `pads.dip`: the pad's While it plays: 1 Dip the music, 0 Don't dip, NULL the usual for its play mode (a one-shot or
 *   Restart on press pad dips, a Toggle loop or Hold to play pad does not; the engine's padDips). Every pad of an
 *   upgraded library is on the usual, so nothing changes until Nik chooses.
 *
 * Frozen once released: later changes go in a new step.
 */
import type { Migration } from "./migrate";

export const v012PadDip: Migration = {
  version: 12,
  name: "a pad's While it plays (0.6.0)",
  up(db) {
    db.exec("ALTER TABLE pads ADD COLUMN dip INTEGER CHECK (dip IS NULL OR dip IN (0, 1))");
  },
};
