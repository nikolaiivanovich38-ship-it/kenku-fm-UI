/**
 * PERF-1: the remote API listeners are registered once. Kenku FM removed and
 * re-added most of them on every progress update (once a second while a track
 * or sound played) and on every library change. The handlers must still answer
 * with the current state and call the current callbacks.
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { Provider } from "react-redux";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPlayerStore, PlayerStore } from "../test/createPlayerStore";
import { PlaylistRemote } from "./playlists/PlaylistRemote";
import { SoundboardRemote } from "./soundboards/SoundboardRemote";
import { addPlaylist, addTracks, Track } from "./playlists/playlistsSlice";
import { adjustVolume, playTrack, startQueue, updatePlayback } from "./playlists/playlistPlaybackSlice";
import { addSoundboard, addSound } from "./soundboards/soundboardsSlice";
import { playSound, updatePlayback as updateSoundProgress } from "./soundboards/soundboardPlaybackSlice";

type Callback = (args: unknown[]) => void;

let listeners: Map<string, Callback[]>;
let player: Record<string, ReturnType<typeof vi.fn>>;

function receive(channel: string, ...args: unknown[]) {
  for (const callback of listeners.get(channel) ?? []) {
    callback(args);
  }
}

beforeEach(() => {
  listeners = new Map();
  player = {
    on: vi.fn((channel: string, callback: Callback) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), callback]);
    }),
    removeAllListeners: vi.fn((channel: string) => listeners.delete(channel)),
    playlistPlaybackReply: vi.fn(),
    playlistGetAllReply: vi.fn(),
    soundboardPlaybackReply: vi.fn(),
    soundboardGetAllReply: vi.fn(),
  };
  window.player = player as unknown as typeof window.player;
});

const track: Track = { id: "t1", url: "file:///t1.mp3", title: "Drums" };
const sound = { id: "s1", url: "file:///s1.ogg", title: "Thunder", loop: false, volume: 1, fadeIn: 0, fadeOut: 0 };

function newCallbacks() {
  return {
    onPlay: vi.fn<(track: Track) => void>(),
    onSeek: vi.fn<(to: number) => void>(),
    onNext: vi.fn<() => void>(),
    onPrevious: vi.fn<() => void>(),
    onPlaySound: vi.fn<(played: typeof sound) => void>(),
    onStopSound: vi.fn<(id: string) => void>(),
  };
}
type Callbacks = ReturnType<typeof newCallbacks>;

function Remotes({ c }: { c: Callbacks }) {
  return (
    <>
      <PlaylistRemote onPlay={c.onPlay} onSeek={c.onSeek} onNext={c.onNext} onPrevious={c.onPrevious} />
      <SoundboardRemote onPlay={c.onPlaySound} onStop={c.onStopSound} />
    </>
  );
}

function renderRemotes(store: PlayerStore, c = newCallbacks()) {
  const view = render(
    <Provider store={store}>
      <Remotes c={c} />
    </Provider>,
  );
  const rerender = (next: Callbacks) =>
    view.rerender(
      <Provider store={store}>
        <Remotes c={next} />
      </Provider>,
    );
  return { c, rerender, unmount: view.unmount };
}

function playingStore() {
  const store = createPlayerStore();
  store.dispatch(addPlaylist({ id: "p1", title: "Battle", background: "", tracks: [] }));
  store.dispatch(addTracks({ playlistId: "p1", tracks: [track] }));
  store.dispatch(addSoundboard({ id: "b1", title: "Storm", background: "", sounds: [] }));
  store.dispatch(addSound({ soundboardId: "b1", sound }));
  return store;
}

describe("remote listeners (PERF-1)", () => {
  it("are registered once, however often playback and the library change", () => {
    const store = playingStore();
    renderRemotes(store);
    const registered = player.on.mock.calls.length;

    act(() => {
      store.dispatch(startQueue({ tracks: ["t1"], trackId: "t1", playlistId: "p1" }));
      store.dispatch(playTrack({ track, duration: 120 }));
      store.dispatch(playSound({ sound, duration: 30 }));
    });
    for (let second = 1; second <= 60; second++) {
      act(() => {
        store.dispatch(updatePlayback(second));
        store.dispatch(updateSoundProgress([{ id: "s1", progress: second / 2 }]));
      });
    }
    act(() => {
      store.dispatch(adjustVolume(0.3));
      store.dispatch(addPlaylist({ id: "p2", title: "Calm", background: "", tracks: [] }));
    });

    expect(player.on.mock.calls.length - registered).toBe(0);
    expect(player.removeAllListeners).not.toHaveBeenCalled();
    // One listener per channel.
    for (const [channel, callbacks] of listeners) {
      expect(callbacks, channel).toHaveLength(1);
    }
  });

  it("answer with the current state", () => {
    const store = playingStore();
    renderRemotes(store);
    act(() => {
      store.dispatch(startQueue({ tracks: ["t1"], trackId: "t1", playlistId: "p1" }));
      store.dispatch(playTrack({ track, duration: 120 }));
      store.dispatch(updatePlayback(42));
      store.dispatch(adjustVolume(0.3));
      store.dispatch(playSound({ sound, duration: 30 }));
      store.dispatch(addPlaylist({ id: "p2", title: "Calm", background: "", tracks: [] }));
    });

    receive("PLAYER_REMOTE_PLAYLIST_PLAYBACK_REQUEST", 1);
    expect(player.playlistPlaybackReply).toHaveBeenCalledWith(
      expect.objectContaining({
        volume: 0.3,
        track: expect.objectContaining({ id: "t1", progress: 42, duration: 120 }),
        playlist: { id: "p1", title: "Battle" },
      }),
      1,
    );
    receive("PLAYER_REMOTE_PLAYLIST_GET_ALL_REQUEST", 2);
    expect(player.playlistGetAllReply.mock.calls[0][0].playlists).toHaveLength(2);
    receive("PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REQUEST", 3);
    expect(player.soundboardPlaybackReply).toHaveBeenCalledWith(
      { sounds: [expect.objectContaining({ id: "s1", duration: 30 })] },
      3,
    );
  });

  it("pause and seek use the current track; seek is clamped to its length", () => {
    const store = playingStore();
    const { c } = renderRemotes(store);
    receive("PLAYER_REMOTE_PLAYLIST_PLAYBACK_PAUSE");
    receive("PLAYER_REMOTE_PLAYLIST_PLAYBACK_SEEK", 10);
    expect(store.getState().playlistPlayback.playing).toBe(false);
    expect(c.onSeek).not.toHaveBeenCalled();

    act(() => {
      store.dispatch(playTrack({ track, duration: 120 }));
    });
    receive("PLAYER_REMOTE_PLAYLIST_PLAYBACK_SEEK", 500);
    expect(c.onSeek).toHaveBeenCalledWith(120);
    act(() => receive("PLAYER_REMOTE_PLAYLIST_PLAYBACK_PAUSE"));
    expect(store.getState().playlistPlayback.playing).toBe(false);
  });

  it("call the callbacks the player passes now, not the first ones", () => {
    const store = playingStore();
    const { rerender } = renderRemotes(store);
    const now = newCallbacks();
    rerender(now);

    act(() => {
      receive("PLAYER_REMOTE_PLAYLIST_PLAY", "t1");
      receive("PLAYER_REMOTE_PLAYLIST_PLAYBACK_NEXT");
      receive("PLAYER_REMOTE_PLAYLIST_PLAYBACK_PREVIOUS");
      receive("PLAYER_REMOTE_SOUNDBOARD_PLAY", "s1");
      receive("PLAYER_REMOTE_SOUNDBOARD_STOP", "s1");
    });

    expect(now.onPlay).toHaveBeenCalledWith(track);
    expect(now.onNext).toHaveBeenCalledTimes(1);
    expect(now.onPrevious).toHaveBeenCalledTimes(1);
    expect(now.onPlaySound).toHaveBeenCalledWith(sound);
    expect(now.onStopSound).toHaveBeenCalledWith("s1");
    expect(store.getState().playlistPlayback.queue?.playlistId).toBe("p1");
  });

  it("are removed when the player closes", () => {
    const store = playingStore();
    const { unmount } = renderRemotes(store);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
