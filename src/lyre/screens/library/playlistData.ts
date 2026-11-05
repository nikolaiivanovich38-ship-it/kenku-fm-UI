/**
 * What the Playlists screens read: every playlist with its tracks in playing order (a dynamic one's matches), where
 * each is used, and the words for those places. Worked out here from the lists the screens already have, with the
 * shared rules in src/common/domain, so a dynamic playlist's matches follow tag changes at once.
 */
import { useMemo } from "react";
import { playlistTracks, usesOfPlaylist, type Use } from "../../../common/domain";
import type { CampaignInfo, LibraryTrack, PlaylistInfo, TagGroup } from "../../../common/lyre/api";
import { lookupFrom } from "../../../common/lyre/lookup";
import { useCampaigns, usePlaylists, useProfileOverrides, useTagGroups } from "../../api";
import { useTrackList } from "./trackStore";

/** A use with the names the screens show (the prototype's L.usesOfPlaylist labels). */
export interface NamedUse {
  use: Use;
  campaign: CampaignInfo;
  sessionNumber: number;
  sessionName: string;
  sceneName: string;
  /** "Crown of Ash (whole campaign)", "Crown of Ash › Session 14", "Crown of Ash › Session 14 › The abbey ruins". */
  label: string;
  /** For a scene: how many items its music list has. */
  sceneItems: number;
}

export function nameUses(uses: Use[], campaigns: CampaignInfo[]): NamedUse[] {
  return uses.flatMap((use): NamedUse[] => {
    const campaign = campaigns.find((c) => c.id === use.campaignId);
    if (!campaign) return [];
    if (use.level === "campaign") return [{ use, campaign, sessionNumber: 0, sessionName: "", sceneName: "", label: `${campaign.name} (whole campaign)`, sceneItems: 0 }];
    const session = campaign.sessions.find((s) => s.id === use.sessionId);
    if (!session) return [];
    const base = `${campaign.name} › Session ${session.number}`;
    if (use.level === "session") return [{ use, campaign, sessionNumber: session.number, sessionName: session.name, sceneName: "", label: base, sceneItems: 0 }];
    const scene = session.scenes.find((s) => s.id === use.sceneId);
    if (!scene) return [];
    return [{ use, campaign, sessionNumber: session.number, sessionName: session.name, sceneName: scene.name, label: `${base} › ${scene.name}`, sceneItems: scene.music.length }];
  });
}

/** Where a list of uses is, counted: "1 scene, 2 sessions". */
export function usedText(uses: Use[]): string {
  const n = { scene: 0, session: 0, campaign: 0 };
  for (const u of uses) n[u.level]++;
  return (["scene", "session", "campaign"] as const)
    .filter((k) => n[k])
    .map((k) => `${n[k]} ${k}${n[k] === 1 ? "" : "s"}`)
    .join(", ");
}

export interface PlaylistData {
  ready: boolean;
  tracks: LibraryTrack[];
  byId: ReadonlyMap<string, LibraryTrack>;
  playlists: PlaylistInfo[];
  campaigns: CampaignInfo[];
  groups: TagGroup[];
  groupNames: Record<string, string>;
  overrides: ReturnType<typeof useProfileOverrides>["data"] & object;
  /** A playlist's tracks in playing order. */
  tracksOf: (pl: PlaylistInfo) => LibraryTrack[];
  usesOf: (id: string) => Use[];
  store: ReturnType<typeof useTrackList>["store"];
}

export function usePlaylistData(): PlaylistData {
  const { tracks, byId, store } = useTrackList();
  const playlistsQuery = usePlaylists();
  const campaigns = useCampaigns().data;
  const groups = useTagGroups().data;
  const overrides = useProfileOverrides().data;
  const playlists = playlistsQuery.data;
  return useMemo(() => {
    const all = tracks ?? [];
    const lists = playlists ?? [];
    const lookup = lookupFrom(all, lists);
    const cache = new Map<string, LibraryTrack[]>();
    const tracksOf = (pl: PlaylistInfo) => {
      let found = cache.get(pl.id);
      if (!found) {
        found = playlistTracks(pl, lookup) as LibraryTrack[];
        cache.set(pl.id, found);
      }
      return found;
    };
    const camps = campaigns ?? [];
    const uses = new Map<string, Use[]>();
    const usesOf = (id: string) => {
      let found = uses.get(id);
      if (!found) {
        found = usesOfPlaylist(id, camps);
        uses.set(id, found);
      }
      return found;
    };
    return {
      ready: tracks !== undefined && playlists !== undefined,
      tracks: all,
      byId,
      playlists: lists,
      campaigns: camps,
      groups: groups ?? [],
      groupNames: Object.fromEntries((groups ?? []).map((g) => [g.id, g.name])),
      overrides: overrides ?? {},
      tracksOf,
      usesOf,
      store,
    };
  }, [tracks, byId, playlists, campaigns, groups, overrides, store]);
}
