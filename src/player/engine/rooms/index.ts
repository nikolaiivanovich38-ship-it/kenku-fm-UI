/**
 * Rooms and buses (PLY-5, OUT-5): one mix per Discord room, plus a preview bus
 * that never reaches a room. The engine plays a voice into
 * `getRoomBus(roomId, lane)`; the host sends each `output(roomId)` to that
 * room's bot. See docs/ARCHITECTURE.md, "Wave 2: Rooms and buses".
 */
export { PREVIEW_ID, ROOM_LANES, RoomMixer, TABLE_ROOM } from "./roomMixer";
export type { RoomFaderId, RoomFaderState, RoomLevels, RoomsContract } from "./roomMixer";
