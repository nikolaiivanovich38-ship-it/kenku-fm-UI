/**
 * Playlists (DAT-11). Every playlist has a lane: Music, Ambience or FX (what it
 * plays into). A manual playlist holds ordered entries pointing at library
 * tracks, with dividers; a track can be in any number of playlists, and
 * deleting a playlist or an entry never deletes a track (DAT-1). A dynamic
 * playlist holds a rule instead (rows: ruleRows.ts) and plays every track in
 * its lane that matches: playlistTracks in src/common/domain, or
 * listPlaylistTrackIds here, which gives the same answer from the database.
 */
import type { Lane, PlaylistRule } from "../../../common/domain";
import { cleanRule } from "../designValidate";
import { ValidationError } from "../errors";
import { GAP, assignPositions, positionFor, positionsFor, type OrderedList } from "../ordering";
import type { SQLInputValue } from "../sqlite";
import type { Store } from "../store";
import { LANES, PLAYLIST_KINDS, type Placement, type Playlist, type PlaylistItem, type PlaylistKind } from "../types";
import * as v from "../validate";
import { newId, patchOf, plural, requireRow } from "./common";
import { containerRepo } from "./containers";
import { dynamicTracksQuery, readRules, resolveRule, ruleColumns, writeConditions, type ResolvedRule } from "./ruleRows";

type PlaylistRow = Record<string, SQLInputValue> & {
  id: string;
  rule_energy_min: number | null;
  rule_energy_max: number | null;
  rule_leave_out_stings: number;
};

/** A row as a Playlist; a dynamic playlist's conditions are added by withRules. */
const toPlaylist = (row: Record<string, SQLInputValue>): Playlist => ({
  id: row.id as string,
  title: row.title as string,
  background: row.background as string,
  folderId: row.folder_id as string | null,
  position: row.position as number,
  kind: row.kind as PlaylistKind,
  lane: row.lane as Lane,
  rule: row.kind === "dynamic" ? { conds: [] } : null,
  notes: row.notes as string,
  createdAt: row.created_at as number,
  updatedAt: row.updated_at as number,
});

const repo = containerRepo({
  entity: "playlist",
  label: "playlist",
  table: "playlists",
  folderScope: "playlists",
  campaignTable: "campaign_playlists",
  memberColumn: "playlist_id",
  toRecord: toPlaylist,
});

/** Fills in the rules of the dynamic playlists among `playlists` (two queries for all of them). */
function withRules<T extends Playlist | null>(store: Store, playlists: T[]): T[] {
  const dynamic = playlists.filter((p): p is NonNullable<T> => p !== null && p.kind === "dynamic");
  if (dynamic.length === 0) return playlists;
  const settings = store.all<PlaylistRow>(
    "SELECT id, rule_energy_min, rule_energy_max, rule_leave_out_stings FROM playlists WHERE id IN (SELECT value FROM json_each(?))",
    JSON.stringify(dynamic.map((p) => p.id)),
  );
  const rules = readRules(store, settings);
  for (const p of dynamic) p.rule = rules.get(p.id) ?? { conds: [] };
  return playlists;
}

/** A checked rule with its tag names resolved to tags. */
const checkedRule = (store: Store, value: unknown): ResolvedRule => resolveRule(store, cleanRule("rule", value));

export type PlaylistInput = {
  id?: string;
  title: string;
  kind?: PlaylistKind;
  lane?: Lane;
  /** Required for a dynamic playlist; not allowed for a manual one. Tags by name, as in src/common/domain. */
  rule?: PlaylistRule;
  notes?: string;
  background?: string;
  folderId?: string | null;
  placement?: Placement;
};

export function getPlaylist(store: Store, id: string): Playlist | null {
  return withRules(store, [repo.get(store, id)])[0];
}

/** Lists in order: every playlist, one folder's, or one campaign's (see containerRepo.list). */
export function listPlaylists(store: Store, options: { folderId?: string | null; campaignId?: string } = {}): Playlist[] {
  return withRules(store, repo.list(store, options));
}

export function createPlaylist(store: Store, input: PlaylistInput): Playlist {
  const record = v.record("playlist", input);
  const kind = v.oneOf("kind", record.kind ?? "manual", PLAYLIST_KINDS);
  if (kind === "dynamic" && record.rule === undefined) {
    throw new ValidationError("rule", "A dynamic playlist needs a rule saying which tracks it plays.");
  }
  if (kind === "manual" && record.rule !== undefined) {
    throw new ValidationError("rule", "A manual playlist has no rule: its tracks are picked by hand.");
  }
  const rule = kind === "dynamic" ? checkedRule(store, record.rule) : null;
  const created = repo.create(
    store,
    input,
    {
      kind,
      lane: v.oneOf("lane", record.lane ?? "music", LANES),
      notes: v.optionalText("notes", record.notes),
      ...ruleColumns(rule),
    },
    { after: (id) => rule && writeConditions(store, id, rule) },
  );
  return getPlaylist(store, created.id) as Playlist;
}

/** Changes the title, background, lane, notes, or (dynamic playlists) the rule. */
export function updatePlaylist(
  store: Store,
  id: string,
  changes: { title?: string; background?: string; lane?: Lane; rule?: PlaylistRule; notes?: string },
): Playlist {
  const patch = patchOf(changes, ["title", "background", "lane", "rule", "notes"]);
  const playlist = repo.get(store, repo.requireContainer(store, id)) as Playlist;
  const columns = repo.titleColumns(patch);
  if (patch.lane !== undefined) columns.lane = v.oneOf("lane", patch.lane, LANES);
  if (patch.notes !== undefined) columns.notes = v.optionalText("notes", patch.notes);
  let rule: ResolvedRule | null = null;
  if (patch.rule !== undefined) {
    if (playlist.kind !== "dynamic") throw new ValidationError("rule", "A manual playlist has no rule: its tracks are picked by hand.");
    rule = checkedRule(store, patch.rule);
    Object.assign(columns, ruleColumns(rule));
  }
  repo.applyUpdate(store, playlist.id, columns, "Edit playlist", () => rule && writeConditions(store, playlist.id, rule));
  return getPlaylist(store, playlist.id) as Playlist;
}

export const movePlaylist = repo.move;
/** Deletes the playlist with its entries or rule; its tracks stay in the library. */
export const deletePlaylist = repo.remove;

/**
 * The tracks a playlist plays, in order: a manual playlist's entries (missing
 * tracks cannot occur: entries go with their track), or what a dynamic
 * playlist's rule matches now, in library order. Same answer as playlistTracks
 * in src/common/domain, worked out in the database.
 */
export function listPlaylistTrackIds(store: Store, playlistId: string): string[] {
  const id = repo.requireContainer(store, playlistId);
  const query = dynamicTracksQuery(store, id);
  if (query) return store.all<{ id: string }>(query.sql, ...query.params).map((row) => row.id);
  return store
    .all<{ track_id: string }>("SELECT track_id FROM playlist_items WHERE playlist_id = ? AND kind = 'track' ORDER BY position", id)
    .map((row) => row.track_id);
}

/**
 * Copies a playlist next to the original (prototype: "Make a copy", "Save as a
 * fixed list"). A dynamic playlist copied as manual holds the tracks its rule
 * matches now, in their order; a manual one cannot become dynamic (it has no rule).
 */
export function copyPlaylist(store: Store, id: string, options: { title?: string; kind?: PlaylistKind } = {}): Playlist {
  const source = getPlaylist(store, repo.requireContainer(store, id)) as Playlist;
  const kind = v.oneOf("kind", options.kind ?? source.kind, PLAYLIST_KINDS);
  const title = options.title === undefined ? `${source.title} (copy)` : options.title;
  if (kind === "dynamic" && source.kind === "manual") {
    throw new ValidationError("kind", "A manual playlist has no rule to copy; make a new dynamic playlist instead.");
  }
  const rule = kind === "dynamic" ? resolveRule(store, source.rule as PlaylistRule) : null;
  const entries: { trackId: string | null; label: string }[] =
    kind === "dynamic"
      ? []
      : source.kind === "manual"
        ? listPlaylistItems(store, source.id).map((item) =>
            item.kind === "track" ? { trackId: item.trackId, label: "" } : { trackId: null, label: item.label },
          )
        : listPlaylistTrackIds(store, source.id).map((trackId) => ({ trackId, label: "" }));
  const copy = repo.create(
    store,
    { title, background: source.background },
    { kind, lane: source.lane, notes: source.notes, ...ruleColumns(rule) },
    {
      placeAfter: source.id,
      after: (copyId) => {
        if (rule) writeConditions(store, copyId, rule);
        entries.forEach((entry, index) =>
          store.run(
            "INSERT INTO playlist_items (id, playlist_id, kind, track_id, label, position) VALUES (?, ?, ?, ?, ?, ?)",
            newId(),
            copyId,
            entry.trackId === null ? "divider" : "track",
            entry.trackId,
            entry.label,
            (index + 1) * GAP,
          ),
        );
      },
    },
  );
  return getPlaylist(store, copy.id) as Playlist;
}

// --- Entries of manual playlists ---

/** An entry row with its track's shown title joined in. */
type ItemRow = {
  id: string;
  playlist_id: string;
  kind: string;
  track_id: string | null;
  label: string;
  position: number;
  title: string | null;
};

const ITEM_SELECT = `SELECT i.*, coalesce(nullif(t.title, ''), nullif(t.meta_title, ''), t.file_name) AS title
  FROM playlist_items i LEFT JOIN tracks t ON t.id = i.track_id`;

/** A manual playlist's entries in order, with track titles (playlist_items_order). Exported for the query-plan tests. */
export const PLAYLIST_ITEMS_SQL = `${ITEM_SELECT} WHERE i.playlist_id = ? ORDER BY i.position`;

function toItem(row: ItemRow): PlaylistItem {
  const base = { id: row.id, playlistId: row.playlist_id, position: row.position };
  return row.kind === "track"
    ? { ...base, kind: "track", trackId: row.track_id as string, title: row.title as string }
    : { ...base, kind: "divider", label: row.label };
}

const itemsOf = (playlistId: string): OrderedList => ({ table: "playlist_items", scope: "playlist_id = ?", params: [playlistId] });
const itemRow = (store: Store, id: string) => store.get<ItemRow>(`${ITEM_SELECT} WHERE i.id = ?`, id) as ItemRow;

/** Throws unless the playlist exists and is manual (a dynamic one chooses its own tracks). */
function requireManual(store: Store, id: unknown): string {
  const playlist = repo.get(store, repo.requireContainer(store, id)) as Playlist;
  if (playlist.kind !== "manual") {
    throw new ValidationError("playlistId", "This is a dynamic playlist: it chooses its own tracks by its rule.");
  }
  return playlist.id;
}

function requireItem(store: Store, itemId: unknown): ItemRow {
  return itemRow(store, requireRow(store, "playlist_items", "playlist entry", itemId));
}

export function listPlaylistItems(store: Store, playlistId: string): PlaylistItem[] {
  repo.requireContainer(store, playlistId);
  return store.all<ItemRow>(PLAYLIST_ITEMS_SQL, playlistId).map(toItem);
}

/** Adds library tracks to a manual playlist as one step, in the order given. */
export function addTracksToPlaylist(store: Store, playlistId: string, trackIds: string[], placement: Placement = "end"): PlaylistItem[] {
  const ids = v.ids("trackIds", trackIds);
  const containerId = requireManual(store, playlistId);
  const tracks = ids.map((id) => requireRow(store, "tracks", "track", id));
  const itemIds = tracks.map(() => newId());
  store.change(`Add ${plural(tracks.length, "track")} to playlist`, () => {
    const positions = positionsFor(store, itemsOf(containerId), placement, tracks.length);
    tracks.forEach((trackId, index) =>
      store.run(
        "INSERT INTO playlist_items (id, playlist_id, kind, track_id, position) VALUES (?, ?, 'track', ?, ?)",
        itemIds[index],
        containerId,
        trackId,
        positions[index],
      ),
    );
    repo.touch(store, containerId);
  });
  return itemIds.map((id) => toItem(itemRow(store, id)));
}

export function addPlaylistDivider(store: Store, playlistId: string, label: string, placement: Placement = "end"): PlaylistItem {
  const containerId = requireManual(store, playlistId);
  const text = v.optionalText("label", label, v.MAX_NAME_LENGTH);
  const id = newId();
  store.change("Add divider to playlist", () => {
    store.run(
      "INSERT INTO playlist_items (id, playlist_id, kind, label, position) VALUES (?, ?, 'divider', ?, ?)",
      id,
      containerId,
      text,
      positionFor(store, itemsOf(containerId), placement),
    );
    repo.touch(store, containerId);
  });
  return toItem(itemRow(store, id));
}

export function renamePlaylistDivider(store: Store, itemId: string, label: string): void {
  const item = requireItem(store, itemId);
  if (item.kind !== "divider") throw new ValidationError("itemId", "That entry is not a divider.");
  const text = v.optionalText("label", label, v.MAX_NAME_LENGTH);
  store.change("Rename divider", () => {
    store.run("UPDATE playlist_items SET label = ? WHERE id = ?", text, item.id);
    repo.touch(store, item.playlist_id);
  });
}

/** Moves the selected entries together to `placement`, keeping their order. */
export function movePlaylistItems(store: Store, itemIds: string[], placement: Placement): void {
  const items = v.ids("itemIds", itemIds).map((id) => requireItem(store, id));
  if (items.length === 0) return;
  const parentId = items[0].playlist_id;
  if (items.some((item) => item.playlist_id !== parentId)) {
    throw new ValidationError("itemIds", "Entries from different playlists cannot be moved together.");
  }
  items.sort((a, b) => a.position - b.position);
  const moving = items.map((item) => item.id);
  store.change(`Move ${plural(items.length, "entry", "entries")}`, () => {
    const positions = positionsFor(store, itemsOf(parentId), placement, items.length, moving);
    assignPositions(store, itemsOf(parentId), moving, positions);
    repo.touch(store, parentId);
  });
}

/** Takes entries out of the playlist; their tracks stay in the library. */
export function removePlaylistItems(store: Store, itemIds: string[]): void {
  const items = v.ids("itemIds", itemIds).map((id) => requireItem(store, id));
  store.change(`Remove ${plural(items.length, "entry", "entries")} from playlist`, () => {
    for (const item of items) {
      store.run("DELETE FROM playlist_items WHERE id = ?", item.id);
      repo.touch(store, item.playlist_id);
    }
  });
}

export type { Playlist };
