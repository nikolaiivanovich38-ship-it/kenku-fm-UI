/**
 * Rooms and buses (PLY-5, OUT-5): one mix per Discord room, plus a preview bus
 * that never reaches a room. The engine plays a voice into
 * `getRoomBus(roomId, lane)`; the host sends each `output(roomId)` to that
 * room's bot. See docs/ARCHITECTURE.md, "Wave 2: Rooms and buses".
 */
export { PREVIEW_ID, ROOM_LANES, RoomMixer, TABLE_ROOM } from "./roomMixer";
export type { RoomFaderId, RoomFaderState, RoomLevels, RoomsContract } from "./roomMixer";
export { roomsAudioFrom } from "./roomsAudio";
export { createBridgedPreviewOutput, PlayerAudioLink, RoomStreams, SINK_ANSWER_TIMEOUT_MS } from "./roomStreams";
export type { BridgedPreviewOutput, FrameChannelFactory, FrameTap, FrameTapFactory, TapFrame } from "./roomStreams";
// The real-browser parts (worklet taps, the sink-less preview context, the
// channel's arrival) are in ./browserBridge, imported directly by the host:
// they load a worklet file that only the packaged page can run.
