/**
 * Sound for the new interface (wave 3). Screens use `useLyreAudio()` and
 * `useNowPlaying()` and never touch Web Audio; the page root starts it once
 * with `startLyreAudio`. See docs/ARCHITECTURE.md, "Wave 3: w3-host".
 */
export { DEFAULT_FADES_MS, EngineLyreAudio, FIRST_ROOM, POSITION_TICK_MS, ROOM_START_VOLUME, padIsOn, trackTitle } from "./lyreAudio";
export type {
  CueAction,
  CueOutcome,
  DeviceStatus,
  LaneNowPlaying,
  LyreAudio,
  LyreAudioEvents,
  LyreAudioLibrary,
  LyrePad,
  MusicOrAmbience,
  NowPlaying,
  OutputDeviceInfo,
  PlayOptions,
  PlayPositions,
  PreviewFrom,
  PreviewNowPlaying,
  PreviewPosition,
  PreviewTrackOptions,
  RoomLane,
  RoomNowPlaying,
  SceneRef,
  TrackFrom,
} from "./lyreAudio";
export { EMPTY_LIBRARY, startLyreAudio } from "./browserLyreAudio";
export { LyreAudioProvider, useLyreAudio, useLyreAudioEvent, useNowPlaying, useOptionalLyreAudio, usePlayPosition, usePreviewKey } from "./LyreAudioProvider";
// The preload half (createLyreAudioBridge) is imported by src/lyre/preload.ts
// directly from ./preloadAudio, so the preload bundle stays free of the engine.
export type { LyreAudioBridge } from "./preloadAudio";
