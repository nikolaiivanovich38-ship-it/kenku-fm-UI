/**
 * What the show engine (director.ts) needs to know about the game master's
 * library, as one small interface the host fills in: the database through
 * src/main/data in the app, plain data in tests and in the test hook.
 *
 * The domain contract (src/common/domain) has tracks, playlists and scenes,
 * but not where a track's file is nor what a pad plays; `media` and `pad`
 * cover those here until the contract has them.
 */
import type {
  DomainCampaign,
  DomainLookup,
  DomainPlaylist,
  DomainScene,
  DomainTrack,
  PlayOrderOverrides,
  ProfileOverrides,
} from "../../../common/domain";
import { DEFAULT_LIBRARY_NORMALISE, type LibraryNormalise } from "../../../common/domain";
import type { MediaRequest } from "../sources/sourceLoader";

/** A scene, named by where it lives. Also the key of its audio profile overrides. */
export interface SceneRef {
  campaignId: string;
  sessionId: string;
  sceneId: string;
}

/** How a pad plays (the prototype's Play mode). */
export { PAD_MODES } from "../../../common/domain/types";
import type { PadMode } from "../../../common/domain/types";
export type { PadMode };

/** What a pad plays: one sound, or variants picked at random or in turn. */
export interface PadSound {
  trackIds: string[];
  order: "random" | "roundrobin";
  mode: PadMode;
  /** Fade when a toggle or hold pad is let go, in milliseconds. */
  fadeMs: number;
  /** 0 to 1. */
  volume: number;
}

export interface ShowLibrary extends DomainLookup {
  scene(ref: SceneRef): DomainScene | undefined;
  /** Per-playlist and per-scene audio profiles. */
  profileOverrides(): ProfileOverrides;
  /** Where a track's audio is; null when the file is not known. */
  media(track: DomainTrack): MediaRequest | null;
  pad(boardId: string, padId: string): PadSound | undefined;
  /** PLY-13: play order chosen in places, by place key then playlist id; none: every playlist plays its own order. */
  playOrders?(): PlayOrderOverrides;
  /** PLY-15: the library's Normalise volume setting; none: off (every track plays as it is unless it says On). */
  normaliseSettings?(): LibraryNormalise;
}

/** A library as plain data, for tests and the test hook. */
export interface ShowData {
  tracks: (DomainTrack & { url: string; sizeBytes?: number })[];
  playlists: DomainPlaylist[];
  campaigns: DomainCampaign[];
  profiles?: ProfileOverrides;
  pads?: (PadSound & { boardId: string; padId: string })[];
  playOrders?: PlayOrderOverrides;
  normalise?: LibraryNormalise;
}

/** Reads `data` on every call, so a test can change it while things play (e.g. delete a track). */
export function staticLibrary(data: ShowData): ShowLibrary {
  return {
    track: (id) => data.tracks.find((t) => t.id === id),
    playlist: (id) => data.playlists.find((p) => p.id === id),
    tracks: () => data.tracks,
    scene: (ref) =>
      data.campaigns
        .find((c) => c.id === ref.campaignId)
        ?.sessions.find((s) => s.id === ref.sessionId)
        ?.scenes.find((sc) => sc.id === ref.sceneId),
    profileOverrides: () => data.profiles ?? {},
    media: (track) => {
      const known = data.tracks.find((t) => t.id === track.id);
      return known ? { url: known.url, trackId: known.id, sizeBytes: known.sizeBytes } : null;
    },
    pad: (boardId, padId) => data.pads?.find((p) => p.boardId === boardId && p.padId === padId),
    playOrders: () => data.playOrders ?? {},
    normaliseSettings: () => data.normalise ?? DEFAULT_LIBRARY_NORMALISE,
  };
}

export function sameScene(a: SceneRef, b: SceneRef): boolean {
  return a.campaignId === b.campaignId && a.sessionId === b.sessionId && a.sceneId === b.sceneId;
}
