/**
 * DAT-14 a track's name in a scene (schema v3, table scene_track_names): "Strahd's entrance" in one scene, the
 * track's own name everywhere else (trackNameIn in src/common/domain/round5.ts). Names are part of the track's search
 * entry (searchIndex.ts). A name is kept even if the track leaves the scene's music for a while, so putting it back
 * brings the name back; it goes with the scene or the track.
 */
import type { TrackNames } from "../../../common/domain";
import type { Store } from "../store";
import * as v from "../validate";
import { requireRow } from "./common";

/** The longest name in a scene (the table's CHECK). */
export const MAX_SCENE_NAME_LENGTH = 200;

/** A scene's names (primary key) and a track's names (scene_track_names_track). Exported for the query-plan tests. */
export const SCENE_NAMES_SQL = {
  ofScene: "SELECT track_id, name FROM scene_track_names WHERE scene_id = ?",
  ofTrack: `SELECT s.campaign_id, sc.session_id, n.scene_id, n.name FROM scene_track_names n
    JOIN scenes sc ON sc.id = n.scene_id JOIN sessions s ON s.id = sc.session_id WHERE n.track_id = ?`,
} as const;

/** Names the track in the scene ("Name in this scene…"); an empty or blank name gives it back its own name there. */
export function setSceneTrackName(store: Store, sceneId: string, trackId: string, name: string): void {
  const scene = requireRow(store, "scenes", "scene", sceneId);
  const track = requireRow(store, "tracks", "track", trackId);
  const clean = (v.nullableText("name", name, MAX_SCENE_NAME_LENGTH) ?? "").trim();
  const current = store.get<{ name: string }>("SELECT name FROM scene_track_names WHERE scene_id = ? AND track_id = ?", scene, track)?.name ?? "";
  if (clean === current) return;
  const { scene_name } = store.get<{ scene_name: string }>("SELECT name AS scene_name FROM scenes WHERE id = ?", scene) as { scene_name: string };
  const where = scene_name ? `the scene "${scene_name}"` : "this scene";
  store.change(clean ? `Name the track "${clean}" in ${where}` : `Use the track's own name in ${where}`, () => {
    if (!clean) store.run("DELETE FROM scene_track_names WHERE scene_id = ? AND track_id = ?", scene, track);
    else if (current) store.run("UPDATE scene_track_names SET name = ? WHERE scene_id = ? AND track_id = ?", clean, scene, track);
    else store.run("INSERT INTO scene_track_names (scene_id, track_id, name) VALUES (?, ?, ?)", scene, track, clean);
  });
}

/** Every name (or one track's), by scene key ("sc:<campaign>:<session>:<scene>") then track id: what trackNameIn takes. */
export function getTrackNames(store: Store, options: { trackId?: string } = {}): TrackNames {
  const rows = store.all<{ campaign_id: string; session_id: string; scene_id: string; track_id: string; name: string }>(
    `SELECT s.campaign_id, sc.session_id, n.scene_id, n.track_id, n.name FROM scene_track_names n
     JOIN scenes sc ON sc.id = n.scene_id JOIN sessions s ON s.id = sc.session_id
     ${options.trackId === undefined ? "" : "WHERE n.track_id = ?"} ORDER BY s.campaign_id, sc.session_id, n.scene_id, n.track_id`,
    ...(options.trackId === undefined ? [] : [v.id("trackId", options.trackId)]),
  );
  const out: TrackNames = {};
  for (const row of rows) (out[`sc:${row.campaign_id}:${row.session_id}:${row.scene_id}`] ??= {})[row.track_id] = row.name;
  return out;
}

/** A track's names in scenes, in campaign, session and scene order (Library details "Names in scenes"). */
export function listTrackSceneNames(store: Store, trackId: string): { campaignId: string; sessionId: string; sceneId: string; name: string }[] {
  return store
    .all<{ campaign_id: string; session_id: string; scene_id: string; name: string; c: number; s: number; p: number }>(
      `SELECT x.*, c.position AS c, ss.position AS s, sc.position AS p FROM (${SCENE_NAMES_SQL.ofTrack}) x
       JOIN campaigns c ON c.id = x.campaign_id JOIN sessions ss ON ss.id = x.session_id JOIN scenes sc ON sc.id = x.scene_id
       ORDER BY c, s, p`,
      v.id("trackId", trackId),
    )
    .map((r) => ({ campaignId: r.campaign_id, sessionId: r.session_id, sceneId: r.scene_id, name: r.name }));
}
