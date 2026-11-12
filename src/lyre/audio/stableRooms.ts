/**
 * The rooms as the show engine's Director sees them, over the room mixer.
 *
 * Why not `roomsAudioFrom(mixer)` directly: while no bot is in a voice channel
 * the mixer has one placeholder room, the table, and when the first bot joins
 * that mix becomes the bot's room and keeps playing (RoomMixer.setRooms). The
 * Director keeps one player per room id, so seeing "table" vanish and the bot
 * appear it would stop what the game master had started at the table. Here
 * the room that took over the table keeps the table's id for the Director for
 * as long as it stays, so the music goes on into Discord.
 *
 * When the last bot leaves, the mixer makes a fresh, silent table; it gets a
 * new id ("table~2", …) so the Director forgets the old one and stops its
 * voices, which played into a mix that is gone. Targets still say "table" for
 * the first room: `roomsFor` sends an unknown room to the first one.
 *
 * Ids facing the screens are always the real ones: a bot id, or "table".
 */
import type { Lane, Room, RoomTarget } from "../../common/domain";
import type { NodeLike } from "../../engine/audio/types";
import { TABLE_ROOM, type RoomMixer } from "../../engine/rooms";
import type { RoomLane, RoomsAudio } from "../../engine/rooms.contract";

const LANE: Record<RoomLane, Lane> = { music: "music", ambience: "amb", effects: "fx" };

export class StableRooms implements RoomsAudio {
  /** The Director's id for the placeholder table (and for the room that takes it over). */
  private tableId: string = TABLE_ROOM;
  private generation = 1;
  /** Real room id → the Director's id, for the room that took over the table. */
  private readonly aliases = new Map<string, string>();
  private real: Room[];
  private readonly listeners = new Set<() => void>();
  private readonly stop: () => void;

  constructor(private readonly mixer: RoomMixer) {
    this.real = mixer.rooms();
    const onRooms = (rooms: Room[]) => this.update(rooms);
    mixer.on("rooms", onRooms);
    this.stop = () => mixer.off("rooms", onRooms);
  }

  rooms(): readonly Room[] {
    if (this.real.length === 0) {
      return [{ botId: this.tableId, name: "Table" }];
    }
    return this.real.map((room) => ({ botId: this.toEngine(room.botId), name: room.name }));
  }

  getRoomBus(roomId: string, lane: RoomLane): NodeLike {
    return this.mixer.getRoomBus(this.toReal(roomId), LANE[lane]) as unknown as NodeLike;
  }

  onRoomsChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A screen's target in the Director's ids. */
  target(target: RoomTarget): RoomTarget {
    if (target === "all") {
      return target;
    }
    // "table" always means the first room, whatever id the Director knows it by.
    return { room: target.room === TABLE_ROOM ? this.rooms()[0].botId : this.toEngine(target.room) };
  }

  /** A Director room id as the screens know it: a bot id, or "table" while no bot is in a voice channel. */
  toReal(engineId: string): string {
    for (const [real, alias] of this.aliases) {
      if (alias === engineId) {
        return real;
      }
    }
    return engineId === this.tableId ? TABLE_ROOM : engineId;
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  private toEngine(realId: string): string {
    return this.aliases.get(realId) ?? realId;
  }

  private update(rooms: Room[]) {
    const before = this.real;
    if (before.length === 0 && rooms.length > 0) {
      // The mixer moved the table's mix to the first room.
      this.aliases.set(rooms[0].botId, this.tableId);
    }
    for (const real of [...this.aliases.keys()]) {
      if (!rooms.some((room) => room.botId === real)) {
        this.aliases.delete(real);
      }
    }
    if (before.length > 0 && rooms.length === 0) {
      // A fresh table: a new id, so the Director lets go of the old one.
      this.tableId = `${TABLE_ROOM}~${++this.generation}`;
    }
    this.real = rooms.map((room) => ({ ...room }));
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
