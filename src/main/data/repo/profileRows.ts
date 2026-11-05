/**
 * Storage of audio profiles (PLY-12, DAT-11) as rows: audio_profiles holds the
 * settings in typed columns (NULL = the default), audio_profile_markers the
 * named points in order. Shared by tracks.ts (a track's own profile) and
 * profiles.ts (overrides per playlist or scene). Writers here run inside the
 * caller's change; validation (cleanProfile) is the caller's.
 */
import type { AudioProfileInput } from "../../../common/domain";
import type { SQLInputValue } from "../sqlite";
import type { Store } from "../store";
import { newId, placeholders } from "./common";

/** Where a profile applies: the track's own (null), or one playlist, scene or (PLY-14) session list. */
export type ProfilePlaceRow = { column: "playlist_id" | "scene_id" | "session_id"; id: string } | null;

export type ProfileRow = {
  id: string;
  track_id: string;
  playlist_id: string | null;
  scene_id: string | null;
  session_id: string | null;
  start_ms: number | null;
  end_ms: number | null;
  after_end: string | null;
  loop_start_ms: number | null;
  loop_crossfade_ms: number | null;
  fade_in_ms: number | null;
  fade_in_shape: number | null;
  fade_out_ms: number | null;
  fade_out_shape: number | null;
};

type Marker = { atMs: number; label: string };

function settingsOf(profile: AudioProfileInput): Record<string, SQLInputValue> {
  return {
    start_ms: profile.startMs ?? null,
    end_ms: profile.endMs ?? null,
    after_end: profile.after ?? null,
    loop_start_ms: profile.loopStartMs ?? null,
    loop_crossfade_ms: profile.loopCrossfadeMs ?? null,
    fade_in_ms: profile.fadeIn?.ms ?? null,
    fade_in_shape: profile.fadeIn?.shape ?? null,
    fade_out_ms: profile.fadeOut?.ms ?? null,
    fade_out_shape: profile.fadeOut?.shape ?? null,
  };
}

/** A stored profile in the domain's shape: only the settings it has; markers when it has any. */
export function toProfile(row: ProfileRow, markers: Marker[] | undefined): AudioProfileInput {
  const p: AudioProfileInput = {};
  if (row.start_ms !== null) p.startMs = row.start_ms;
  if (row.end_ms !== null) p.endMs = row.end_ms;
  if (row.after_end !== null) p.after = row.after_end as AudioProfileInput["after"];
  if (row.loop_start_ms !== null) p.loopStartMs = row.loop_start_ms;
  if (row.loop_crossfade_ms !== null) p.loopCrossfadeMs = row.loop_crossfade_ms;
  if (row.fade_in_ms !== null) p.fadeIn = { ms: row.fade_in_ms, shape: row.fade_in_shape as number };
  if (row.fade_out_ms !== null) p.fadeOut = { ms: row.fade_out_ms, shape: row.fade_out_shape as number };
  if (markers && markers.length > 0) p.markers = markers;
  return p;
}

/**
 * Profile lookup by (track, place), each through its place's unique partial
 * index (audio_profiles_own / _playlist / _scene). Exported for the query-plan tests.
 */
export const PROFILE_LOOKUP_SQL = {
  own: "SELECT * FROM audio_profiles WHERE track_id = ? AND playlist_id IS NULL AND scene_id IS NULL AND session_id IS NULL",
  playlist_id: "SELECT * FROM audio_profiles WHERE playlist_id = ? AND track_id = ?",
  scene_id: "SELECT * FROM audio_profiles WHERE scene_id = ? AND track_id = ?",
  session_id: "SELECT * FROM audio_profiles WHERE session_id = ? AND track_id = ?",
} as const;

/** The profile of a track in a place. */
export function findProfile(store: Store, trackId: string, place: ProfilePlaceRow): ProfileRow | undefined {
  return place === null
    ? store.get<ProfileRow>(PROFILE_LOOKUP_SQL.own, trackId)
    : store.get<ProfileRow>(PROFILE_LOOKUP_SQL[place.column], place.id, trackId);
}

/** Markers of the given profiles, in order, by profile id. */
export function markersOf(store: Store, profileIds: string[]): Map<string, Marker[]> {
  const out = new Map<string, Marker[]>();
  if (profileIds.length === 0) return out;
  const rows = store.all<{ profile_id: string; at_ms: number; label: string }>(
    `SELECT profile_id, at_ms, label FROM audio_profile_markers
     WHERE profile_id IN (SELECT value FROM json_each(?)) ORDER BY profile_id, position`,
    JSON.stringify(profileIds),
  );
  for (const row of rows) {
    const list = out.get(row.profile_id);
    const marker = { atMs: row.at_ms, label: row.label };
    if (list) list.push(marker);
    else out.set(row.profile_id, [marker]);
  }
  return out;
}

/** Stored profiles in the domain's shape, by profile id. */
export function profilesOf(store: Store, rows: ProfileRow[]): Map<string, AudioProfileInput> {
  const markers = markersOf(
    store,
    rows.map((r) => r.id),
  );
  return new Map(rows.map((row) => [row.id, toProfile(row, markers.get(row.id))]));
}

/** Tracks' own profiles by track id: the given tracks, or every track. */
export function ownProfiles(store: Store, trackIds: string[] | "all"): Map<string, AudioProfileInput> {
  const rows =
    trackIds === "all"
      ? store.all<ProfileRow>("SELECT * FROM audio_profiles WHERE playlist_id IS NULL AND scene_id IS NULL AND session_id IS NULL")
      : trackIds.length === 0
        ? []
        : store.all<ProfileRow>(
            `SELECT * FROM audio_profiles WHERE playlist_id IS NULL AND scene_id IS NULL AND session_id IS NULL
               AND track_id IN (SELECT value FROM json_each(?))`,
            JSON.stringify(trackIds),
          );
  const profiles = profilesOf(store, rows);
  return new Map(rows.map((row) => [row.track_id, profiles.get(row.id) as AudioProfileInput]));
}

/** Gives the track this (checked) profile in the place, replacing what it had there. Inside a change. */
export function saveProfile(store: Store, trackId: string, place: ProfilePlaceRow, profile: AudioProfileInput): void {
  const settings = settingsOf(profile);
  const names = Object.keys(settings);
  const existing = findProfile(store, trackId, place);
  let id: string;
  if (existing) {
    id = existing.id;
    store.run(`UPDATE audio_profiles SET ${names.map((n) => `${n} = ?`).join(", ")} WHERE id = ?`, ...names.map((n) => settings[n]), id);
    store.run("DELETE FROM audio_profile_markers WHERE profile_id = ?", id);
  } else {
    id = newId();
    const columns: Record<string, SQLInputValue> = {
      id,
      track_id: trackId,
      playlist_id: place?.column === "playlist_id" ? place.id : null,
      scene_id: place?.column === "scene_id" ? place.id : null,
      session_id: place?.column === "session_id" ? place.id : null,
      ...settings,
    };
    const all = Object.keys(columns);
    store.run(`INSERT INTO audio_profiles (${all.join(", ")}) VALUES (${placeholders(all.length)})`, ...all.map((n) => columns[n]));
  }
  (profile.markers ?? []).forEach((marker, position) =>
    store.run("INSERT INTO audio_profile_markers (profile_id, position, at_ms, label) VALUES (?, ?, ?, ?)", id, position, marker.atMs, marker.label),
  );
}

/** Removes the track's profile in the place (its markers go with it). Inside a change. */
export function removeProfile(store: Store, profileId: string): void {
  store.run("DELETE FROM audio_profiles WHERE id = ?", profileId);
}
