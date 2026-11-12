/**
 * PLY-5, OUT-5: one mix per room.
 *
 * Every Discord bot in a voice channel is a room, named after its channel
 * (src/common/domain Room). Each room has its own music, ambience and effects
 * lanes summed into a room master with volume and mute:
 *
 *   room A:  music ─┐
 *            amb  ──┼─> master ─> output A    (encoded for bot A only)
 *            fx   ──┘
 *   room B:  music / amb / fx ─> master ─> output B
 *   preview ─────────────────────────────> preview output (the GM's headphones)
 *
 * While no bot is in a voice channel there is one room, the table
 * (`TABLE_ROOM`), so the game master can prepare and listen locally. When the
 * first bot joins, the table becomes that bot's room and keeps playing. "table"
 * always means the first room, and a room that has gone falls back to the first
 * room, as `roomsFor` does.
 *
 * Preview (PRV-1) has its own bus and output, made once and never connected to
 * a room: nothing this class does can join them, and no lane is the preview.
 * The class connects no output anywhere; the host chooses where each goes.
 */
import { TypedEmitter } from "tiny-typed-emitter";

import type { Lane, Room } from "../../common/domain";
import { EngineContext, GainLike, rampTo } from "../audio/types";

/** Where untargeted sound goes: the first room, or the table while there is none. */
export const TABLE_ROOM = "table";
/** Never a room id: kept for the preview so the two can never be confused. */
export const PREVIEW_ID = "preview";

export const ROOM_LANES: readonly Lane[] = ["music", "amb", "fx"];

export type RoomFaderId = Lane | "master";
export type RoomFaderState = { level: number; muted: boolean };
export type RoomLevels = Record<RoomFaderId, RoomFaderState>;

/**
 * The interface the engine uses to play into rooms (the "Engine" stream's
 * rooms contract; defined here until that contract lands, see the wave 2 report).
 */
export interface RoomsContract {
  /** Rooms now, first room first; empty while no bot is in a voice channel. */
  rooms(): Room[];
  /** Where a voice for `lane` in room `roomId` connects ("table" or an unknown room: the first room). */
  getRoomBus(roomId: string, lane: Lane): GainLike;
}

interface RoomMixerEvents {
  /** The list of rooms changed (a bot joined, left or moved). */
  rooms: (rooms: Room[]) => void;
  /** A room went away and its sound was cut; stop the voices that played in it. */
  "room-removed": (roomId: string) => void;
  /** A room's lane or master level changed. */
  levels: (roomId: string, levels: RoomLevels) => void;
}

/** Fader moves are smoothed this much so they do not click. */
const SMOOTHING_SECONDS = 0.02;

interface RoomMix {
  name: string;
  faders: Map<RoomFaderId, { node: GainLike; state: RoomFaderState }>;
  nodes: GainLike[];
}

export class RoomMixer extends TypedEmitter<RoomMixerEvents> implements RoomsContract {
  /** The preview bus and its output, apart from every room. */
  readonly preview: { readonly input: GainLike; readonly output: GainLike };
  /** Mixes by room id, first room first. Holds only `TABLE_ROOM` while there are no rooms. */
  private mixes = new Map<string, RoomMix>();
  private readonly outputs = new Map<string, GainLike>();
  private current: Room[] = [];

  constructor(private readonly context: EngineContext) {
    super();
    const input = context.createGain();
    const output = context.createGain();
    input.connect(output);
    this.preview = { input, output };
    this.mixes.set(TABLE_ROOM, this.createMix("Table"));
  }

  rooms(): Room[] {
    return this.current.map((room) => ({ ...room }));
  }

  /**
   * Bring the rooms in line with the bots in voice channels (OutputsState →
   * `roomsOf`). A new room starts silent; a room that is no longer listed has
   * its sound cut at once (its bot left, so nobody hears it any more).
   */
  setRooms(rooms: readonly Room[]): void {
    const ids = rooms.map((room) => room.botId);
    for (const id of ids) {
      if (id === TABLE_ROOM || id === PREVIEW_ID || !id) {
        throw new Error(`Not a room id: "${id}"`);
      }
    }
    if (new Set(ids).size !== ids.length) {
      throw new Error("A room is listed twice");
    }
    if (sameRooms(this.current, rooms)) {
      return;
    }

    const next = new Map<string, RoomMix>();
    const removed: string[] = [];
    // The table (no rooms yet) becomes the first room, with what it plays.
    const table = this.mixes.get(TABLE_ROOM);
    if (table && rooms.length > 0) {
      this.mixes.delete(TABLE_ROOM);
      this.outputs.set(rooms[0].botId, this.outputs.get(TABLE_ROOM)!);
      this.outputs.delete(TABLE_ROOM);
      this.mixes.set(rooms[0].botId, table);
    }
    for (const room of rooms) {
      const mix = this.mixes.get(room.botId) ?? this.createMix(room.name, room.botId);
      mix.name = room.name;
      next.set(room.botId, mix);
    }
    for (const [id, mix] of this.mixes) {
      if (!next.has(id)) {
        this.release(id, mix);
        removed.push(id);
      }
    }
    if (rooms.length === 0) {
      next.set(TABLE_ROOM, this.createMix("Table"));
    }
    this.mixes = next;
    this.current = rooms.map((room) => ({ botId: room.botId, name: room.name }));

    for (const id of removed) {
      this.emit("room-removed", id);
    }
    this.emit("rooms", this.rooms());
  }

  getRoomBus(roomId: string, lane: Lane): GainLike {
    if (!ROOM_LANES.includes(lane)) {
      throw new Error(`Not a room lane: "${lane}"`);
    }
    return this.fader(this.resolve(roomId), lane).node;
  }

  /** The room's mix after its master, for the host to send to that room's bot. */
  output(roomId: string): GainLike {
    return this.outputs.get(this.resolve(roomId))!;
  }

  setLevel(roomId: string, fader: RoomFaderId, level: number): void {
    if (!Number.isFinite(level)) {
      throw new Error(`Fader level must be a number, got ${level}`);
    }
    const id = this.resolve(roomId);
    this.update(id, fader, { ...this.fader(id, fader).state, level: Math.max(0, Math.min(1, level)) });
  }

  setMuted(roomId: string, fader: RoomFaderId, muted: boolean): void {
    const id = this.resolve(roomId);
    this.update(id, fader, { ...this.fader(id, fader).state, muted });
  }

  levels(roomId: string): RoomLevels {
    const levels = {} as RoomLevels;
    for (const [fader, { state }] of this.mixes.get(this.resolve(roomId))!.faders) {
      levels[fader] = { ...state };
    }
    return levels;
  }

  dispose(): void {
    for (const [id, mix] of this.mixes) {
      this.release(id, mix);
    }
    this.mixes.clear();
    this.preview.input.disconnect();
    this.preview.output.disconnect();
    this.removeAllListeners();
  }

  /** "table" and rooms that have gone mean the first room. */
  private resolve(roomId: string): string {
    if (this.mixes.has(roomId) && roomId !== PREVIEW_ID) {
      return roomId;
    }
    return this.mixes.keys().next().value!;
  }

  private createMix(name: string, id = TABLE_ROOM): RoomMix {
    const nodes: GainLike[] = [];
    const gain = () => {
      const node = this.context.createGain();
      nodes.push(node);
      return node;
    };
    const output = gain();
    const master = gain();
    master.connect(output);
    const faders: RoomMix["faders"] = new Map([["master", { node: master, state: { level: 1, muted: false } }]]);
    for (const lane of ROOM_LANES) {
      const node = gain();
      node.connect(master);
      faders.set(lane, { node, state: { level: 1, muted: false } });
    }
    this.outputs.set(id, output);
    return { name, faders, nodes };
  }

  private release(id: string, mix: RoomMix) {
    for (const node of mix.nodes) {
      node.disconnect();
    }
    this.outputs.delete(id);
  }

  private fader(roomId: string, fader: RoomFaderId) {
    const found = this.mixes.get(roomId)?.faders.get(fader);
    if (!found) {
      throw new Error(`Unknown fader: ${fader}`);
    }
    return found;
  }

  private update(roomId: string, fader: RoomFaderId, state: RoomFaderState) {
    const found = this.fader(roomId, fader);
    found.state = state;
    rampTo(found.node.gain, state.muted ? 0 : state.level, this.context.currentTime, SMOOTHING_SECONDS);
    this.emit("levels", roomId, this.levels(roomId));
  }
}

function sameRooms(a: readonly Room[], b: readonly Room[]): boolean {
  return a.length === b.length && a.every((room, i) => room.botId === b[i].botId && room.name === b[i].name);
}
