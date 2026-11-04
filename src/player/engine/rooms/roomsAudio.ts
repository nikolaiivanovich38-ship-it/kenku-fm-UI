/**
 * Connects the Rooms stream's mixer (RoomMixer, lanes music/amb/fx) to what the show engine expects
 * (rooms.contract.ts RoomsAudio, lanes music/ambience/effects). While no bot is in a voice channel the
 * mixer has no rooms but still plays on the table, so the engine sees one room, the table, and scenes
 * always have somewhere to play.
 */
import type { Lane, Room } from "../../../common/domain";
import type { NodeLike } from "../audio/types";
import type { RoomLane, RoomsAudio } from "../rooms.contract";
import { RoomMixer, TABLE_ROOM } from "./roomMixer";

const LANE: Record<RoomLane, Lane> = { music: "music", ambience: "amb", effects: "fx" };
const TABLE_ONLY: readonly Room[] = [{ botId: TABLE_ROOM, name: "Table" }];

export function roomsAudioFrom(mixer: RoomMixer): RoomsAudio {
  return {
    rooms: () => {
      const rooms = mixer.rooms();
      return rooms.length ? rooms : TABLE_ONLY;
    },
    getRoomBus: (roomId, lane) => mixer.getRoomBus(roomId, LANE[lane]) as unknown as NodeLike,
    onRoomsChanged: (listener) => {
      const handler = () => listener();
      mixer.on("rooms", handler);
      return () => {
        mixer.off("rooms", handler);
      };
    },
  };
}
