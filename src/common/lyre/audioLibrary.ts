/**
 * What the audio host (src/lyre/audio, stream w3-host) reads from the library while it plays: `LyreAudioLibrary` in
 * src/lyre/audio/lyreAudio.ts. That file is not on this branch yet, so the type is restated here, field for field;
 * the host's own type stays the one to implement, and src/lyre/api/librarySnapshot.ts satisfies both.
 * Every call answers at once: the engine reads the library while it plays.
 */
import type { DomainLookup, DomainScene, DomainTrack, PadMode, ProfileOverrides } from "../domain";

/** A scene by its place in a campaign (player/engine/queue/library.ts SceneRef). */
export interface AudioSceneRef {
  campaignId: string;
  sessionId: string;
  sceneId: string;
}

/** Where a track's audio is (the parts of player/engine/sources/sourceLoader.ts MediaRequest the library knows). */
export interface AudioMediaRequest {
  /** file://, https://, blob:… */
  url: string;
  trackId?: string;
  sizeBytes?: number;
}

/** A pad as the host plays it (player/engine/queue/library.ts PadSound, plus its label: LyrePad). */
export interface AudioPad {
  trackIds: string[];
  order: "random" | "roundrobin";
  mode: PadMode;
  /** Fade when a toggle or hold pad is let go, in milliseconds. */
  fadeMs: number;
  /** 0 to 1. */
  volume: number;
  label: string;
}

export interface LyreAudioLibrary extends DomainLookup {
  scene(ref: AudioSceneRef): DomainScene | undefined;
  /** Audio profiles keyed by placeKey, then track id. */
  profileOverrides(): ProfileOverrides;
  /** Where a track's audio is; null when its file is not known. */
  media(track: DomainTrack): AudioMediaRequest | null;
  pad(boardId: string, padId: string): AudioPad | undefined;
}
