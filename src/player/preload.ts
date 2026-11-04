import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  PlaylistPlaybackReply,
  PlaylistsReply,
  SoundboardPlaybackReply,
  SoundboardsReply,
} from "../types/player";
import type { Room } from "../common/domain/types";

/**
 * OUT-5, PRV-1: the private channel to the capture window (engine rooms and
 * the preview). A MessagePort cannot pass through contextBridge, so it is
 * posted to this page's own window, where src/player/engine/rooms/browserBridge.ts
 * (listenForPlayerAudioPort) takes it; must match PLAYER_AUDIO_PORT_MESSAGE
 * there. It is held until the page asks for it (`connectAudio`), so a page
 * that starts its engine later still gets it; a newer end replaces an unused one.
 */
let heldAudioPort: MessagePort | undefined;
let audioWanted = false;
function postAudioPort(port: MessagePort) {
  window.postMessage("lyre-player-audio-port", "*", [port]);
}
ipcRenderer.on("PLAYER_AUDIO_PORT", (event) => {
  const port = event.ports.length === 1 ? event.ports[0] : undefined;
  if (!port) {
    return;
  }
  heldAudioPort?.close();
  heldAudioPort = undefined;
  if (audioWanted) {
    postAudioPort(port);
  } else {
    heldAudioPort = port;
  }
});

/** OUT-5: the last rooms sent, for a listener that starts later. */
let lastRooms: Room[] = [];
ipcRenderer.on("PLAYER_ROOMS", (_event, rooms: unknown) => {
  if (isRoomList(rooms)) {
    lastRooms = rooms.map(({ botId, name }) => ({ botId, name }));
  }
});

/** A list of rooms as the main process sends it; anything else is dropped. */
function isRoomList(value: unknown): value is Room[] {
  return (
    Array.isArray(value) &&
    value.every(
      (room) =>
        typeof room === "object" &&
        room !== null &&
        typeof (room as Room).botId === "string" &&
        typeof (room as Room).name === "string",
    )
  );
}

type Channel =
  | "PLAYER_REMOTE_PLAYLIST_GET_ALL_REQUEST"
  | "PLAYER_REMOTE_PLAYLIST_PLAY"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_REQUEST"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_PLAY"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_PAUSE"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_MUTE"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_VOLUME"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_SEEK"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_NEXT"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_PREVIOUS"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_REPEAT"
  | "PLAYER_REMOTE_PLAYLIST_PLAYBACK_SHUFFLE"
  | "PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REQUEST"
  | "PLAYER_REMOTE_SOUNDBOARD_PLAY"
  | "PLAYER_REMOTE_SOUNDBOARD_STOP"
  | "PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REQUEST";

const validChannels: Channel[] = [
  "PLAYER_REMOTE_PLAYLIST_GET_ALL_REQUEST",
  "PLAYER_REMOTE_PLAYLIST_PLAY",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_REQUEST",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_PLAY",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_PAUSE",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_MUTE",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_VOLUME",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_SEEK",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_NEXT",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_PREVIOUS",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_REPEAT",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_SHUFFLE",
  "PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REQUEST",
  "PLAYER_REMOTE_SOUNDBOARD_PLAY",
  "PLAYER_REMOTE_SOUNDBOARD_STOP",
  "PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REQUEST",
];

/**
 * Remote API questions arrive with a request id as their first argument
 * (PERF-9); pass it back unchanged as `requestId` in the matching reply.
 */
const api = {
  on: (channel: Channel, callback: (...args: any[]) => any) => {
    if (validChannels.includes(channel)) {
      const newCallback = (_: any, ...args: any[]) => callback(args);
      ipcRenderer.on(channel, newCallback);
    }
  },
  removeAllListeners: (channel: Channel) => {
    if (validChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  playlistPlaybackReply: (playback: PlaylistPlaybackReply, requestId: number) => {
    ipcRenderer.send("PLAYER_REMOTE_PLAYLIST_PLAYBACK_REPLY", playback, requestId);
  },
  soundboardPlaybackReply: (playback: SoundboardPlaybackReply, requestId: number) => {
    ipcRenderer.send("PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REPLY", playback, requestId);
  },
  playlistGetAllReply: (playlists: PlaylistsReply, requestId: number) => {
    ipcRenderer.send("PLAYER_REMOTE_PLAYLIST_GET_ALL_REPLY", playlists, requestId);
  },
  soundboardGetAllReply: (soundboards: SoundboardsReply, requestId: number) => {
    ipcRenderer.send("PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REPLY", soundboards, requestId);
  },
  getPathForFile: (file: File) => {
    return webUtils.getPathForFile(file);
  },
  /**
   * PERF-6: before the window closes, the main process asks the player to
   * save changes it is still holding back; `save` must write them at once.
   * The answer (PLAYER_SAVED) is sent even if saving fails, so closing never
   * waits longer than it has to.
   */
  /**
   * OUT-5: the rooms (every bot in a voice channel, the table first), now and
   * whenever they change. Returns a function that stops listening.
   */
  onRooms: (callback: (rooms: Room[]) => void) => {
    const listener = (_: unknown, rooms: unknown) => {
      if (isRoomList(rooms)) {
        callback(rooms.map(({ botId, name }) => ({ botId, name })));
      }
    };
    ipcRenderer.on("PLAYER_ROOMS", listener);
    callback(lastRooms.map((room) => ({ ...room })));
    return () => {
      ipcRenderer.off("PLAYER_ROOMS", listener);
    };
  },
  /** OUT-5, PRV-1: post the audio channel's end to this page now, and every new one from now on. */
  connectAudio: () => {
    audioWanted = true;
    if (heldAudioPort) {
      postAudioPort(heldAudioPort);
      heldAudioPort = undefined;
    }
  },
  onSaveRequest: (save: () => void) => {
    ipcRenderer.on("PLAYER_SAVE_NOW", () => {
      try {
        save();
      } finally {
        ipcRenderer.send("PLAYER_SAVED");
      }
    });
  },
};

declare global {
  interface Window {
    player: typeof api;
  }
}

contextBridge.exposeInMainWorld("player", api);
