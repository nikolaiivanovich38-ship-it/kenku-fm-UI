/**
 * Manual playlists: ordered entries pointing at library tracks, with dividers.
 * A track can be in any number of playlists; deleting a playlist or an entry
 * never deletes a track (DAT-1).
 */
import type { Store } from "../store";
import type { Placement, Playlist, PlaylistItem } from "../types";
import * as v from "../validate";
import { containerRepo, type ItemRow } from "./containers";

const repo = containerRepo({
  entity: "playlist",
  table: "playlists",
  itemsTable: "playlist_items",
  parentColumn: "playlist_id",
  entryKind: "track",
  folderScope: "playlists",
  campaignTable: "campaign_playlists",
});

function toItem(row: ItemRow): PlaylistItem {
  const base = { id: row.id, playlistId: row.playlist_id as string, position: row.position };
  return row.kind === "track"
    ? { ...base, kind: "track", trackId: row.track_id as string, title: row.title as string }
    : { ...base, kind: "divider", label: row.label };
}

export const createPlaylist = repo.create;
export const getPlaylist = repo.get;
export const listPlaylists = repo.list;
export const updatePlaylist = repo.update;
export const movePlaylist = repo.move;
/** Deletes the playlist and its entries; its tracks stay in the library. */
export const deletePlaylist = repo.remove;

export function listPlaylistItems(store: Store, playlistId: string): PlaylistItem[] {
  return repo.listItemRows(store, playlistId).map(toItem);
}

/** Adds library tracks to a playlist as one step, in the order given. */
export function addTracksToPlaylist(
  store: Store,
  playlistId: string,
  trackIds: string[],
  placement: Placement = "end",
): PlaylistItem[] {
  const entries = v.ids("trackIds", trackIds).map((trackId) => ({ trackId }));
  return repo.addEntries(store, playlistId, entries, placement).map(toItem);
}

export function addPlaylistDivider(store: Store, playlistId: string, label: string, placement: Placement = "end"): PlaylistItem {
  return toItem(repo.addDivider(store, playlistId, label, placement));
}

export const renamePlaylistDivider = repo.renameDivider;
export const movePlaylistItems = repo.moveItems;
export const removePlaylistItems = repo.removeItems;

export type { Playlist };
