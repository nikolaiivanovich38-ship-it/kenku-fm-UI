/**
 * Audio profile overrides (PLY-12 data, DAT-11): a track can sound different
 * inside one playlist or in one scene (cue). An override replaces the track's
 * own profile there (changed with updateTrack). Stored as rows of
 * audio_profiles keyed by (track, place) (profileRows.ts); handed out keyed by
 * placeKey from src/common/domain, ready for resolveProfile. A scene's key is
 * worked out from where the scene is now, so an override follows its scene to
 * another session; it goes when its track, playlist or scene is deleted.
 */
import { placeKey, type AudioProfileInput, type ProfileOverrides, type ProfilePlace } from "../../../common/domain";
import { cleanProfile } from "../designValidate";
import { NotFoundError, ValidationError } from "../errors";
import type { Store } from "../store";
import * as v from "../validate";
import { requireRow } from "./common";
import { checkPlace } from "./places";
import { findProfile, profilesOf, removeProfile, saveProfile, type ProfilePlaceRow, type ProfileRow } from "./profileRows";

/** Checks the place; says which column and row it is, and how to name it in an undo label. */
function placeOf(store: Store, place: ProfilePlace): { row: NonNullable<ProfilePlaceRow>; name: string } {
  const input = v.record("place", place);
  const kind = v.oneOf("place.kind", input.kind, ["playlist", "scene", "session"] as const);
  if (kind === "playlist") {
    const id = requireRow(store, "playlists", "playlist", input.playlistId);
    const { title } = store.get<{ title: string }>("SELECT title FROM playlists WHERE id = ?", id) as { title: string };
    return { row: { column: "playlist_id", id }, name: `playlist "${title}"` };
  }
  if (kind === "session") {
    // PLY-14: a session list's own settings for the track.
    const checked = checkPlace(store, { kind: "session", campaignId: input.campaignId as string, sessionId: input.sessionId as string });
    return { row: { column: "session_id", id: checked.id }, name: checked.words.replace(/^the /, "") };
  }
  const sceneId = requireRow(store, "scenes", "scene", input.sceneId);
  const scene = store.get<{ name: string; session_id: string; campaign_id: string }>(
    "SELECT sc.name, sc.session_id, s.campaign_id FROM scenes sc JOIN sessions s ON s.id = sc.session_id WHERE sc.id = ?",
    sceneId,
  ) as { name: string; session_id: string; campaign_id: string };
  if (scene.session_id !== input.sessionId || scene.campaign_id !== input.campaignId) {
    throw new ValidationError("place", "That scene is not in that session of that campaign.");
  }
  return { row: { column: "scene_id", id: sceneId }, name: scene.name ? `scene "${scene.name}"` : "this scene" };
}

/** Gives the track its own audio profile in that place, or replaces the one it has there. */
export function setProfileOverride(store: Store, place: ProfilePlace, trackId: string, profile: AudioProfileInput): void {
  const where = placeOf(store, place);
  const track = requireRow(store, "tracks", "track", trackId);
  const clean = cleanProfile("profile", profile);
  store.change(`Change the track's sound in ${where.name}`, () => saveProfile(store, track, where.row, clean));
}

/** Goes back to the track's own profile in that place ("Use the track's settings here"). */
export function clearProfileOverride(store: Store, place: ProfilePlace, trackId: string): void {
  const where = placeOf(store, place);
  const track = v.id("trackId", trackId);
  const existing = findProfile(store, track, where.row);
  if (!existing) throw new NotFoundError("audio profile override for track", track);
  store.change(`Use the track's own sound in ${where.name}`, () => removeProfile(store, existing.id));
}

/** The track's override in that place, or null when it uses its own profile there. */
export function getProfileOverride(store: Store, place: ProfilePlace, trackId: string): AudioProfileInput | null {
  const existing = findProfile(store, v.id("trackId", trackId), placeOf(store, place).row);
  return existing ? (profilesOf(store, [existing]).get(existing.id) as AudioProfileInput) : null;
}

/** Every override (or one track's) by place key, then track id: what resolveProfile takes. */
export function getProfileOverrides(store: Store, options: { trackId?: string } = {}): ProfileOverrides {
  const overridesOnly = "(p.playlist_id IS NOT NULL OR p.scene_id IS NOT NULL OR p.session_id IS NOT NULL)";
  const filter = options.trackId === undefined ? overridesOnly : `p.track_id = ? AND ${overridesOnly}`;
  const params = options.trackId === undefined ? [] : [v.id("trackId", options.trackId)];
  const rows = store.all<ProfileRow & { scene_session_id: string | null; campaign_id: string | null }>(
    `SELECT p.*, sc.session_id AS scene_session_id, s.campaign_id
     FROM audio_profiles p LEFT JOIN scenes sc ON sc.id = p.scene_id LEFT JOIN sessions s ON s.id = coalesce(p.session_id, sc.session_id)
     WHERE ${filter}`,
    ...params,
  );
  const profiles = profilesOf(store, rows);
  const keyed = rows.map((row) => ({
    key: placeKey(
      row.playlist_id !== null
        ? { kind: "playlist", playlistId: row.playlist_id }
        : row.session_id !== null
          ? { kind: "session", campaignId: row.campaign_id as string, sessionId: row.session_id }
          : { kind: "scene", campaignId: row.campaign_id as string, sessionId: row.scene_session_id as string, sceneId: row.scene_id as string },
    ),
    row,
  }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.row.track_id < b.row.track_id ? -1 : 1));
  const out: ProfileOverrides = {};
  for (const { key, row } of keyed) (out[key] ??= {})[row.track_id] = profiles.get(row.id) as AudioProfileInput;
  return out;
}
