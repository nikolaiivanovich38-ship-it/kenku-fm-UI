/**
 * PLY-13 play order (schema v3, table play_orders): how a playlist plays (shuffle, repeat off/all/one) on its own
 * (no place) or in one place: a scene, a session list or a campaign list. A choice applies only where it was made;
 * with none, resolvePlayOrder (src/common/domain/round5.ts) gives the default. Handed out as the domain's
 * PlayOrderOverrides (by place key, then playlist id) and the playlists' own orders (DomainPlaylist.order).
 */
import { REPEATS, type PlayOrder, type PlayOrderOverrides, type UsePlace } from "../../../common/domain";
import type { Store } from "../store";
import * as v from "../validate";
import { newId, requireRow } from "./common";
import { checkPlace, placeKeySql, type PlaceRow } from "./places";

type OrderRow = { id: string; playlist_id: string; shuffle: number; repeat: PlayOrder["repeat"] };

/** A playlist's order in one place (or its own), each through its place's unique partial index. Exported for the query-plan tests. */
export const PLAY_ORDER_LOOKUP_SQL = {
  own: "SELECT * FROM play_orders WHERE playlist_id = ? AND scene_id IS NULL AND session_id IS NULL AND campaign_id IS NULL",
  scene_id: "SELECT * FROM play_orders WHERE scene_id = ? AND playlist_id = ?",
  session_id: "SELECT * FROM play_orders WHERE session_id = ? AND playlist_id = ?",
  campaign_id: "SELECT * FROM play_orders WHERE campaign_id = ? AND playlist_id = ?",
} as const;

const toOrder = (row: OrderRow): PlayOrder => ({ shuffle: row.shuffle === 1, repeat: row.repeat });

function find(store: Store, playlistId: string, place: PlaceRow | null): OrderRow | undefined {
  return place === null ? store.get<OrderRow>(PLAY_ORDER_LOOKUP_SQL.own, playlistId) : store.get<OrderRow>(PLAY_ORDER_LOOKUP_SQL[place.column], place.id, playlistId);
}

function checked(store: Store, playlistId: string, place: UsePlace | null) {
  const id = requireRow(store, "playlists", "playlist", playlistId);
  const { title } = store.get<{ title: string }>("SELECT title FROM playlists WHERE id = ?", id) as { title: string };
  return { id, title, place: place === null ? null : checkPlace(store, place) };
}

function cleanOrder(value: unknown): PlayOrder {
  const input = v.record("order", value);
  return { shuffle: v.boolean("order.shuffle", input.shuffle), repeat: v.oneOf("order.repeat", input.repeat, REPEATS) };
}

/** The order chosen for the playlist there (its own with `place` null), or null when none was chosen. */
export function getPlayOrder(store: Store, playlistId: string, place: UsePlace | null): PlayOrder | null {
  const where = checked(store, playlistId, place);
  const row = find(store, where.id, where.place);
  return row ? toOrder(row) : null;
}

/** Chooses how the playlist plays there (its own order with `place` null), replacing an earlier choice there. */
export function setPlayOrder(store: Store, playlistId: string, place: UsePlace | null, order: PlayOrder): void {
  const where = checked(store, playlistId, place);
  const clean = cleanOrder(order);
  const existing = find(store, where.id, where.place);
  if (existing && toOrder(existing).shuffle === clean.shuffle && existing.repeat === clean.repeat) return;
  const label = `Change the play order of "${where.title}"${where.place ? ` in ${where.place.words}` : ""}`;
  store.change(label, () => {
    if (existing) {
      store.run("UPDATE play_orders SET shuffle = ?, repeat = ? WHERE id = ?", clean.shuffle ? 1 : 0, clean.repeat, existing.id);
      return;
    }
    store.run(
      "INSERT INTO play_orders (id, playlist_id, scene_id, session_id, campaign_id, shuffle, repeat) VALUES (?, ?, ?, ?, ?, ?, ?)",
      newId(),
      where.id,
      where.place?.column === "scene_id" ? where.place.id : null,
      where.place?.column === "session_id" ? where.place.id : null,
      where.place?.column === "campaign_id" ? where.place.id : null,
      clean.shuffle ? 1 : 0,
      clean.repeat,
    );
  });
}

/** "Use the playlist's own order here" (or, with `place` null, the default). Nothing to clear changes nothing. */
export function clearPlayOrder(store: Store, playlistId: string, place: UsePlace | null): void {
  const where = checked(store, playlistId, place);
  const existing = find(store, where.id, where.place);
  if (!existing) return;
  const label = where.place ? `Use the playlist's own order in ${where.place.words}` : `Play "${where.title}" in the default order`;
  store.change(label, () => store.run("DELETE FROM play_orders WHERE id = ?", existing.id));
}

/** Every place's choice, by place key then playlist id: what resolvePlayOrder takes. A small table, read whole. */
export function getPlayOrderOverrides(store: Store): PlayOrderOverrides {
  const { joins, key } = placeKeySql("o");
  const rows = store.all<OrderRow & { place_key: string }>(
    `SELECT o.*, ${key} AS place_key FROM play_orders o ${joins}
     WHERE o.scene_id IS NOT NULL OR o.session_id IS NOT NULL OR o.campaign_id IS NOT NULL
     ORDER BY place_key, o.playlist_id`,
  );
  const out: PlayOrderOverrides = {};
  for (const row of rows) (out[row.place_key] ??= {})[row.playlist_id] = toOrder(row);
  return out;
}

/** The playlists' own orders by playlist id: the given playlists, or every one that has one. */
export function ownPlayOrders(store: Store, playlistIds: string[] | "all"): Map<string, PlayOrder> {
  const own = "scene_id IS NULL AND session_id IS NULL AND campaign_id IS NULL";
  const rows =
    playlistIds === "all"
      ? store.all<OrderRow>(`SELECT * FROM play_orders WHERE ${own}`)
      : playlistIds.length === 0
        ? []
        : store.all<OrderRow>(`SELECT * FROM play_orders WHERE ${own} AND playlist_id IN (SELECT value FROM json_each(?))`, JSON.stringify(playlistIds));
  return new Map(rows.map((row) => [row.playlist_id, toOrder(row)]));
}
