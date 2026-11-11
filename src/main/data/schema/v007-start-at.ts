/**
 * Schema version 7 (0.5.1, Nik 11 Nov: "We need a 'Start at [select marker]' option in the detailed audio profile
 * view, to set the default option to have a track start at a given marker"). docs/data-model.md "Version 7".
 *
 * - `audio_profiles.start_at_ms`: where the track starts by default wherever it plays with this profile (a scene, Live,
 *   Play on air): the time of one of the profile's markers. NULL: the Beginning (the profile's Start). A place's own
 *   profile has its own, as for every other setting. The marker it names is not a key: a time with no marker, or
 *   outside Start to End, is read as the Beginning (resolveProfile).
 *
 * The campaigns' order on the Campaigns screen (0.5.1) needs no change: `campaigns.position` is version 1's.
 *
 * Frozen once released: later changes go in a new step.
 */
import type { Migration } from "./migrate";

export const v007StartAt: Migration = {
  version: 7,
  name: "Start at in the audio profile",
  up(db) {
    db.exec("ALTER TABLE audio_profiles ADD COLUMN start_at_ms INTEGER CHECK (start_at_ms IS NULL OR start_at_ms >= 0)");
  },
};
