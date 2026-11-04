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
