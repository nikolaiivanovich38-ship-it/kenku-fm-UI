/**
 * Security review w4, Should 4: one volume per room. The Now playing bar, Live's room box and Outputs show and change
 * the same number:
 *
 * - a bot's room plays at the bot's volume, kept by the main process (the Outputs bridge);
 * - the table (no bot in a voice channel) plays at the audio host's level for it, which nobody hears (BUG-19);
 * - a page without the Outputs bridge (tests, the prototype) has only the audio host's levels.
 *
 * While the bridge has not yet said what a bot's volume is, its slider shows the room as it plays and changes
 * nothing, so no path can leave a bot's room quieter than its slider shows.
 */
import { TABLE_ROOM } from "../../player/engine/rooms/roomMixer";
import type { OutputsClient } from "./OutputsProvider";

export interface RoomVolumeControl {
  /** 0 to 100, what the slider shows. */
  volume: number;
  change(value: number): void;
}

export function roomVolumeControl(
  room: { roomId: string; level: number },
  bot: { id: string; volume: number } | null,
  client: OutputsClient | null,
  audio: { setRoomVolume(target: { room: string }, volume: number): unknown },
): RoomVolumeControl {
  if (!client || room.roomId === TABLE_ROOM) {
    return { volume: Math.round(room.level * 100), change: (value) => audio.setRoomVolume({ room: room.roomId }, value / 100) };
  }
  if (!bot) return { volume: Math.round(room.level * 100), change: () => undefined };
  return { volume: Math.round(bot.volume * 100), change: (value) => client.setVolume(bot.id, value / 100) };
}
