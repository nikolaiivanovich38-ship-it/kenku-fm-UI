/**
 * Integration tests: dropping folders on the playlist and soundboard pages
 * adds the audio to the store, closes the overlay and tells the user what
 * happened (BUG-1, BUG-2, BUG-10, import summary).
 */
import React from "react";
import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import playlistsReducer from "./playlists/playlistsSlice";
import playlistPlaybackReducer from "./playlists/playlistPlaybackSlice";
import soundboardsReducer from "./soundboards/soundboardsSlice";
import soundboardPlaybackReducer from "./soundboards/soundboardPlaybackSlice";
import { Playlists } from "./playlists/Playlists";
import { Playlist } from "./playlists/Playlist";
import { Soundboards } from "./soundboards/Soundboards";
import { Soundboard } from "./soundboards/Soundboard";
import { NotificationProvider } from "../common/notifications";
import { installDragEventPolyfill } from "../common/testing/dragEventPolyfill";
import {
  entryFor,
  fakeDataTransfer,
  fakeDirectoryEntry,
} from "../common/testing/fakeDataTransfer";

// A fixed background list; the real one uses webpack's require.context, which Vitest lacks.
vi.mock("../backgrounds", () => ({
  backgrounds: { blank: "blank.png" },
  getRandomBackground: () => "blank",
  isBackground: (background: string) => background === "blank",
}));

function makeStore() {
  return configureStore({
    reducer: combineReducers({
      playlists: playlistsReducer,
      soundboards: soundboardsReducer,
      playlistPlayback: playlistPlaybackReducer,
      soundboardPlayback: soundboardPlaybackReducer,
    }),
  });
}

type TestStore = ReturnType<typeof makeStore>;

function renderAt(store: TestStore, path: string) {
  return render(
    <Provider store={store}>
      <NotificationProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="playlists" element={<Playlists onPlay={vi.fn()} />} />
            <Route path="playlists/:playlistId" element={<Playlist onPlay={vi.fn()} />} />
            <Route path="soundboards" element={<Soundboards onPlay={vi.fn()} />} />
            <Route
              path="soundboards/:soundboardId"
              element={<Soundboard onPlay={vi.fn()} onStop={vi.fn()} />}
            />
          </Routes>
        </MemoryRouter>
      </NotificationProvider>
    </Provider>
  );
}

/**
 * The notification with `role` and `text`. The page also has dnd-kit's empty
 * role="status" live region, so match on the text too.
 */
function findNotification(role: "status" | "alert", text: string | RegExp) {
  return screen.findByRole(role, {
    name: (_, element) =>
      typeof text === "string"
        ? element.textContent?.includes(text) ?? false
        : text.test(element.textContent ?? ""),
  });
}

function tracks(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => entryFor(`${prefix} ${i}.mp3`, "audio/mpeg"));
}

function dropOnPage(heading: string, entries: FileSystemEntry[]) {
  const dataTransfer = fakeDataTransfer({ entries });
  fireEvent.dragEnter(screen.getByRole("heading", { name: heading }), { dataTransfer });
  const overlay = screen.getByText(/^Drop the .* here/).parentElement as HTMLElement;
  fireEvent.drop(overlay, { dataTransfer });
}

beforeAll(() => {
  installDragEventPolyfill();
});

beforeEach(() => {
  window.player = {
    getPathForFile: (file: File) => `/music/${file.name}`,
  } as unknown as typeof window.player;
});

describe("Playlists page folder drop", () => {
  it("makes a playlist per folder, keeps nesting and reports the result", async () => {
    const store = makeStore();
    renderAt(store, "/playlists");
    const combat = fakeDirectoryEntry("Combat", [
      ...tracks("fight", 200),
      entryFor("cover.jpg", "image/jpeg"),
    ]);
    const town = fakeDirectoryEntry("Town", [
      ...tracks("street", 40),
      fakeDirectoryEntry("Tavern", [...tracks("tavern", 2), entryFor("bard.m4a", "audio/x-m4a")]),
    ]);

    dropOnPage("Playlists", [combat, town]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Added 243 tracks to 3 playlists. Skipped 1 file that isn't audio (cover.jpg)."
    );
    expect(screen.queryByText("Drop the playlists here...")).not.toBeVisible();
    const { playlists } = store.getState().playlists;
    const titles = playlists.allIds.map((id) => playlists.byId[id].title);
    expect(titles).toEqual(["Combat", "Town", "Tavern"]);
    expect(playlists.allIds.map((id) => playlists.byId[id].tracks.length)).toEqual([200, 40, 3]);
  });

  it("explains that loose files need a folder", async () => {
    const store = makeStore();
    renderAt(store, "/playlists");
    dropOnPage("Playlists", tracks("loose", 2));
    expect(await findNotification("status", /drop a folder of audio files/)).toBeInTheDocument();
    expect(store.getState().playlists.playlists.allIds).toHaveLength(0);
  });

  it("reports a folder that cannot be read and closes the overlay", async () => {
    const store = makeStore();
    renderAt(store, "/playlists");
    dropOnPage("Playlists", [fakeDirectoryEntry("Locked", [], { failRead: true })]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't read the folder 'Locked'. Try adding the files with the + button instead."
    );
    expect(screen.queryByText("Drop the playlists here...")).not.toBeVisible();
  });
});

describe("Playlist page folder drop", () => {
  it("adds every track, including nested folders, to the open playlist", async () => {
    const store = makeStore();
    store.dispatch({
      type: "playlists/addPlaylist",
      payload: { id: "p1", title: "Session", background: "", tracks: [] },
    });
    renderAt(store, "/playlists/p1");
    dropOnPage("Session", [
      fakeDirectoryEntry("Big", [...tracks("t", 150), fakeDirectoryEntry("More", tracks("m", 100))]),
    ]);
    expect(await findNotification("status", "Added 250 tracks to the playlist.")).toBeInTheDocument();
    expect(store.getState().playlists.playlists.byId.p1.tracks).toHaveLength(250);
  });
});

describe("Soundboards page folder drop", () => {
  it("makes a soundboard per folder", async () => {
    const store = makeStore();
    renderAt(store, "/soundboards");
    dropOnPage("Soundboards", [fakeDirectoryEntry("Doors", tracks("door", 3))]);
    expect(await findNotification("status", "Added 3 sounds to 1 soundboard.")).toBeInTheDocument();
    const { soundboards } = store.getState().soundboards;
    expect(soundboards.allIds.map((id) => soundboards.byId[id].title)).toEqual(["Doors"]);
  });
});

describe("Soundboard page folder drop", () => {
  it("adds sounds to the open soundboard with default settings", async () => {
    const store = makeStore();
    store.dispatch({
      type: "soundboards/addSoundboard",
      payload: { id: "s1", title: "Weather", background: "", sounds: [] },
    });
    renderAt(store, "/soundboards/s1");
    dropOnPage("Weather", [entryFor("rain.flac", "")]);
    await waitFor(() =>
      expect(store.getState().soundboards.soundboards.byId.s1.sounds).toHaveLength(1)
    );
    const id = store.getState().soundboards.soundboards.byId.s1.sounds[0];
    expect(store.getState().soundboards.sounds[id]).toMatchObject({
      url: "file:///music/rain.flac",
      title: "Rain",
      loop: false,
      volume: 1,
    });
    expect(await findNotification("status", "Added 1 sound to the soundboard.")).toBeInTheDocument();
  });
});
