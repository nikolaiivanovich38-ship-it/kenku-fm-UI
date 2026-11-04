import { useCallback, useEffect, useRef } from "react";

import { useDispatch } from "react-redux";
import {
  playSound,
  updatePlayback,
  stopSound,
} from "./soundboardPlaybackSlice";
import { Sound as SoundType } from "./soundboardsSlice";
import { Sound } from "./Sound";

/** How often the progress of playing sounds is updated (PERF-1). */
export const PROGRESS_INTERVAL_MS = 1000;

export function useSoundboardPlayback(onError: (message: string) => void) {
  const soundsRef = useRef<Record<string, Sound>>({});
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dispatch = useDispatch();

  // PERF-1: Kenku FM checked the sounds on every animation frame (about 60
  // times a second) from start-up, even with nothing playing. Now a
  // once-a-second timer runs only while there are sounds, started by play()
  // and ended by the first tick that finds none left.
  const stopProgressUpdates = useCallback(() => {
    if (progressTimerRef.current !== null) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  const startProgressUpdates = useCallback(() => {
    if (progressTimerRef.current !== null) {
      return;
    }
    progressTimerRef.current = setInterval(() => {
      const ids = Object.keys(soundsRef.current);
      if (ids.length === 0) {
        stopProgressUpdates();
        return;
      }
      const updates: { id: string; progress: number }[] = [];
      for (const id of ids) {
        const sound = soundsRef.current[id];
        if (sound.playing()) {
          updates.push({ id, progress: sound.progress() });
        }
      }
      if (updates.length > 0) {
        dispatch(updatePlayback(updates));
      }
    }, PROGRESS_INTERVAL_MS);
  }, [dispatch, stopProgressUpdates]);

  useEffect(() => stopProgressUpdates, [stopProgressUpdates]);

  /** Drop a finished sound; the timer stops with the last one. */
  const forgetSound = useCallback(
    (id: string) => {
      delete soundsRef.current[id];
      if (Object.keys(soundsRef.current).length === 0) {
        stopProgressUpdates();
      }
    },
    [stopProgressUpdates]
  );

  const play = useCallback(
    (sound: SoundType) => {
      if (soundsRef.current[sound.id]) {
        soundsRef.current[sound.id].stop(false);
        delete soundsRef.current[sound.id];
      }

      const playback = new Sound({
        src: sound.url,
        volume: sound.volume,
        fadeIn: sound.fadeIn,
        fadeOut: sound.fadeOut,
        loop: sound.loop,
      });

      playback.once("load", (duration) => {
        dispatch(
          playSound({
            sound,
            duration: Math.floor(duration),
          })
        );
      });

      playback.on("end", () => {
        dispatch(stopSound(sound.id));
        soundsRef.current[sound.id]?.stop(false);
        forgetSound(sound.id);
      });

      playback.on("error", () => {
        forgetSound(sound.id);
        dispatch(stopSound(sound.id));
        onError(`Unable to play sound: ${sound.title}`);
      });

      soundsRef.current[sound.id] = playback;
      startProgressUpdates();
    },
    [dispatch, onError, startProgressUpdates, forgetSound]
  );

  const seek = useCallback((id: string, to: number) => {
    dispatch(updatePlayback([{ id, progress: to }]));
    soundsRef.current[id]?.seek(to);
  }, []);

  const stop = useCallback(async (id: string) => {
    dispatch(stopSound(id));
    const loop = soundsRef.current[id];
    if (loop) {
      await loop.stop(true);
      forgetSound(id);
    }
  }, [forgetSound]);

  // Sync function for updating the currently playing sounds with the redux store
  // Used in `SoundboardPlaybackSync`
  const sync = useCallback((update: (id: string, sound: Sound) => void) => {
    for (let [id, sound] of Object.entries(soundsRef.current)) {
      update(id, sound);
    }
  }, []);

  return {
    seek,
    play,
    stop,
    sync,
  };
}
