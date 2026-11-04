/**
 * Tracks (DAT-1, DAT-2, DAT-11): every audio file exists once in the library;
 * playlists, pads and scenes refer to it. A track has a kind (music, ambience,
 * effect), up to three names (the game master's title, which may be empty, the
 * title in the file's tags, and the file name) and may have its own audio profile.
 */
import { NotFoundError, ValidationError } from "../errors";
import { GAP } from "../ordering";
import { fileNameOf, findRoot, isAbsolutePath, joinRoot } from "../paths";
import type { SQLInputValue } from "../sqlite";
import type { Store } from "../store";
import type { AudioProfileInput } from "../../../common/domain";
import { cleanProfile } from "../designValidate";
import {
  ARCS,
  ENDINGS,
  LOOPABLE,
  ROLES,
  TRACK_KINDS,
  type FileFacts,
  type Track,
  type TrackInput,
  type TrackPatch,
  type TrackUsage,
  type Transition,
} from "../types";
import * as v from "../validate";
import { newId, patchOf, placeholders, plural, requireRow, toFlag } from "./common";
import { listRoots } from "./roots";
import { findProfile, ownProfiles, removeProfile, saveProfile } from "./profileRows";

type TrackRow = {
  id: string;
  kind: string;
  title: string;
  meta_title: string;
  root_id: string | null;
  path: string | null;
  url: string | null;
  file_name: string;
  file_size: number | null;
  file_mtime_ms: number | null;
  checksum: string | null;
  duration_ms: number | null;
  energy: number | null;
  arc: string | null;
  role: string | null;
  loopable: string | null;
  ending: string | null;
  transition_in: string | null;
  transition_out: string | null;
  follow_required: number;
  notes: string;
  source_composer: string | null;
  source_album: string | null;
  source_cue_number: string | null;
  rating: number | null;
  last_used_at: number | null;
  is_new: number;
  created_at: number;
  updated_at: number;
};

function toTrack(row: TrackRow, profile: AudioProfileInput | null): Track {
  const location: Track["location"] =
    row.url !== null
      ? { kind: "url", url: row.url }
      : row.root_id !== null
        ? { kind: "root", rootId: row.root_id, path: row.path as string }
        : { kind: "absolute", path: row.path as string };
  return {
    id: row.id,
    kind: row.kind as Track["kind"],
    title: row.title,
    metaTitle: row.meta_title,
    profile,
    location,
    fileName: row.file_name,
    fileSize: row.file_size,
    fileMtimeMs: row.file_mtime_ms,
    checksum: row.checksum,
    durationMs: row.duration_ms,
    energy: row.energy,
    arc: row.arc as Track["arc"],
    role: row.role as Track["role"],
    loopable: row.loopable as Track["loopable"],
    ending: row.ending as Track["ending"],
    transitionIn: row.transition_in === null ? null : (JSON.parse(row.transition_in) as Transition),
    transitionOut: row.transition_out === null ? null : (JSON.parse(row.transition_out) as Transition),
    followRequired: row.follow_required === 1,
    notes: row.notes,
    sourceComposer: row.source_composer,
    sourceAlbum: row.source_album,
    sourceCueNumber: row.source_cue_number,
    rating: row.rating,
    lastUsedAt: row.last_used_at,
    isNew: row.is_new === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Checks a transition and returns it as stored JSON (or null). */
function transitionJson(field: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const input = v.record(field, value);
  const kind = v.oneOf(`${field}.kind`, input.kind, [
    "crossfade",
    "cut",
    "after_current_ends",
    "at_mix_out",
    "after_loop",
  ] as const);
  let clean: Transition;
  if (kind === "crossfade") {
    clean = {
      kind,
      seconds: v.numberInRange(`${field}.seconds`, input.seconds, 0, 600),
      curve: v.oneOf(`${field}.curve`, input.curve ?? "equal_power", ["linear", "equal_power"] as const),
    };
  } else {
    clean = { kind };
  }
  return JSON.stringify(clean);
}

/** Column values for the metadata fields present in `input`. */
function metadataColumns(input: Record<string, unknown>): Record<string, SQLInputValue> {
  const columns: Record<string, SQLInputValue> = {};
  const has = (key: string) => key in input;
  // The game master's title may be empty: a new track shows its file-tag title until given one.
  if (has("title")) columns.title = v.nullableText("title", input.title) ?? "";
  if (has("metaTitle")) columns.meta_title = v.nullableText("metaTitle", input.metaTitle) ?? "";
  if (has("kind")) columns.kind = v.oneOf("kind", input.kind, TRACK_KINDS);
  if (has("energy")) columns.energy = v.nullableInteger("energy", input.energy, 1, 5);
  if (has("arc")) columns.arc = v.nullableOneOf("arc", input.arc, ARCS);
  if (has("role")) columns.role = v.nullableOneOf("role", input.role, ROLES);
  if (has("loopable")) columns.loopable = v.nullableOneOf("loopable", input.loopable, LOOPABLE);
  if (has("ending")) columns.ending = v.nullableOneOf("ending", input.ending, ENDINGS);
  if (has("transitionIn")) columns.transition_in = transitionJson("transitionIn", input.transitionIn);
  if (has("transitionOut")) columns.transition_out = transitionJson("transitionOut", input.transitionOut);
  if (has("followRequired")) columns.follow_required = toFlag(v.boolean("followRequired", input.followRequired));
  if (has("notes")) columns.notes = v.optionalText("notes", input.notes);
  if (has("sourceComposer")) columns.source_composer = v.nullableText("sourceComposer", input.sourceComposer);
  if (has("sourceAlbum")) columns.source_album = v.nullableText("sourceAlbum", input.sourceAlbum);
  if (has("sourceCueNumber")) columns.source_cue_number = v.nullableText("sourceCueNumber", input.sourceCueNumber, 50);
  if (has("rating")) columns.rating = v.nullableInteger("rating", input.rating, 1, 5);
  if (has("isNew")) columns.is_new = toFlag(v.boolean("isNew", input.isNew));
  if (has("durationMs"))
    columns.duration_ms = input.durationMs === null ? null : v.milliseconds("durationMs", input.durationMs);
  return columns;
}

function optionalNumber(field: string, value: unknown): number | null {
  if (value === undefined || value === null) return null;
  return v.integer(field, value, 0, Number.MAX_SAFE_INTEGER);
}

/** Column values for where the audio is, from `file` or `url`. */
function locationColumns(
  roots: { id: string; path: string }[],
  input: { file?: FileFacts; url?: string },
): Record<string, SQLInputValue> {
  if ((input.file === undefined) === (input.url === undefined)) {
    throw new ValidationError("file", "A track needs either a file or a web address.");
  }
  if (input.url !== undefined) {
    const url = v.webAddress("url", input.url);
    const lastPart = new URL(url).pathname.split("/").pop() ?? "";
    let fileName = lastPart;
    try {
      fileName = decodeURIComponent(lastPart);
    } catch {
      // Keep the encoded name when it is not valid percent-encoding.
    }
    return { root_id: null, path: null, url, file_name: fileName, file_size: null, file_mtime_ms: null, checksum: null };
  }
  const file = v.record("file", input.file);
  const absolute = v.requiredName("file.path", file.path, v.MAX_TEXT_LENGTH);
  if (!isAbsolutePath(absolute)) throw new ValidationError("file.path", "The file must be given with its full path.");
  const underRoot = findRoot(roots, absolute);
  return {
    root_id: underRoot ? underRoot.root.id : null,
    path: underRoot ? underRoot.relative : absolute,
    url: null,
    file_name: fileNameOf(absolute),
    file_size: optionalNumber("file.size", file.size),
    file_mtime_ms: optionalNumber("file.mtimeMs", file.mtimeMs),
    checksum: v.nullableText("file.checksum", file.checksum, 200),
  };
}

/** The checked own profile in `input`: undefined when not given, null to clear it. */
function profileOf(input: Record<string, unknown>): AudioProfileInput | null | undefined {
  if (!("profile" in input) || input.profile === undefined) return undefined;
  return input.profile === null ? null : cleanProfile("profile", input.profile);
}

/** Gives the track its own profile, or clears it (null). Inside a change. */
function writeOwnProfile(store: Store, trackId: string, profile: AudioProfileInput | null) {
  if (profile !== null) return saveProfile(store, trackId, null, profile);
  const existing = findProfile(store, trackId, null);
  if (existing) removeProfile(store, existing.id);
}

function insertTrack(store: Store, roots: { id: string; path: string }[], input: TrackInput): string {
  const record = v.record("track", input);
  const id = newId(record.id);
  const profile = profileOf(record);
  const columns: Record<string, SQLInputValue> = {
    id,
    title: "",
    ...metadataColumns(record),
    ...locationColumns(roots, record as { file?: FileFacts; url?: string }),
    created_at: store.now(),
    updated_at: store.now(),
  };
  const names = Object.keys(columns);
  store.run(
    `INSERT INTO tracks (${names.join(", ")}) VALUES (${placeholders(names.length)})`,
    ...names.map((name) => columns[name]),
  );
  if (profile) writeOwnProfile(store, id, profile);
  return id;
}

export function createTrack(store: Store, input: TrackInput): Track {
  return createTracks(store, [input])[0];
}

/** Adds several tracks as one step (for example a dropped folder). */
export function createTracks(store: Store, inputs: TrackInput[]): Track[] {
  if (!Array.isArray(inputs)) throw new ValidationError("tracks", "tracks must be a list.");
  const roots = listRoots(store);
  const ids = store.change(`Add ${plural(inputs.length, "track")}`, () =>
    inputs.map((input) => insertTrack(store, roots, input)),
  );
  return ids.map((id) => getTrack(store, id) as Track);
}

export function getTrack(store: Store, id: string): Track | null {
  const row = store.get<TrackRow>("SELECT * FROM tracks WHERE id = ?", id);
  return row ? toTrack(row, ownProfiles(store, [row.id]).get(row.id) ?? null) : null;
}

export type TrackListOptions = {
  /** Only tracks carrying every one of these tags. */
  tagIds?: string[];
  limit?: number;
  offset?: number;
};

/** The name a track is shown by: its title, else its file-tag title, else its file name. */
export const SHOWN_TITLE_SQL = "coalesce(nullif(title, ''), nullif(meta_title, ''), file_name)";

/**
 * Tracks carrying every one of `count` tags, in the order of the name they are
 * shown by: starts from track_tags_tag (tracks by tag), then looks each track
 * up by its key. Exported for the query-plan tests.
 */
export function tracksWithTagsSql(count: number): string {
  return `SELECT * FROM tracks WHERE id IN (SELECT track_id FROM track_tags WHERE tag_id IN (${placeholders(count)})
    GROUP BY track_id HAVING count(*) = ${count}) ORDER BY ${SHOWN_TITLE_SQL} COLLATE NOCASE, id LIMIT ? OFFSET ?`;
}

/** Tracks in order of the name they are shown by; with `tagIds`, only those carrying all of them. */
export function listTracks(store: Store, options: TrackListOptions = {}): Track[] {
  const tagIds = options.tagIds === undefined ? [] : v.ids("tagIds", options.tagIds);
  const limit = options.limit === undefined ? -1 : v.integer("limit", options.limit, 0, 1_000_000);
  const offset = options.offset === undefined ? 0 : v.integer("offset", options.offset, 0, Number.MAX_SAFE_INTEGER);
  const rows = store.all<TrackRow>(
    tagIds.length === 0
      ? `SELECT * FROM tracks ORDER BY ${SHOWN_TITLE_SQL} COLLATE NOCASE, id LIMIT ? OFFSET ?`
      : tracksWithTagsSql(tagIds.length),
    ...tagIds,
    limit,
    offset,
  );
  const profiles = ownProfiles(
    store,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toTrack(row, profiles.get(row.id) ?? null));
}

const PATCHABLE = [
  "title",
  "metaTitle",
  "kind",
  "profile",
  "file",
  "url",
  "durationMs",
  "energy",
  "arc",
  "role",
  "loopable",
  "ending",
  "transitionIn",
  "transitionOut",
  "followRequired",
  "notes",
  "sourceComposer",
  "sourceAlbum",
  "sourceCueNumber",
  "rating",
  "isNew",
] as const;

/**
 * Tracks marked New (added by an import, not yet given a title and a tag),
 * newest first, through tracks_new. Exported for the query-plan tests.
 */
export const NEW_TRACKS_SQL = "SELECT id FROM tracks WHERE is_new = 1 ORDER BY created_at DESC, id";

/** The ids of the tracks marked New, newest first (the Library's "New, not tagged yet" adds untagged tracks to these). */
export function listNewTrackIds(store: Store): string[] {
  return store.all<{ id: string }>(NEW_TRACKS_SQL).map((row) => row.id);
}

/** Changes only the fields given; null clears an optional field. */
export function updateTrack(store: Store, id: string, changes: TrackPatch): Track {
  const patch = patchOf(changes, PATCHABLE);
  const trackId = requireRow(store, "tracks", "track", id);
  const columns = metadataColumns(patch);
  const profile = profileOf(patch);
  if (patch.file !== undefined || patch.url !== undefined) {
    Object.assign(columns, locationColumns(listRoots(store), patch as { file?: FileFacts; url?: string }));
  }
  const names = Object.keys(columns);
  if (names.length > 0 || profile !== undefined) {
    store.change("Edit track", () => {
      store.run(
        `UPDATE tracks SET ${[...names.map((name) => `${name} = ?`), "updated_at = ?"].join(", ")} WHERE id = ?`,
        ...names.map((name) => columns[name]),
        store.now(),
        trackId,
      );
      if (profile !== undefined) writeOwnProfile(store, trackId, profile);
    });
  }
  return getTrack(store, trackId) as Track;
}

/** Where a track is used, so the interface can ask before deleting it (DAT-1). */
export function trackUsage(store: Store, id: string): TrackUsage {
  return {
    playlists: store.all<{ id: string; title: string }>(
      `SELECT DISTINCT p.id, p.title FROM playlists p JOIN playlist_items i ON i.playlist_id = p.id
       WHERE i.track_id = ? ORDER BY p.title COLLATE NOCASE`,
      id,
    ),
    boards: store.all<{ id: string; title: string }>(
      `SELECT DISTINCT b.id, b.title FROM boards b JOIN pads p ON p.board_id = b.id JOIN pad_sounds s ON s.pad_id = p.id
       WHERE s.track_id = ? ORDER BY b.title COLLATE NOCASE`,
      id,
    ),
    scenes: store.all<{ id: string; name: string }>(
      `SELECT s.id, s.name FROM scenes s WHERE s.id IN
         (SELECT scene_id FROM scene_music WHERE track_id = ?1 UNION SELECT scene_id FROM scene_ambience WHERE track_id = ?1)
       ORDER BY s.name COLLATE NOCASE`,
      id,
    ),
  };
}

/** Deletes tracks from the library and from every list they are in, as one undoable step. */
export function deleteTracks(store: Store, ids: string[]): void {
  const trackIds = v.ids("trackIds", ids).map((id) => requireRow(store, "tracks", "track", id));
  store.change(`Delete ${plural(trackIds.length, "track")}`, () => {
    for (const id of trackIds) store.run("DELETE FROM tracks WHERE id = ?", id);
  });
}

/** Replaces a track's "follow with" suggestions, in order (DAT-2, SHW-3). */
export function setFollowWith(store: Store, trackId: string, followIds: string[]): void {
  const id = requireRow(store, "tracks", "track", trackId);
  const follow = [...new Set(v.ids("followIds", followIds))];
  if (follow.includes(id)) throw new ValidationError("followIds", "A track cannot follow itself.");
  follow.forEach((followId) => requireRow(store, "tracks", "track", followId));
  store.change("Change what follows the track", () => {
    store.run("DELETE FROM track_follow_with WHERE track_id = ?", id);
    follow.forEach((followId, index) =>
      store.run(
        "INSERT INTO track_follow_with (track_id, follow_track_id, position) VALUES (?, ?, ?)",
        id,
        followId,
        (index + 1) * GAP,
      ),
    );
  });
}

export function getFollowWith(store: Store, trackId: string): string[] {
  return store
    .all<{ follow_track_id: string }>(
      "SELECT follow_track_id FROM track_follow_with WHERE track_id = ? ORDER BY position",
      trackId,
    )
    .map((row) => row.follow_track_id);
}

/**
 * Records when tracks were last played. Bookkeeping, not an edit: it is not
 * an undo step and does not change "updated".
 */
export function markTracksUsed(store: Store, ids: string[], at: number = store.now()): void {
  const trackIds = v.ids("trackIds", ids);
  const time = v.integer("at", at, 0, Number.MAX_SAFE_INTEGER);
  store.changeWithoutHistory(() => {
    for (const id of trackIds) store.run("UPDATE tracks SET last_used_at = ? WHERE id = ?", time, id);
  });
}

/** The full path (or web address) to play a track from. */
export function resolveTrackLocation(store: Store, track: Track): string {
  const location = track.location;
  if (location.kind === "url") return location.url;
  if (location.kind === "absolute") return location.path;
  const root = store.get<{ path: string }>("SELECT path FROM library_roots WHERE id = ?", location.rootId);
  if (!root) throw new NotFoundError("library folder", location.rootId);
  return joinRoot(root.path, location.path);
}
