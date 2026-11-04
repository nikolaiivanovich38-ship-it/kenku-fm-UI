/**
 * The playback engine (WP4). Not yet used by the player's interface; WP5
 * connects it. Overview and design: docs/playback-engine.md.
 */
export { PlaybackEngine } from "./engine";
export type { PlayRequest, VoiceProgress } from "./engine";
export { createBrowserEngine } from "./browser";
export type { BrowserEngine } from "./browser";
export { BUS_IDS, OUTPUT_IDS, TABLE_BUSES } from "./graph/mixer";
export type { BusId, FaderId, FaderState, MixerLevels, OutputId } from "./graph/mixer";
export { Voice } from "./voice/voice";
export type { VoiceOptions, VoiceState } from "./voice/voice";
export { directResolver, DEFAULT_SOURCE_POLICY } from "./sources/sourceLoader";
export type { MediaRequest, MediaResolver, ResolvedMedia, SourcePolicy } from "./sources/sourceLoader";
export * as queue from "./queue/queue";
export { QueuePlayer } from "./queue/queuePlayer";
export type { QueueTrack } from "./queue/queuePlayer";
export type { QueueEntry, QueueState, RepeatMode, NavigationOutcome } from "./queue/queue";

// Wave 2: the show engine. Scenes in order, audio profiles, the Now Playing
// queue and Undo, cue actions sent to rooms (PLY-10, PLY-12, PLY-1, PLY-8, PLY-4).
export { Director } from "./queue/director";
export { isCueAction, DEFAULT_FADES } from "./queue/actions";
export type { CueAction, CueActionType, CueOutcome, TrackFrom } from "./queue/actions";
export { staticLibrary, PAD_MODES } from "./queue/library";
export type { PadMode, PadSound, SceneRef, ShowData, ShowLibrary } from "./queue/library";
export type { Origin, Playing } from "./queue/nowPlaying";
export type { PlayingReport, RoomReport } from "./queue/roomPlayer";
export { ROOM_LANES, TABLE_ROOM_ID, tableOnlyRooms } from "./rooms.contract";
export type { RoomLane, RoomsAudio } from "./rooms.contract";
export { trackProfile, laneProfile } from "./profile/trackProfile";
