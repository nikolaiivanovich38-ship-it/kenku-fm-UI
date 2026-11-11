/**
 * OUT-7 (w6-rooms): Undo of a Kick that left the players in silence puts the bot back and its music with it, from
 * where it was (ROUND6.md: "an Undo puts the bot back and plays what it played from where it was"). The bot joins
 * first; the room exists for the audio host only once it is connected, so the lanes start when its room appears
 * (or never, after `waitMs`, if Discord does not let it back in: the screen has said what happened by then).
 */
import type { LyreAudio, RoomNowPlaying } from "../audio/lyreAudio";
import type { RoomToRestore } from "../screens/outputs/outputsModel";
import type { OutputsClient } from "./OutputsProvider";

/** The quick fade back in. */
const FADE_IN_MS = 1000;

export async function restoreRoom(what: RoomToRestore, deps: { client: Pick<OutputsClient, "move">; audio: LyreAudio; waitMs?: number }): Promise<boolean> {
  const { client, audio } = deps;
  client.move(what.botId, what.channelId);
  const there = await roomAppears(audio, what.botId, deps.waitMs ?? 10_000);
  if (!there) return false;
  // w51-fix2: when the last bot left, its music went on at the table and came back with it: leave such a lane alone.
  const back = audio.getNowPlaying().rooms.find((room) => room.roomId === what.botId);
  const playing = new Set([back?.music, back?.ambience].filter((lane) => lane && !lane.paused).map((lane) => lane!.trackId));
  for (const lane of what.lanes) {
    if (playing.has(lane.trackId)) continue;
    audio.playTrack(lane.trackId, {
      target: { room: what.botId },
      ...(lane.from ? { from: lane.from as never } : {}),
      ...(lane.place ? { place: lane.place } : {}),
      fromMs: lane.fromMs,
      fadeMs: FADE_IN_MS,
    });
  }
  return true;
}

function roomAppears(audio: LyreAudio, roomId: string, waitMs: number): Promise<boolean> {
  const has = (rooms: readonly RoomNowPlaying[]) => rooms.some((room) => room.roomId === roomId);
  if (has(audio.getNowPlaying().rooms)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const stop = audio.subscribe(() => {
      if (!has(audio.getNowPlaying().rooms)) return;
      finish(true);
    });
    const timer = setTimeout(() => finish(false), waitMs);
    function finish(found: boolean) {
      clearTimeout(timer);
      stop();
      resolve(found);
    }
  });
}
