import { useCallback, useEffect, useRef } from "react";
import { Howl } from "howler";

import { useDispatch, useSelector, useStore } from "react-redux";
import { RootState } from "../../app/store";
import {
  markCurrentRemoved,
  playPause,
  playTrack,
  Queue,
  updatePlayback,
  updateQueue,
  stopTrack,
} from "./playlistPlaybackSlice";
import { Track } from "./playlistsSlice";

/** How often the player bar's time is updated while a track plays (PERF-1). */
export const PROGRESS_INTERVAL_MS = 1000;

/** Track ids in play order: the shuffled order with shuffle on, else the list. */
function playOrder(queue: Queue, shuffle: boolean): string[] {
  return shuffle ? queue.shuffled.map((index) => queue.tracks[index]) : queue.tracks;
}

/**
 * BUG-8: where the queue should carry on after the playing track `deletedId`
 * was deleted: the position, in today's queue, of the first entry that
 * followed it (one past the end if none did), or null when it was not queued.
 * Worked out from the queue as it was before the deletion, because the
 * current player's removeTrackFromQueue can point "current" at the wrong
 * entry with shuffle off (QUEUE-1, BUG-11, still open here).
 */
function placeOfDeleted(
  before: Queue | undefined,
  now: Queue | undefined,
  shuffle: boolean,
  deletedId: string,
): number | null {
  if (!before || !now || before.playlistId !== now.playlistId) {
    return null;
  }
  const oldOrder = playOrder(before, shuffle);
  const at = oldOrder.indexOf(deletedId);
  if (at === -1) {
    return null;
  }
  const newOrder = playOrder(now, shuffle);
  for (const id of oldOrder.slice(at + 1)) {
    const place = newOrder.indexOf(id);
    if (place !== -1 && id !== deletedId) {
      return place;
    }
  }
  return newOrder.length;
}

/** A track that is still loading, and what was current before it. */
type Loading = { previous: Howl | null; previousId: string | null };

export function usePlaylistPlayback(onError: (message: string) => void) {
  const trackRef = useRef<Howl | null>(null);
  /** Id of the track `trackRef` holds, which may still be loading. */
  const trackIdRef = useRef<string | null>(null);
  /** Tracks still fading out after a track change. */
  const outgoingRef = useRef(new Set<Howl>());
  /**
   * Tracks that have not loaded yet, with the track each one replaces, so
   * deleting a loading track can hand control back (review 6). An entry is
   * removed as soon as its track loads or fails, so old tracks are not kept.
   */
  const loadingRef = useRef(new Map<Howl, Loading>());
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const playlists = useSelector((state: RootState) => state.playlists);
  const store = useStore<RootState>();
  const muted = useSelector((state: RootState) => state.playlistPlayback.muted);
  const repeat = useSelector(
    (state: RootState) => state.playlistPlayback.repeat
  );
  const shuffle = useSelector(
    (state: RootState) => state.playlistPlayback.shuffle
  );
  const queue = useSelector((state: RootState) => state.playlistPlayback.queue);
  const playbackTrack = useSelector(
    (state: RootState) => state.playlistPlayback.track
  );
  const dispatch = useDispatch();

  // PERF-1: Kenku FM read the play position on every animation frame (about
  // 60 times a second) from the first track until the app closed, even while
  // paused. Now a once-a-second timer runs only while the track plays: it
  // starts when the track loads or Howler reports "play", and ends on "pause",
  // "stop", a track change, or the first tick that finds the track not playing.
  const stopProgressUpdates = useCallback(() => {
    if (progressTimerRef.current !== null) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  const startProgressUpdates = useCallback(
    (howl: Howl) => {
      if (howl !== trackRef.current) {
        return;
      }
      stopProgressUpdates();
      progressTimerRef.current = setInterval(() => {
        if (howl !== trackRef.current || !howl.playing()) {
          stopProgressUpdates();
          return;
        }
        dispatch(updatePlayback(Math.floor(howl.seek())));
      }, PROGRESS_INTERVAL_MS);
    },
    [dispatch, stopProgressUpdates]
  );

  useEffect(() => stopProgressUpdates, [stopProgressUpdates]);

  const play = useCallback(
    (track: Track) => {
      let prevTrack = trackRef.current;
      const prevTrackId = trackIdRef.current;
      if (prevTrack) {
        outgoingRef.current.add(prevTrack);
      }
      function removePrevTrack() {
        if (prevTrack) {
          prevTrack.unload();
          outgoingRef.current.delete(prevTrack);
          prevTrack = undefined;
        }
      }
      let created: Howl | null = null;
      function error() {
        if (created) {
          loadingRef.current.delete(created);
        }
        trackRef.current = undefined;
        trackIdRef.current = null;
        stopProgressUpdates();
        dispatch(stopTrack());
        removePrevTrack();
        onError(`Unable to play track: ${track.title}`);
      }

      try {
        const howl = new Howl({
          src: track.url,
          html5: true,
          mute: muted,
          volume: 0,
        });

        trackRef.current = howl;
        trackIdRef.current = track.id;
        created = howl;
        loadingRef.current.set(howl, { previous: prevTrack ?? null, previousId: prevTrackId });
        howl.once("load", () => {
          loadingRef.current.delete(howl);
          dispatch(
            playTrack({
              track,
              duration: Math.floor(howl.duration()),
            })
          );
          // Fade out previous track (unless it was deleted meanwhile) and fade in new track
          if (prevTrack && outgoingRef.current.has(prevTrack)) {
            prevTrack.fade(prevTrack.volume(), 0, 1000);
            prevTrack.once("fade", removePrevTrack);
          }
          howl.fade(0, store.getState().playlistPlayback.volume, 1000);
          startProgressUpdates(howl);
        });
        howl.on("play", () => startProgressUpdates(howl));
        howl.on("pause", () => howl === trackRef.current && stopProgressUpdates());
        howl.on("stop", () => howl === trackRef.current && stopProgressUpdates());

        howl.on("loaderror", error);

        howl.on("playerror", error);

        const sound = (howl as any)._sounds[0];
        if (!sound) {
          error();
        }
      } catch {
        error();
      }
    },
    [dispatch, onError, muted, store, startProgressUpdates, stopProgressUpdates]
  );

  // BUG-8: when the playing track leaves the library (its Delete menu item, or
  // its playlist was deleted), stop it for good. Kenku FM only paused it, so
  // the play key or the remote could resume a track the player bar no longer
  // showed. A different track that is still loading carries on. The queue
  // keeps the deleted track's place, so Next and Previous (player bar, media
  // keys, remote) carry on from there.
  const deletedTrackId = useSelector((state: RootState) => {
    const current = state.playlistPlayback.track;
    return current && !(current.id in state.playlists.tracks) ? current.id : null;
  });
  /** The queue as of the last render, before the deletion changed it. */
  const queueBeforeRef = useRef(queue);
  useEffect(() => {
    if (deletedTrackId === null) {
      return;
    }
    for (const outgoing of outgoingRef.current) {
      outgoing.unload();
    }
    outgoingRef.current.clear();
    if (trackIdRef.current === deletedTrackId) {
      stopProgressUpdates();
      trackRef.current?.unload();
      trackRef.current = null;
      trackIdRef.current = null;
      const now = store.getState().playlistPlayback;
      const place = placeOfDeleted(queueBeforeRef.current, now.queue, now.shuffle, deletedTrackId);
      if (place !== null) {
        dispatch(markCurrentRemoved(place));
      }
    }
    dispatch(stopTrack());
  }, [deletedTrackId, dispatch, stopProgressUpdates, store]);
  // Declared after the effect above so that, when it runs, this still holds
  // the queue from before the deletion.
  useEffect(() => {
    queueBeforeRef.current = queue;
  }, [queue]);

  // Review 6: a track deleted while it is still loading never plays, and the
  // track it was about to replace stays in charge (it was never faded out).
  const libraryTracks = playlists.tracks;
  useEffect(() => {
    const howl = trackRef.current;
    const id = trackIdRef.current;
    const loading = howl ? loadingRef.current.get(howl) : undefined;
    if (!howl || !loading || id === null || id in libraryTracks) {
      return;
    }
    loadingRef.current.delete(howl);
    howl.off();
    howl.unload();
    const previous = loading.previous;
    if (previous && outgoingRef.current.has(previous)) {
      outgoingRef.current.delete(previous);
      trackRef.current = previous;
      trackIdRef.current = loading.previousId;
      startProgressUpdates(previous);
    } else {
      trackRef.current = null;
      trackIdRef.current = null;
    }
  }, [libraryTracks, startProgressUpdates]);

  const seek = useCallback((to: number) => {
    dispatch(updatePlayback(to));
    trackRef.current?.seek(to);
  }, []);

  const stop = useCallback(() => {
    dispatch(playPause(false));
    dispatch(updatePlayback(0));
    trackRef.current?.stop();
  }, []);

  const next = useCallback(() => {
    if (!trackRef.current && !queue?.removedCurrent) {
      return;
    }
    if (!queue) {
      stop();
    } else if (repeat === "track" && !queue.removedCurrent) {
      seek(0);
    } else {
      // After the playing track was deleted, `current` is already the entry
      // that followed it.
      let index = queue.removedCurrent ? queue.current : queue.current + 1;

      if (index >= queue.tracks.length) {
        // Repeat off just stop the playback
        if (repeat === "off") {
          stop();
          return;
        }
        index = 0;
      }

      let id: string;
      if (shuffle) {
        id = queue.tracks[queue.shuffled[index]];
      } else {
        id = queue.tracks[index];
      }
      if (id) {
        if (id === playbackTrack?.id) {
          // Playing the same track just restart it
          seek(0);
        } else {
          // Play the previous track
          const previousTrack = playlists.tracks[id];
          if (previousTrack) {
            play(previousTrack);
            dispatch(updateQueue(index));
          }
        }
      }
    }
  }, [repeat, queue, shuffle, playbackTrack, playlists, seek, play, stop]);

  const previous = useCallback(() => {
    if (!trackRef.current && !queue?.removedCurrent) {
      return;
    }
    if (!queue) {
      stop();
    } else if (repeat === "track" && !queue.removedCurrent) {
      seek(0);
    } else {
      let index = queue.current;
      // Only go to previous if at the start of the track (or the track was deleted)
      if (queue.removedCurrent || !trackRef.current || trackRef.current.seek() < 5) {
        index -= 1;
      }
      if (index < 0) {
        // Start of playlist with repeat off just stop the track
        if (repeat === "off") {
          stop();
          return;
        }
        index = queue.tracks.length - 1;
      }
      let id: string;
      if (shuffle) {
        id = queue.tracks[queue.shuffled[index]];
      } else {
        id = queue.tracks[index];
      }
      if (id) {
        if (id === playbackTrack?.id) {
          // Playing the same track just restart it
          seek(0);
        } else {
          // Play the next track
          const nextTrack = playlists.tracks[id];
          if (nextTrack) {
            play(nextTrack);
            dispatch(updateQueue(index));
          }
        }
      }
    }
  }, [repeat, queue, shuffle, playbackTrack, playlists, seek, play, stop]);

  useEffect(() => {
    const track = trackRef.current;
    // Move to next song or repeat this song on track end
    function handleEnd() {
      if (!queue) {
        stop();
      } else if (repeat === "track") {
        seek(0);
        track?.play();
      } else {
        let index = queue.current + 1;
        if (index >= queue.tracks.length) {
          // Repeat off just stop the playback
          if (repeat === "off") {
            stop();
            return;
          }
          index = 0;
        }
        let id: string;
        if (shuffle) {
          id = queue.tracks[queue.shuffled[index]];
        } else {
          id = queue.tracks[index];
        }
        if (id) {
          if (id === playbackTrack?.id) {
            // Playing the same track just restart it
            seek(0);
            track?.play();
          } else {
            // Play the next track
            const nextTrack = playlists.tracks[id];
            if (nextTrack) {
              play(nextTrack);
              dispatch(updateQueue(index));
            }
          }
        }
      }
    }
    track?.on("end", handleEnd);
    return () => {
      track?.off("end", handleEnd);
    };
  }, [repeat, queue, shuffle, playbackTrack, playlists, play, seek, stop]);

  const pauseResume = useCallback((resume: boolean) => {
    if (trackRef.current) {
      if (resume) {
        trackRef.current.play();
      } else {
        trackRef.current.pause();
      }
    }
  }, []);

  const mute = useCallback((muted: boolean) => {
    if (trackRef.current) {
      trackRef.current.mute(muted);
    }
  }, []);

  const volume = useCallback((volume: number) => {
    if (trackRef.current) {
      trackRef.current.volume(volume);
    }
  }, []);

  return {
    seek,
    play,
    next,
    previous,
    stop,
    pauseResume,
    mute,
    volume,
  };
}
