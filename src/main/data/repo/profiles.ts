/**
 * Audio profile overrides (PLY-12 data, DAT-11): a track can sound different
 * inside one playlist or in one scene (cue). An override replaces the track's
 * own profile there (tracks.profile, changed with updateTrack). Overrides are
 * handed out keyed by placeKey from src/common/domain, ready for resolveProfile.
 * A scene's key is worked out from where the scene is now, so an override
 * follows its scene to another session; it goes when its track, playlist or
 * scene is deleted.
 */
import { placeKey, type AudioProfileInput, type ProfileOverrides, type ProfilePlace } from "../../../common/domain";
import { cleanProfile, parseJson } from "../designValidate";
import { NotFoundError, ValidationError } from "../errors";
import type { Store } from "../store";
import * as v from "../validate";
import { newId, requireRow } from "./common";

type Where = { column: "playlist_id" | "scene_id"; id: string; name: string };

/** Checks the place and says which column and row it is. */
function placeOf(store: Store, place: ProfilePlace): Where {
  const input = v.record("place", place);
  const kind = v.oneOf("place.kind", input.kind, ["playlist", "scene"] as const);
  if (kind === "playlist") {
    const id = requireRow(store, "playlists", "playlist", input.playlistId);
    const { title } = store.get<{ title: string }>("SELECT title FROM playlists WHERE id = ?", id) as { title: string };
    return { column: "playlist_id", id, name: `playlist "${title}"` };
  }
  const sceneId = requireRow(store, "scenes", "scene", input.sceneId);
  const scene = store.get<{ name: string; session_id: string; campaign_id: string }>(
    "SELECT sc.name, sc.session_id, s.campaign_id FROM scenes sc JOIN sessions s ON s.id = sc.session_id WHERE sc.id = ?",
    sceneId,
  ) as { name: string; session_id: string; campaign_id: string };
  if (scene.session_id !== input.sessionId || scene.campaign_id !== input.campaignId) {
    throw new ValidationError("place", "That scene is not in that session of that campaign.");
  }
  return { column: "scene_id", id: sceneId, name: scene.name ? `scene "${scene.name}"` : "this scene" };
}

const findOverride = (store: Store, where: Where, trackId: string) =>
  store.get<{ id: string; profile: string }>(`SELECT id, profile FROM profile_overrides WHERE ${where.column} = ? AND track_id = ?`, where.id, trackId);

/** Gives the track its own audio profile in that place, or replaces the one it has there. */
export function setProfileOverride(store: Store, place: ProfilePlace, trackId: string, profile: AudioProfileInput): void {
  const where = placeOf(store, place);
  const track = requireRow(store, "tracks", "track", trackId);
  const json = JSON.stringify(cleanProfile("profile", profile));
  store.change(`Change the track's sound in ${where.name}`, () => {
    const existing = findOverride(store, where, track);
    if (existing) store.run("UPDATE profile_overrides SET profile = ? WHERE id = ?", json, existing.id);
    else {
      store.run(
        `INSERT INTO profile_overrides (id, track_id, ${where.column}, profile) VALUES (?, ?, ?, ?)`,
        newId(),
        track,
        where.id,
        json,
      );
    }
  });
}

/** Goes back to the track's own profile in that place ("Use the track's settings here"). */
export function clearProfileOverride(store: Store, place: ProfilePlace, trackId: string): void {
  const where = placeOf(store, place);
  const track = v.id("trackId", trackId);
  const existing = findOverride(store, where, track);
  if (!existing) throw new NotFoundError("audio profile override for track", track);
  store.change(`Use the track's own sound in ${where.name}`, () => store.run("DELETE FROM profile_overrides WHERE id = ?", existing.id));
}

/** The track's override in that place, or null when it uses its own profile there. */
export function getProfileOverride(store: Store, place: ProfilePlace, trackId: string): AudioProfileInput | null {
  const existing = findOverride(store, placeOf(store, place), v.id("trackId", trackId));
  return existing ? parseJson<AudioProfileInput>(existing.profile) : null;
}

/** Every override (or one track's) by place key, then track id: what resolveProfile takes. */
export function getProfileOverrides(store: Store, options: { trackId?: string } = {}): ProfileOverrides {
  const filter = options.trackId === undefined ? "" : "WHERE o.track_id = ?";
  const params = options.trackId === undefined ? [] : [v.id("trackId", options.trackId)];
  const rows = store.all<{
    track_id: string;
    profile: string;
    playlist_id: string | null;
    scene_id: string | null;
    session_id: string | null;
    campaign_id: string | null;
  }>(
    `SELECT o.track_id, o.profile, o.playlist_id, o.scene_id, sc.session_id, s.campaign_id
     FROM profile_overrides o LEFT JOIN scenes sc ON sc.id = o.scene_id LEFT JOIN sessions s ON s.id = sc.session_id
     ${filter}`,
    ...params,
  );
  const keyed = rows.map((row) => ({
    key: placeKey(
      row.playlist_id !== null
        ? { kind: "playlist", playlistId: row.playlist_id }
        : { kind: "scene", campaignId: row.campaign_id as string, sessionId: row.session_id as string, sceneId: row.scene_id as string },
    ),
    row,
  }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.row.track_id < b.row.track_id ? -1 : 1));
  const out: ProfileOverrides = {};
  for (const { key, row } of keyed) (out[key] ??= {})[row.track_id] = parseJson<AudioProfileInput>(row.profile) as AudioProfileInput;
  return out;
}
