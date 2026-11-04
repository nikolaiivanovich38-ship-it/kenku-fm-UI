/**
 * BUG-8: deleting the playing track from its Options menu stops it for good
 * and the player bar stops showing it. The player is wired as in App.tsx.
 */
import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeHowl } from "../../test/fakeHowler";
import { createPlayerStore, PlayerStore } from "../../test/createPlayerStore";
import { PlaylistPlayer } from "../player/PlaylistPlayer";
import { addPlaylist, addTracks, Track } from "./playlistsSlice";
import { startQueue } from "./playlistPlaybackSlice";
import { PlaylistPlaybackSync } from "./PlaylistPlaybackSync";
import { TrackItem } from "./TrackItem";
import { usePlaylistPlayback } from "./usePlaylistPlayback";

vi.mock("howler", () => import("../../test/fakeHowler"));

const tracks: Track[] = [
  { id: "a", url: "file:///a.mp3", title: "Tavern Brawl" },
  { id: "b", url: "file:///b.mp3", title: "Quiet Inn" },
];

function PlayerHarness({ store }: { store: PlayerStore }) {
  const playlist = usePlaylistPlayback(vi.fn());
  const state = store.getState().playlists;
  const current = state.playlists.byId.p;
  return (
    <>
      <ul>
        {current.tracks.map((id) => (
          <TrackItem
            key={id}
            track={state.tracks[id]}
            playlist={current}
            onPlay={(trackId) => {
              store.dispatch(startQueue({ tracks: [...current.tracks], trackId, playlistId: "p" }));
              playlist.play(store.getState().playlists.tracks[trackId]);
            }}
          />
        ))}
      </ul>
      <PlaylistPlayer
        onPlaylistNext={playlist.next}
        onPlaylistPrevious={playlist.previous}
        onPlaylistSeek={playlist.seek}
      />
      <PlaylistPlaybackSync
        onMute={playlist.mute}
        onPauseResume={playlist.pauseResume}
        onVolume={playlist.volume}
      />
    </>
  );
}

function renderPlayer() {
  const store = createPlayerStore();
  store.dispatch(addPlaylist({ id: "p", title: "Tavern", background: "", tracks: [] }));
  store.dispatch(addTracks({ playlistId: "p", tracks }));
  const view = render(
    <Provider store={store}>
      <PlayerHarness store={store} />
    </Provider>,
  );
  // The harness reads the library without subscribing; re-render after changes.
  const rerender = () =>
    view.rerender(
      <Provider store={store}>
        <PlayerHarness store={store} />
      </Provider>,
    );
  return { store, rerender };
}

beforeEach(() => {
  FakeHowl.reset();
});

describe("deleting the playing track from its menu (BUG-8)", () => {
  it("stops the track, unloads it and clears the player bar", async () => {
    const user = userEvent.setup();
    const { store, rerender } = renderPlayer();
    const row = screen.getByText("Tavern Brawl").closest("li")!;
    await user.click(within(row).getByRole("button", { name: "play" }));
    const howl = FakeHowl.latest;
    act(() => {
      howl.load(90);
      howl.startPlaying();
    });
    // The player bar shows the track and the playlist.
    expect(screen.getAllByText("Tavern Brawl")).toHaveLength(2);
    expect(screen.getByText("Tavern")).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Options for Tavern Brawl" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    rerender();

    expect(howl.unloaded).toBe(true);
    expect(store.getState().playlistPlayback.track).toBeUndefined();
    expect(screen.queryByText("Tavern Brawl")).not.toBeInTheDocument();
    expect(screen.queryByText("Tavern")).not.toBeInTheDocument();
    const transport = screen.getByRole("button", { name: "previous" }).parentElement!;
    expect(within(transport).getByRole("button", { name: "play" })).toBeDisabled();
  });
});
