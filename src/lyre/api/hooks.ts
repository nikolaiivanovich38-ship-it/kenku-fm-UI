/**
 * The reads the wave 3 screens make, each with the areas that make it stale. A playlist's tracks, for example,
 * change when the playlist changes and when tracks are tagged (a dynamic playlist follows tags).
 */
import { useEffect, useRef } from "react";

import type { LyreEvent, SearchRequest, UsableRef } from "../../common/lyre/api";
import { useLyreApi } from "./LyreApiProvider";
import { useLyreQuery } from "./useLyreQuery";

export const useTracks = () => useLyreQuery("tracks", (api) => api.library.listTracks(), ["tracks"]);
export const useSearch = (request: SearchRequest) => useLyreQuery(`search:${JSON.stringify(request)}`, (api) => api.library.search(request), ["tracks"]);
export const useFolders = () => useLyreQuery("folders", (api) => api.library.listFolders(), ["folders"]);
export const useTagGroups = () => useLyreQuery("tag-groups", (api) => api.tags.listGroups(), ["tags"]);

export const usePlaylists = () => useLyreQuery("playlists", (api) => api.playlists.list(), ["playlists"]);
export const usePlaylistTracks = (id: string) => useLyreQuery(`playlist-tracks:${id}`, (api) => api.playlists.tracks(id), ["playlists", "tracks"]);
export const usePlaylistsContaining = (trackId: string) => useLyreQuery(`playlists-containing:${trackId}`, (api) => api.playlists.containing(trackId), ["playlists", "tracks"]);

export const useBoards = () => useLyreQuery("boards", (api) => api.boards.list(), ["boards"]);

export const useCampaigns = () => useLyreQuery("campaigns", (api) => api.campaigns.list(), ["campaigns"]);
export const useCampaign = (id: string) => useLyreQuery(`campaign:${id}`, (api) => api.campaigns.get(id), ["campaigns"]);
/** Deleting a playlist or board changes campaigns too, so "campaigns" covers every change to uses. */
export const useUsesOf = (ref: UsableRef) => useLyreQuery(`uses:${ref.kind}:${ref.id}`, (api) => api.campaigns.usesOf(ref), ["campaigns"]);

export const useProfileOverrides = () => useLyreQuery("profile-overrides", (api) => api.profiles.overrides(), ["profiles"]);
export const useMissingTracks = () => useLyreQuery("missing-tracks", (api) => api.import.findMissing(), ["tracks"]);
export const useHistory = () => useLyreQuery("history", (api) => api.history.state(), ["history"]);

/** Every event from the API, for screens that show import progress or files arriving in a watched folder. */
export function useLyreEvent(listener: (event: LyreEvent) => void): void {
  const api = useLyreApi();
  const listenerRef = useRef(listener);
  listenerRef.current = listener;
  useEffect(() => api.subscribe((event) => listenerRef.current(event)), [api]);
}
