/**
 * Design round 6 (schema v5): Repeat one per scene and track (PLY-17, table repeat_ones) and a playlist's track order
 * in one place (ORG-13, tables track_orders and track_order_items). Handed out as the domain's RepeatOnes and
 * TrackOrders (src/common/domain/round6.ts), keyed by place key like play orders.
 */
import { placeOrderToKeep, type RepeatOnes, type TrackOrders, type UsePlace } from "../../../common/domain";
import { ValidationError } from "../errors";
import type { Store } from "../store";
import * as v from "../validate";
import { newId, requireRow } from "./common";
import { checkPlace, placeKeySql, type PlaceRow } from "./places";
import { listPlaylistTrackIds } from "./playlists";

/* ---------- PLY-17 Repeat one ---------- */

/** A scene's Repeat ones (primary key) and a track's (repeat_ones_track). Exported for the query-plan tests. */
export const REPEAT_ONES_SQL = {
  ofScene: "SELECT track_id FROM repeat_ones WHERE scene_id = ? ORDER BY track_id",
  ofTrack: "SELECT scene_id FROM repeat_ones WHERE track_id = ?",
} as const;

const sceneWords = (store: Store, sceneId: string) => {
  const { name } = store.get<{ name: string }>("SELECT name FROM scenes WHERE id = ?", sceneId) as { name: string };
  return name ? `the scene "${name}"` : "this scene";
};

/** Repeat one on (or off) for a track in a scene, saved with the scene. A choice it already has makes no undo step. */
export function setRepeatOne(store: Store, sceneId: string, trackId: string, on: boolean): void {
  const scene = requireRow(store, "scenes", "scene", sceneId);
  const track = requireRow(store, "tracks", "track", trackId);
  const want = v.boolean("on", on);
  const has = store.get("SELECT 1 AS x FROM repeat_ones WHERE scene_id = ? AND track_id = ?", scene, track) !== undefined;
  if (has === want) return;
  const where = sceneWords(store, scene);
  store.change(want ? `Repeat one in ${where}` : `Stop repeating one in ${where}`, () => {
    if (want) store.run("INSERT INTO repeat_ones (scene_id, track_id) VALUES (?, ?)", scene, track);
    else store.run("DELETE FROM repeat_ones WHERE scene_id = ? AND track_id = ?", scene, track);
  });
}

/** The tracks with Repeat one in a scene, by id. */
export function sceneRepeatOnes(store: Store, sceneId: string): string[] {
  return store.all<{ track_id: string }>(REPEAT_ONES_SQL.ofScene, v.id("sceneId", sceneId)).map((r) => r.track_id);
}

/** Every scene's Repeat ones, by scene key ("sc:<campaign>:<session>:<scene>"). A small table, read whole. */
export function getRepeatOnes(store: Store): RepeatOnes {
  const rows = store.all<{ campaign_id: string; session_id: string; scene_id: string; track_id: string }>(
    `SELECT s.campaign_id, sc.session_id, r.scene_id, r.track_id FROM repeat_ones r
     JOIN scenes sc ON sc.id = r.scene_id JOIN sessions s ON s.id = sc.session_id
     ORDER BY s.campaign_id, sc.session_id, r.scene_id, r.track_id`,
  );
  const out: RepeatOnes = {};
  for (const row of rows) (out[`sc:${row.campaign_id}:${row.session_id}:${row.scene_id}`] ??= []).push(row.track_id);
  return out;
}

/* ---------- ORG-13 track order per place ---------- */

/** A playlist's order in one place, each through its place's unique partial index; an order's tracks in order. */
export const TRACK_ORDER_LOOKUP_SQL = {
  scene_id: "SELECT id FROM track_orders WHERE scene_id = ? AND playlist_id = ?",
  session_id: "SELECT id FROM track_orders WHERE session_id = ? AND playlist_id = ?",
  campaign_id: "SELECT id FROM track_orders WHERE campaign_id = ? AND playlist_id = ?",
} as const;
export const TRACK_ORDER_ITEMS_SQL = "SELECT track_id FROM track_order_items WHERE order_id = ? ORDER BY position";

function checked(store: Store, playlistId: string, place: UsePlace) {
  const id = requireRow(store, "playlists", "playlist", playlistId);
  if (place === null || place === undefined) throw new ValidationError("place", "A playlist's own order is its list: choose a scene, a session or a campaign.");
  const { title } = store.get<{ title: string }>("SELECT title FROM playlists WHERE id = ?", id) as { title: string };
  return { id, title, place: checkPlace(store, place) };
}

function findOrder(store: Store, playlistId: string, place: PlaceRow): string | undefined {
  return store.get<{ id: string }>(TRACK_ORDER_LOOKUP_SQL[place.column], place.id, playlistId)?.id;
}

const itemsOf = (store: Store, orderId: string) => store.all<{ track_id: string }>(TRACK_ORDER_ITEMS_SQL, orderId).map((r) => r.track_id);

/** The order chosen for the playlist there, every track in it (the rest after), or null when it plays in its own order. */
export function getTrackOrder(store: Store, playlistId: string, place: UsePlace): string[] | null {
  const where = checked(store, playlistId, place);
  const order = findOrder(store, where.id, where.place);
  return order ? placeOrderToKeep(listPlaylistTrackIds(store, where.id), itemsOf(store, order)) : null;
}

/**
 * Orders the playlist's tracks in that place only (a drag, Move up or Move down there). Only its tracks count, each
 * once, the rest after them; the playlist's own order removes the place's ("Back to the playlist's order").
 */
export function setTrackOrder(store: Store, playlistId: string, place: UsePlace, trackIds: string[]): void {
  const where = checked(store, playlistId, place);
  const ids = v.ids("trackIds", trackIds);
  const keep = placeOrderToKeep(listPlaylistTrackIds(store, where.id), ids);
  const existing = findOrder(store, where.id, where.place);
  if (!keep) {
    if (existing) clearTrackOrder(store, playlistId, place);
    return;
  }
  if (existing && itemsOf(store, existing).join("\n") === keep.join("\n")) return;
  store.change(`Order "${where.title}" in ${where.place.words}`, () => {
    let order = existing;
    if (order) store.run("DELETE FROM track_order_items WHERE order_id = ?", order);
    else {
      order = newId();
      store.run(
        "INSERT INTO track_orders (id, playlist_id, scene_id, session_id, campaign_id) VALUES (?, ?, ?, ?, ?)",
        order,
        where.id,
        where.place.column === "scene_id" ? where.place.id : null,
        where.place.column === "session_id" ? where.place.id : null,
        where.place.column === "campaign_id" ? where.place.id : null,
      );
    }
    keep.forEach((trackId, i) => store.run("INSERT INTO track_order_items (order_id, track_id, position) VALUES (?, ?, ?)", order, trackId, i));
  });
}

/** "Back to the playlist's order" in that place. Nothing to clear changes nothing. */
export function clearTrackOrder(store: Store, playlistId: string, place: UsePlace): void {
  const where = checked(store, playlistId, place);
  const existing = findOrder(store, where.id, where.place);
  if (!existing) return;
  store.change(`Back to the order of "${where.title}" in ${where.place.words}`, () => store.run("DELETE FROM track_orders WHERE id = ?", existing));
}

/** Every place's order, by place key then playlist id: each playlist's tracks in the order that plays there. */
export function getTrackOrders(store: Store): TrackOrders {
  const { joins, key } = placeKeySql("o");
  const rows = store.all<{ id: string; playlist_id: string; place_key: string }>(`SELECT o.id, o.playlist_id, ${key} AS place_key FROM track_orders o ${joins} ORDER BY place_key, o.playlist_id`);
  const out: TrackOrders = {};
  const own = new Map<string, string[]>();
  for (const row of rows) {
    if (!own.has(row.playlist_id)) own.set(row.playlist_id, listPlaylistTrackIds(store, row.playlist_id));
    const keep = placeOrderToKeep(own.get(row.playlist_id)!, itemsOf(store, row.id));
    if (keep) (out[row.place_key] ??= {})[row.playlist_id] = keep;
  }
  return out;
}
