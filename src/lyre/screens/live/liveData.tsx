/**
 * What every part of the Live screen reads: the library (one index), the loaded session and the scene on now, the
 * rooms with their To: choices, the names in scenes, the keys and the audio host. One context, filled once per render
 * of the screen, so the boxes stay small.
 */
import React, { createContext, useContext } from "react";

import {
  playlistTracks,
  profilePlacesFor,
  resolveProfile,
  tracksInOrder,
  type DomainScene,
  type LibraryNormalise,
  type PlayOrder,
  type ProfileOverrides,
  type RoomTarget,
  type SequenceStep,
  type TrackNames,
  type UsePlace,
} from "../../../common/domain";
import type { CampaignInfo, LibraryTrack, SceneInfo, SessionInfo, TagGroup } from "../../../common/lyre/api";
import type { LyreOutputs } from "../../../common/lyreOutputs";
import type { LaneNowPlaying, LyreAudio, NowPlaying } from "../../audio/lyreAudio";
import type { PlayOrderData } from "../../kit/playOrders";
import { playOrderIn } from "../../kit/playOrders";
import type { OutputsClient } from "../../outputs/OutputsProvider";
import { sequenceOf } from "../../../player/engine/queue/nowPlaying";
import type { SceneRef, ShowLibrary } from "../../../player/engine/queue/library";
import type { LibraryIndex } from "../campaigns/model";
import { boxTarget, type LiveBox, type LiveKeys, type LiveRoom } from "./liveModel";
import type { LiveState } from "./liveState";

export interface LiveData {
  audio: LyreAudio;
  now: NowPlaying;
  index: LibraryIndex;
  campaigns: CampaignInfo[];
  campaign: CampaignInfo;
  session: SessionInfo;
  /** The scene on now; null on standby (Current scene says "No scene yet"). */
  scene: SceneInfo | null;
  sceneIndex: number;
  state: LiveState;
  rooms: LiveRoom[];
  outputs: LyreOutputs | null;
  client: OutputsClient | null;
  names: TrackNames;
  overrides: ProfileOverrides;
  orders: PlayOrderData | undefined;
  tagGroups: TagGroup[];
  keys1: boolean;
  /** UX-12: Live's keys as Settings › Keyboard shortcuts has them, and whether Next scene's guard is on. */
  keys: LiveKeys;
  guard: boolean;
  /** PLY-15: the library's Normalise volume setting, for the hover on a track on air. */
  normalise: LibraryNormalise;
}

const LiveContext = createContext<LiveData | null>(null);

export function LiveDataProvider({ value, children }: { value: LiveData; children: React.ReactNode }) {
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveData {
  const value = useContext(LiveContext);
  if (!value) throw new Error("useLive needs the Live screen around it");
  return value;
}

/** Where a box plays, and " in Side room" for its buttons' names when there are two or more rooms. */
export function useBoxTarget(box: LiveBox): { choice: string; targets: RoomTarget[]; name: string; inWhere: string } {
  const { rooms, state } = useLive();
  const t = boxTarget(rooms, state.to[box]);
  return { ...t, inWhere: rooms.length > 1 ? ` in ${t.name}` : "" };
}

/** A room's music (or ambience) target for the audio host. */
export function roomTarget(roomId: string): RoomTarget {
  return { room: roomId };
}

export function sceneRefOf(campaignId: string, sessionId: string, scene: { id: string }): SceneRef {
  return { campaignId, sessionId, sceneId: scene.id };
}

export function scenePlace(ref: SceneRef): UsePlace {
  return { kind: "scene", ...ref };
}

/** The library as the engine's sequence rules read it (play order, scenes), for Live's lists to agree with what plays. */
export function showLibraryOf(index: LibraryIndex, campaigns: readonly CampaignInfo[], overrides: ProfileOverrides, orders: PlayOrderData | undefined): ShowLibrary {
  return {
    ...index.lookup,
    scene: (ref) =>
      campaigns
        .find((c) => c.id === ref.campaignId)
        ?.sessions.find((s) => s.id === ref.sessionId)
        ?.scenes.find((sc) => sc.id === ref.sceneId) as DomainScene | undefined,
    profileOverrides: () => overrides,
    media: () => null,
    pad: () => undefined,
    playOrders: () => orders?.overrides ?? {},
  };
}

/** A scene's music steps; dealt with the seed of the music on air from it, so the lists show what plays. */
export function sceneSteps(lib: ShowLibrary, ref: SceneRef, seed: number | undefined): SequenceStep[] {
  return sequenceOf(seed === undefined ? { kind: "scene", scene: ref, at: 0 } : { kind: "scene", scene: ref, at: 0, seed }, lib);
}

/** The seed of the music in any room that plays from this scene, if one does. */
export function seedOfScene(now: NowPlaying, ref: SceneRef): number | undefined {
  for (const r of now.rooms) {
    const o = r.music?.origin;
    if (o?.kind === "scene" && sameRef(o.scene, ref)) return o.seed ?? 0;
  }
  return undefined;
}

export function sameRef(a: SceneRef, b: SceneRef): boolean {
  return a.campaignId === b.campaignId && a.sessionId === b.sessionId && a.sceneId === b.sceneId;
}

/** A playlist's tracks in the order they play in a place (its own order when shuffled but not on air). */
export function playlistInPlace(index: LibraryIndex, orders: PlayOrderData | undefined, playlistId: string, place: UsePlace | null, seed?: number): LibraryTrack[] {
  const p = index.playlist(playlistId);
  if (!p) return [];
  const tracks = playlistTracks(p, index.lookup) as LibraryTrack[];
  if (seed === undefined || !orders) return tracks;
  const order: PlayOrder = playOrderIn(orders, playlistId, place).order;
  return tracksInOrder(tracks, order, seed);
}

/** How long a track plays in a place: its audio profile there, End minus Start, in ms. */
export function playedMs(track: LibraryTrack, place: UsePlace | null, playlistId: string | null, overrides: ProfileOverrides): number {
  const { profile } = resolveProfile(track, profilePlacesFor(place, playlistId), overrides);
  return Math.max(0, profile.endMs - profile.startMs);
}

/** The lane's audio profile where it plays, for the end words. */
export function laneProfile(lane: LaneNowPlaying, index: LibraryIndex, overrides: ProfileOverrides) {
  const track = index.track(lane.trackId);
  return track ? resolveProfile(track, profilePlacesFor(lane.place, lane.playlistId), overrides) : null;
}
