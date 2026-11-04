import React, { useEffect, useRef } from "react";

import { useStore } from "react-redux";
import { RootState } from "../../app/store";

import { Sound } from "./soundboardsSlice";

type SoundboardRemoteProps = {
  onPlay: (sound: Sound) => void;
  onStop: (id: string) => void;
};

const CHANNELS = [
  "PLAYER_REMOTE_SOUNDBOARD_PLAY",
  "PLAYER_REMOTE_SOUNDBOARD_STOP",
  "PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REQUEST",
  "PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REQUEST",
] as const;

/**
 * Answers the remote API (Stream Deck) for soundboards.
 *
 * PERF-1: the listeners are registered once and read the store and the latest
 * callbacks when a message arrives (Kenku FM re-registered them every second
 * while a sound played, and on every library change).
 */
export function SoundboardRemote(props: SoundboardRemoteProps) {
  const store = useStore<RootState>();
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    window.player.on("PLAYER_REMOTE_SOUNDBOARD_PLAY", (args) => {
      const id = args[0];
      const { soundboards } = store.getState();

      if (id in soundboards.sounds) {
        const sound = soundboards.sounds[id];
        callbacks.current.onPlay(sound);
      } else if (id in soundboards.soundboards.byId) {
        const soundboard = soundboards.soundboards.byId[id];
        const sounds = [...soundboard.sounds];
        const soundId = sounds[Math.floor(Math.random() * sounds.length)];
        const sound = soundboards.sounds[soundId];
        if (sound) {
          callbacks.current.onPlay(sound);
        }
      }
    });

    window.player.on("PLAYER_REMOTE_SOUNDBOARD_STOP", (args) => {
      const id = args[0];
      callbacks.current.onStop(id);
    });

    // PERF-9: args[0] is the request id; it goes back with the reply.
    window.player.on("PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REQUEST", (args) => {
      const sounds = Object.values(store.getState().soundboardPlayback.playback);
      window.player.soundboardPlaybackReply({
        sounds,
      }, args[0]);
    });

    window.player.on("PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REQUEST", (args) => {
      const { soundboards } = store.getState();
      window.player.soundboardGetAllReply({
        soundboards: soundboards.soundboards.allIds.map(
          (id) => soundboards.soundboards.byId[id]
        ),
        sounds: Object.values(soundboards.sounds),
      }, args[0]);
    });

    return () => {
      for (const channel of CHANNELS) {
        window.player.removeAllListeners(channel);
      }
    };
  }, [store]);

  return <></>;
}
