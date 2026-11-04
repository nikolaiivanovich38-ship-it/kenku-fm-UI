/**
 * The new interface's preload side of LyreAudio (src/lyre/preload.ts exposes
 * it as `window.lyre.audio`). It is the same as the player page's
 * (src/player/preload.ts): the main process's PlayerAudioBridge hands this
 * page one end of the private channel to the capture window (OUT-5, PRV-1)
 * and tells it the rooms; files are prepared with MEDIA_PREPARE (BUG-10).
 *
 * A MessagePort cannot pass through contextBridge, so the end is posted to
 * this page's own window, where `listenForPlayerAudioPort` takes it. It is
 * held until the page asks for it (`connect`), so a page that starts its
 * audio later still gets it; a newer end replaces (and closes) an unused one.
 *
 * Kept free of Electron imports (the preload passes `ipcRenderer`), so it can
 * be unit-tested.
 */
import type { Room } from "../../common/domain/types";
import type { MediaBridge, PrepareAnswer } from "../../player/engine/sources/mainMediaResolver";

/** Main → page: the channel's end. Must match PLAYER_AUDIO_PORT in src/main/broadcast/playerAudioBridge.ts. */
export const LYRE_AUDIO_PORT_CHANNEL = "PLAYER_AUDIO_PORT";
/** Main → page: the rooms. Must match PLAYER_ROOMS there. */
export const LYRE_ROOMS_CHANNEL = "PLAYER_ROOMS";
/** Preload → page. Must match PLAYER_AUDIO_PORT_MESSAGE in src/player/engine/rooms/browserBridge.ts. */
export const PORT_MESSAGE = "lyre-player-audio-port";

/** What the new page's `window.lyre.audio` offers. */
export interface LyreAudioBridge {
  /** Post the channel's end to this page now, and every new one from now on. */
  connect(): void;
  /** The rooms (every bot in a voice channel, the first room first), now and whenever they change. Returns an unsubscribe. */
  onRooms(callback: (rooms: Room[]) => void): () => void;
  /** MEDIA_PREPARE: the address to play for a library file. */
  media: MediaBridge;
}

/** The parts of Electron's ipcRenderer this needs. */
export interface IpcRendererLike {
  on(channel: string, listener: (event: { ports?: readonly MessagePort[] }, ...args: unknown[]) => void): unknown;
  off(channel: string, listener: (...args: never[]) => void): unknown;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

export function createLyreAudioBridge(ipc: IpcRendererLike, target: Pick<Window, "postMessage">): LyreAudioBridge {
  let held: MessagePort | undefined;
  let wanted = false;
  let lastRooms: Room[] = [];
  const post = (port: MessagePort) => target.postMessage(PORT_MESSAGE, "*", [port]);

  ipc.on(LYRE_AUDIO_PORT_CHANNEL, (event) => {
    const port = event.ports?.length === 1 ? event.ports[0] : undefined;
    if (!port) {
      return;
    }
    held?.close();
    held = undefined;
    if (wanted) {
      post(port);
    } else {
      held = port;
    }
  });
  ipc.on(LYRE_ROOMS_CHANNEL, (_event, rooms) => {
    if (isRoomList(rooms)) {
      lastRooms = plain(rooms);
    }
  });

  return {
    connect: () => {
      wanted = true;
      if (held) {
        post(held);
        held = undefined;
      }
    },
    onRooms: (callback) => {
      const listener = (_event: unknown, rooms: unknown) => {
        if (isRoomList(rooms)) {
          callback(plain(rooms));
        }
      };
      ipc.on(LYRE_ROOMS_CHANNEL, listener);
      callback(plain(lastRooms));
      return () => {
        ipc.off(LYRE_ROOMS_CHANNEL, listener);
      };
    },
    media: {
      prepare: (url, options) => ipc.invoke("MEDIA_PREPARE", url, options) as Promise<PrepareAnswer>,
    },
  };
}

/** A list of rooms as the main process sends it; anything else is dropped. */
function isRoomList(value: unknown): value is Room[] {
  return (
    Array.isArray(value) &&
    value.every(
      (room) => typeof room === "object" && room !== null && typeof (room as Room).botId === "string" && typeof (room as Room).name === "string",
    )
  );
}

/** Only the two known fields, copied, so nothing else crosses into the page. */
function plain(rooms: Room[]): Room[] {
  return rooms.map(({ botId, name }) => ({ botId, name }));
}
