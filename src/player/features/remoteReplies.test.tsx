/**
 * PERF-9: the player answers each remote API question with the request id it
 * was asked with, so the main process can match answers to requests.
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { Provider } from "react-redux";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPlayerStore } from "../test/createPlayerStore";
import { PlaylistRemote } from "./playlists/PlaylistRemote";
import { SoundboardRemote } from "./soundboards/SoundboardRemote";
import { addSoundboard } from "./soundboards/soundboardsSlice";
import { addPlaylist } from "./playlists/playlistsSlice";

type Callback = (args: unknown[]) => void;

let listeners: Map<string, Callback[]>;
let player: Record<string, ReturnType<typeof vi.fn>>;

/** Deliver a message from the main process to every listener on `channel`. */
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

function renderRemotes() {
  const store = createPlayerStore();
  render(
    <Provider store={store}>
      <PlaylistRemote onPlay={vi.fn()} onSeek={vi.fn()} onNext={vi.fn()} onPrevious={vi.fn()} />
      <SoundboardRemote onPlay={vi.fn()} onStop={vi.fn()} />
    </Provider>,
  );
  return store;
}

describe("player remote replies carry the request id (PERF-9)", () => {
  it("answers the playlist questions with the id it was asked with", () => {
    renderRemotes();
    receive("PLAYER_REMOTE_PLAYLIST_GET_ALL_REQUEST", 11);
    receive("PLAYER_REMOTE_PLAYLIST_PLAYBACK_REQUEST", 12);
    expect(player.playlistGetAllReply).toHaveBeenCalledWith({ playlists: [], tracks: [] }, 11);
    expect(player.playlistPlaybackReply).toHaveBeenCalledWith(
      expect.objectContaining({ playing: false }),
      12,
    );
  });

  it("answers the soundboard questions with the id it was asked with", () => {
    renderRemotes();
    receive("PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REQUEST", 21);
    receive("PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REQUEST", 22);
    expect(player.soundboardGetAllReply).toHaveBeenCalledWith({ soundboards: [], sounds: [] }, 21);
    expect(player.soundboardPlaybackReply).toHaveBeenCalledWith({ sounds: [] }, 22);
  });

  it("answers once, with current soundboards, after soundboards change", () => {
    const store = renderRemotes();
    act(() => {
      store.dispatch(addSoundboard({ id: "s1", title: "Combat", background: "", sounds: [] }));
    });
    receive("PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REQUEST", 31);
    expect(player.soundboardGetAllReply).toHaveBeenCalledTimes(1);
    expect(player.soundboardGetAllReply).toHaveBeenCalledWith(
      { soundboards: [expect.objectContaining({ id: "s1" })], sounds: [] },
      31,
    );
  });

  it("answers once, with current playlists, after playlists change", () => {
    const store = renderRemotes();
    act(() => {
      store.dispatch(addPlaylist({ id: "p1", title: "Tavern", background: "", tracks: [] }));
    });
    receive("PLAYER_REMOTE_PLAYLIST_GET_ALL_REQUEST", 41);
    expect(player.playlistGetAllReply).toHaveBeenCalledTimes(1);
    expect(player.playlistGetAllReply).toHaveBeenCalledWith(
      { playlists: [expect.objectContaining({ id: "p1" })], tracks: [] },
      41,
    );
  });
});
