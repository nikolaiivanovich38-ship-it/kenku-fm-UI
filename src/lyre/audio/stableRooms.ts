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
 * When the last bot leaves, the mixer keeps the first room's mix as the table
 * (w51-fix2), so the table takes that room's Director id and what it played
 * goes on, unheard, until a bot joins again and takes it over. A room that
 * joins later beside it never reuses an id the Director already knows
 * ("bot-b~3", …). Targets still say "table" for the first room: `roomsFor`
 * sends an unknown room to the first one.
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
    // A room listed under its own id is that room, even when the table took that id while no bot was in a room
    // (w51-fix2: the first bot was in a room before this existed, left, and came back).
    if (this.real.some((room) => room.botId === engineId)) {
      return engineId;
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
    const engineIds = new Map(before.map((room) => [room.botId, this.toEngine(room.botId)]));
    if (before.length > 0 && rooms.length === 0) {
      // The mixer keeps the first room's mix as the table (w51-fix2): the Director keeps its player under that id.
      this.tableId = engineIds.get(before[0].botId)!;
    }
    const next = new Map<string, string>();
    if (before.length === 0 && rooms.length > 0) {
      // The mixer moved the table's mix to the first room.
      next.set(rooms[0].botId, this.tableId);
    }
    for (const room of rooms) {
      const kept = engineIds.get(room.botId);
      if (!next.has(room.botId) && kept !== undefined) next.set(room.botId, kept);
    }
    for (const room of rooms) {
      if (next.has(room.botId)) continue;
      // A new room has its own id, unless the Director knows that id as another room (the one that took the table).
      const used = new Set(next.values());
      let id = room.botId;
      while (used.has(id)) id = `${room.botId}~${++this.generation}`;
      next.set(room.botId, id);
    }
    this.aliases.clear();
    for (const [real, engine] of next) {
      if (real !== engine) this.aliases.set(real, engine);
    }
    this.real = rooms.map((room) => ({ ...room }));
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
