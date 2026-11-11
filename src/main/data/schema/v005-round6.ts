/**
 * Schema version 5 (wave 6, design round 6: design/prototype/ROUND6.md part 3 "Play next, Add to queue and Repeat (the
 * data for the contracts)"). docs/data-model.md "Version 5" explains each table, key and index.
 *
 * - Repeat one per scene and track (PLY-17; Nik, 6 Nov 12:30: saved with the scene): `repeat_ones`, a row while it is
 *   on. The room's own Repeat on the Now playing bar is never saved (it lives in the audio host).
 * - A playlist's track order in one place (ORG-13): `track_orders` names the playlist and its one place (a scene, a
 *   session's list or a campaign's list), like `play_orders`; `track_order_items` holds the tracks in that order, one
 *   row each with a position. No row: the playlist's own order. Tracks the order does not name (added to the playlist
 *   later) follow in the playlist's own order (tracksInPlaceOrder in src/common/domain/round6.ts).
 *   The order of the playlists in a session's or campaign's list is not here: `session_playlists.position` and
 *   `campaign_playlists.position` already hold it (version 1).
 *
 * Frozen once released: later changes go in a new step.
 */
import type { Migration } from "./migrate";

const TABLES = `
-- PLY-17: Repeat one on a track in a scene, saved with the scene: the track plays again when it ends.
CREATE TABLE repeat_ones (
  scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  PRIMARY KEY (scene_id, track_id)
) WITHOUT ROWID;

-- ORG-13: a playlist's track order in exactly one place (its own order is playlist_items, or its rule).
CREATE TABLE track_orders (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  scene_id TEXT REFERENCES scenes (id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES campaigns (id) ON DELETE CASCADE,
  CHECK ((scene_id IS NOT NULL) + (session_id IS NOT NULL) + (campaign_id IS NOT NULL) = 1)
);
-- The tracks of one order, each once, in order. A deleted track drops out (the rest keep their order).
CREATE TABLE track_order_items (
  order_id TEXT NOT NULL REFERENCES track_orders (id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  position REAL NOT NULL,
  PRIMARY KEY (order_id, track_id)
) WITHOUT ROWID;
`;

const INDEXES = `
-- PLY-17: a track's Repeat ones in every scene (deleting the track: ON DELETE CASCADE; REPEAT_ONES_SQL.ofTrack).
CREATE INDEX repeat_ones_track ON repeat_ones (track_id);

-- ORG-13: a playlist's order in one place (TRACK_ORDER_LOOKUP_SQL), one per playlist per place.
CREATE UNIQUE INDEX track_orders_scene ON track_orders (scene_id, playlist_id) WHERE scene_id IS NOT NULL;
CREATE UNIQUE INDEX track_orders_session ON track_orders (session_id, playlist_id) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX track_orders_campaign ON track_orders (campaign_id, playlist_id) WHERE campaign_id IS NOT NULL;
-- A playlist's orders everywhere (deleting it: ON DELETE CASCADE).
CREATE INDEX track_orders_playlist ON track_orders (playlist_id);
-- An order's tracks in order (TRACK_ORDER_ITEMS_SQL), one track per position; a track's places (deleting it).
CREATE UNIQUE INDEX track_order_items_order ON track_order_items (order_id, position);
CREATE INDEX track_order_items_track ON track_order_items (track_id);
`;

export const v005Round6: Migration = {
  version: 5,
  name: "design round 6: Repeat one per scene and track, a playlist's track order per place",
  up(db) {
    db.exec(TABLES);
    db.exec(INDEXES);
  },
};
