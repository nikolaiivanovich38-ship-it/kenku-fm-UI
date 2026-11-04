import React, { useEffect, useRef } from "react";

import { Track } from "./playlistsSlice";

import { useDispatch, useStore } from "react-redux";
import { RootState } from "../../app/store";
import {
  playPause,
  repeat,
  mute,
  adjustVolume,
  shuffle,
  startQueue,
} from "./playlistPlaybackSlice";

type PlaylistRemoteProps = {
  onPlay: (track: Track) => void;
  onSeek: (to: number) => void;
  onNext: () => void;
  onPrevious: () => void;
};

const CHANNELS = [
  "PLAYER_REMOTE_PLAYLIST_PLAY",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_REQUEST",
  "PLAYER_REMOTE_PLAYLIST_GET_ALL_REQUEST",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_PLAY",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_PAUSE",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_SEEK",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_MUTE",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_VOLUME",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_SHUFFLE",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_REPEAT",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_NEXT",
  "PLAYER_REMOTE_PLAYLIST_PLAYBACK_PREVIOUS",
] as const;

/**
 * Answers the remote API (Stream Deck) for playlists.
 *
 * PERF-1: the listeners are registered once. Each handler reads the store and
 * the latest callbacks when a message arrives, so nothing needs re-registering
 * when playback moves on (Kenku FM re-registered most listeners every second).
 */
export function PlaylistRemote(props: PlaylistRemoteProps) {
  const store = useStore<RootState>();
  const dispatch = useDispatch();
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    window.player.on("PLAYER_REMOTE_PLAYLIST_PLAY", (args) => {
      const id = args[0];
      const { playlists, playlistPlayback } = store.getState();
      if (id in playlists.tracks) {
        const track = playlists.tracks[id];
        // Find playlist assosiated with this track and start a queue
        for (const playlist of Object.values(playlists.playlists.byId)) {
          const tracks = [...playlist.tracks];
          if (tracks.includes(track.id)) {
            dispatch(
              startQueue({ tracks, trackId: track.id, playlistId: playlist.id })
            );
            break;
          }
        }
        callbacks.current.onPlay(track);
      } else if (id in playlists.playlists.byId) {
        const playlist = playlists.playlists.byId[id];
        const tracks = [...playlist.tracks];
        const trackIndex = playlistPlayback.shuffle
          ? Math.floor(Math.random() * tracks.length)
          : 0;
        const trackId = tracks[trackIndex];
        const track = playlists.tracks[trackId];
        if (track) {
          callbacks.current.onPlay(track);
          dispatch(startQueue({ tracks, trackId, playlistId: playlist.id }));
        }
      }
    });

    // PERF-9: args[0] is the request id; it goes back with the reply.
    window.player.on("PLAYER_REMOTE_PLAYLIST_PLAYBACK_REQUEST", (args) => {
      const { playlists, playlistPlayback: playback } = store.getState();
      let track = undefined;
      if (playback.track && playback.playback && playback.queue) {
        track = {
          ...playback.track,
          ...playback.playback,
        };
      }
      let playlist = undefined;
      if (playback.queue?.playlistId) {
        playlist = {
          id: playback.queue.playlistId,
          title: playlists.playlists.byId[playback.queue.playlistId]?.title,
        };
      }
      window.player.playlistPlaybackReply({
        playing: playback.playing,
        volume: playback.volume,
        muted: playback.muted,
        shuffle: playback.shuffle,
        repeat: playback.repeat,
        track,
        playlist,
      }, args[0]);
    });

    window.player.on("PLAYER_REMOTE_PLAYLIST_GET_ALL_REQUEST", (args) => {
      const { playlists } = store.getState();
      window.player.playlistGetAllReply({
        playlists: playlists.playlists.allIds.map(
          (id) => playlists.playlists.byId[id]
        ),
        tracks: Object.values(playlists.tracks),
      }, args[0]);
    });

    window.player.on("PLAYER_REMOTE_PLAYLIST_PLAYBACK_PLAY", () => {
      if (store.getState().playlistPlayback.playback) {
        dispatch(playPause(true));
      }
    });

    window.player.on("PLAYER_REMOTE_PLAYLIST_PLAYBACK_PAUSE", () => {
      if (store.getState().playlistPlayback.playback) {
        dispatch(playPause(false));
      }
    });

    window.player.on("PLAYER_REMOTE_PLAYLIST_PLAYBACK_SEEK", (args) => {
      const to = args[0];
      const playback = store.getState().playlistPlayback.playback;
      if (playback) {
        // Clamp playback and seek
        callbacks.current.onSeek(Math.min(Math.max(to, 0), playback.duration));
      }
    });

    window.player.on("PLAYER_REMOTE_PLAYLIST_PLAYBACK_MUTE", (args) => {
      const muted = args[0];
      dispatch(mute(muted));
    });

    window.player.on("PLAYER_REMOTE_PLAYLIST_PLAYBACK_VOLUME", (args) => {
      const volume = args[0];
      dispatch(adjustVolume(volume));
    });

    window.player.on("PLAYER_REMOTE_PLAYLIST_PLAYBACK_SHUFFLE", (args) => {
      const shuffled = args[0];
      dispatch(shuffle(shuffled));
    });

    window.player.on("PLAYER_REMOTE_PLAYLIST_PLAYBACK_REPEAT", (args) => {
      const repeated = args[0];
      dispatch(repeat(repeated));
    });

    window.player.on("PLAYER_REMOTE_PLAYLIST_PLAYBACK_NEXT", () => {
      callbacks.current.onNext();
    });

    window.player.on("PLAYER_REMOTE_PLAYLIST_PLAYBACK_PREVIOUS", () => {
      callbacks.current.onPrevious();
    });

    return () => {
      for (const channel of CHANNELS) {
        window.player.removeAllListeners(channel);
      }
    };
  }, [store, dispatch]);

  return <></>;
}
