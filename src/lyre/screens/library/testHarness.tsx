/**
 * Component-test set-up for the Library and Playlists screens: the real shell (routes, focus, announcements) with the
 * in-memory LyreApi seeded from the prototype and a silent FakeLyreAudio.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { createFakeLyreApi, type FakeLyreApi, type FakeLyreOptions } from "../../../common/lyre/fake";
import { AppProviders } from "../../AppProviders";
import { FakeLyreAudio } from "../../audio/testing/fakeLyreAudio";
import { SCREENS } from "../index";
import { Shell } from "../../shell/Shell";
import { resetLibraryState } from "./libraryState";
import { LibraryScreen } from "./LibraryScreen";
import { PlaylistScreen, PlaylistsScreen, resetPlaylistsView } from "./PlaylistsScreen";
import { resetDrops } from "./playlistDrops";

export interface Harness {
  api: FakeLyreApi;
  audio: FakeLyreAudio;
}

/** Opens the page at a route ("library", "library/t44", "playlist/p-abbess") with these screens built. */
export function openAt(path: string, options: FakeLyreOptions = {}): Harness {
  resetLibraryState();
  resetPlaylistsView();
  resetDrops();
  localStorage.clear();
  window.history.replaceState(null, "", `#/${path}`);
  const api = createFakeLyreApi({ now: () => Date.UTC(2026, 10, 5, 12), ...options });
  const audio = new FakeLyreAudio();
  render(
    <AppProviders api={api} audio={audio}>
      <Shell screens={{ ...SCREENS, library: LibraryScreen, playlists: PlaylistsScreen, playlist: PlaylistScreen }} />
    </AppProviders>,
  );
  return { api, audio };
}

/** Moves to another route as a link would. */
export function go(path: string): void {
  act(() => {
    window.location.hash = `#/${path}`;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

/** Drops files with these names on an element, as the browser does (enter, over, drop). */
/**
 * Drop files from the computer as the browser does: the drop happens only when the dragover was taken (cancelled) and
 * left a drop effect other than "none" (w51-fix2: the page's drop guard used to turn it to "none" after the Library
 * took it, so the browser never dropped). Answers whether the drop happened.
 */
export function dropNames(target: Element, names: string[]): boolean {
  const files = names.map((n) => new File(["x"], n, { type: "audio/flac" }));
  const dataTransfer = { files, types: ["Files"], items: files.map((f) => ({ kind: "file", getAsFile: () => f })), dropEffect: "copy" };
  fireEvent.dragEnter(target, { dataTransfer });
  const taken = !fireEvent.dragOver(target, { dataTransfer });
  if (!taken || dataTransfer.dropEffect === "none") return false;
  fireEvent.drop(target, { dataTransfer });
  return true;
}
