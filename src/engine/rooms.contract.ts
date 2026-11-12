/**
 * PLY-8, OUT-5: the one thing the show engine (queue/director.ts) needs from
 * the "Rooms" stream: which rooms exist and where each room's music, ambience
 * and effects go. Every bot in a voice channel is a room, named after its
 * channel; the first room is the table, where scenes play.
 *
 * The Rooms stream implements this over its graph (src/engine/rooms);
 * the lead wires it in. Until then, and in the test hook, `tableOnlyRooms`
 * gives one room playing into the engine's own buses. Unit tests use a fake.
 */
import type { Room } from "../common/domain";
import type { NodeLike } from "./audio/types";
import type { Mixer } from "./graph/mixer";

/** The buses every room has. */
export const ROOM_LANES = ["music", "ambience", "effects"] as const;
export type RoomLane = (typeof ROOM_LANES)[number];

export interface RoomsAudio {
  /**
   * The rooms now, in the order the interface shows them; the first is where
   * scenes play. Empty only when nothing can be heard anywhere.
   */
  rooms(): readonly Room[];
  /** Where a voice for `lane` in room `roomId` connects. Asked once per voice, when it starts. */
  getRoomBus(roomId: string, lane: RoomLane): NodeLike;
  /** Hear about rooms coming and going. A room that has gone stops its sound. Returns an unsubscribe. */
  onRoomsChanged(listener: () => void): () => void;
}

/** The id of the one room `tableOnlyRooms` has. */
export const TABLE_ROOM_ID = "table";

/** One room, the table, playing into the mixer's music, ambience and effects buses. */
export function tableOnlyRooms(mixer: Pick<Mixer, "input">): RoomsAudio {
  const rooms: readonly Room[] = [{ botId: TABLE_ROOM_ID, name: "Table" }];
  return {
    rooms: () => rooms,
    getRoomBus: (_roomId, lane) => mixer.input(lane),
    onRoomsChanged: () => () => undefined,
  };
}
