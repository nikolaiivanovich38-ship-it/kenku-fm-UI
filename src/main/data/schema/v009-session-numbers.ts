/**
 * Schema version 9, from the w52-prep stream of 0.5.2 (Nik's list of 14 Nov, item 13: "choose the manual start number
 * and have auto number after that, or choose to manually number everything"). docs/data-model.md "Version 9".
 *
 * - `campaigns.session_numbering`: 'auto' counts sessions on in order from version 1's `first_session_number`, as
 *   before; 'typed' keeps the number typed for each session.
 * - `sessions.typed_number`: a session's typed number (NULL while its campaign counts on by itself).
 *
 * Written as version 8; w52-lib's version 8 (v008-new-and-folder-kind.ts) merged first, so this step is version 9.
 *
 * Frozen once released: later changes go in a new step.
 */
import type { Migration } from "./migrate";

export const v009SessionNumbers: Migration = {
  version: 9,
  name: "session numbers typed by hand (0.5.2, w52-prep)",
  up(db) {
    db.exec(`
      ALTER TABLE campaigns ADD COLUMN session_numbering TEXT NOT NULL DEFAULT 'auto' CHECK (session_numbering IN ('auto', 'typed'));
      ALTER TABLE sessions ADD COLUMN typed_number INTEGER CHECK (typed_number IS NULL OR typed_number BETWEEN 0 AND 100000);
    `);
  },
};
