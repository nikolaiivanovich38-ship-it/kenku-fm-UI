/**
 * The reads the wave 3 screens make, each with the areas that make it stale. A playlist's tracks, for example,
 * change when the playlist changes and when tracks are tagged (a dynamic playlist follows tags).
 */
import { useEffect, useRef, useState } from "react";

import type { FolderKind, LyreEvent, SearchRequest, UsableRef } from "../../common/lyre/api";
import { useLyreApi } from "./LyreApiProvider";
import { useLyreQuery } from "./useLyreQuery";

export const useTracks = () => useLyreQuery("tracks", (api) => api.library.listTracks(), ["tracks"]);
export const useSearch = (request: SearchRequest) => useLyreQuery(`search:${JSON.stringify(request)}`, (api) => api.library.search(request), ["tracks"]);
export const useFolders = () => useLyreQuery("folders", (api) => api.library.listFolders(), ["folders"]);
export const useTagGroups = () => useLyreQuery("tag-groups", (api) => api.tags.listGroups(), ["tags"]);

export const usePlaylists = () => useLyreQuery("playlists", (api) => api.playlists.list(), ["playlists"]);
export const usePlaylistTracks = (id: string) => useLyreQuery(`playlist-tracks:${id}`, (api) => api.playlists.tracks(id), ["playlists", "tracks"]);
export const usePlaylistsContaining = (trackId: string) => useLyreQuery(`playlists-containing:${trackId}`, (api) => api.playlists.containing(trackId), ["playlists", "tracks"]);

/** ORG-13: each place's own track order of a playlist, by place key then playlist id. */
export const useTrackOrders = () => useLyreQuery("track-orders", (api) => api.playlists.trackOrders(), ["playlists"]);

/** ORG-4: the folders playlists or pad boards are kept in (a change to them sends "playlists" or "boards"). */
export const useOrgFolders = (kind: FolderKind) => useLyreQuery(`org-folders:${kind}`, (api) => api.folders.list(kind), [kind, "folders"]);

export const useBoards = () => useLyreQuery("boards", (api) => api.boards.list(), ["boards"]);

export const useCampaigns = () => useLyreQuery("campaigns", (api) => api.campaigns.list(), ["campaigns"]);
export const useCampaign = (id: string) => useLyreQuery(`campaign:${id}`, (api) => api.campaigns.get(id), ["campaigns"]);
/** Deleting a playlist or board changes campaigns too, so "campaigns" covers every change to uses. */
export const useUsesOf = (ref: UsableRef) => useLyreQuery(`uses:${ref.kind}:${ref.id}`, (api) => api.campaigns.usesOf(ref), ["campaigns"]);

export const useProfileOverrides = () => useLyreQuery("profile-overrides", (api) => api.profiles.overrides(), ["profiles"]);
export const useMissingTracks = () => useLyreQuery("missing-tracks", (api) => api.import.findMissing(), ["tracks"]);
/** Round 7: the crossfade, keys and this computer's settings (Look and feel › Display among them). */
export const useSettings = () => useLyreQuery("settings", (api) => api.settings.get(), ["settings"]);
export const useHistory = () => useLyreQuery("history", (api) => api.history.state(), ["history"]);

/** Every event from the API, for screens that show import progress or files arriving in a watched folder. */
export function useLyreEvent(listener: (event: LyreEvent) => void): void {
  const api = useLyreApi();
  const listenerRef = useRef(listener);
  listenerRef.current = listener;
  useEffect(() => api.subscribe((event) => listenerRef.current(event)), [api]);
}

/**
 * A track's loudness peaks for its wave (library.peaksOf): about 1,000 levels from 0 to 1 across the file, or null
 * until they are worked out (and for good when the file cannot be read). Null at once when the track changes, so a
 * screen never draws one track's wave for another. Asks again on a "peaks" change while it has none, on a "tracks"
 * change (a relinked file gets new peaks), and when the library is working again after a restart.
 */
export function useTrackPeaks(trackId: string | null): readonly number[] | null {
  const api = useLyreApi();
  const [answer, setAnswer] = useState<{ id: string | null; levels: number[] | null }>({ id: null, levels: null });
  const [version, setVersion] = useState(0);
  const levels = answer.id === trackId ? answer.levels : null;
  const haveLevels = useRef(false);
  haveLevels.current = levels !== null;

  useEffect(() => {
    if (trackId === null) return;
    let current = true;
    api.library.peaksOf(trackId).then(
      (next) => current && setAnswer({ id: trackId, levels: next }),
      // A fault (a lost connection): keep what is drawn; the next change event asks again.
      (): void => undefined,
    );
    return () => {
      current = false;
    };
  }, [api, trackId, version]);

  useEffect(
    () =>
      api.subscribe((event) => {
        const stale =
          (event.type === "changed" && (event.areas.includes("tracks") || (event.areas.includes("peaks") && !haveLevels.current))) ||
          (event.type === "library-status" && event.ok);
        if (stale) setVersion((v) => v + 1);
      }),
    [api],
  );

  return levels;
}

// --- w6-rooms ---
/** Round 7 settings (crossfade, keys, Next scene's guard, this computer's display, devices and global keys). */
export const useLyreSettings = () => useLyreQuery("settings", (api) => api.settings.get(), ["settings"]);
