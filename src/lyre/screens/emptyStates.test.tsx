/**
 * A first-time user's empty screens say what each screen is for and what to do first (w3-ux 9). The prototype's
 * words (design/prototype/src/views/*.js), against an empty library.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeLyreApi } from "../../common/lyre/fake";
import { prototypeSeed, type SeedData } from "../../common/lyre/seed";
import { AppProviders } from "../AppProviders";
import { FakeLyreAudio } from "../audio/testing/fakeLyreAudio";
import { Shell } from "../shell/Shell";
import { SCREENS } from ".";
import { resetLibraryState } from "./library/libraryState";
import { resetPlaylistsView } from "./library/PlaylistsScreen";

vi.mock("../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

function openEmpty(path: string) {
  resetLibraryState();
  resetPlaylistsView();
  window.history.replaceState(null, "", `#/${path}`);
  const seed: SeedData = { ...prototypeSeed(), tracks: [], playlists: [], boards: [], campaigns: [], overrides: {} };
  render(
    <AppProviders api={createFakeLyreApi({ seed })} audio={new FakeLyreAudio()}>
      <Shell screens={SCREENS} />
    </AppProviders>,
  );
  return within(screen.getByRole("main"));
}

beforeEach(() => localStorage.clear());

describe("empty screens for a first-time user", () => {
  it.each([
    ["campaigns", "No campaigns yet. A campaign holds your sessions, the scenes in each, and the music, ambience and pad boards you use in them. Start with New campaign."],
    ["playlists", "No playlists yet. A playlist is music, ambience or effects that play together, in your order or picked by their tags. Start with New playlist, or tick tracks in the Library and choose New playlist from these."],
    ["boards", "No pad boards yet. A pad board is a grid of buttons for sound effects you play during a game, each with its own key. Start with New board."],
    ["library", "Your library is empty. Add music, ambience and sound effects with Add tracks, or drop audio files or a folder here."],
  ])("%s says what it is for and what to do first", async (path, words) => {
    const main = openEmpty(path);
    expect(await main.findByText((_, el) => el?.classList.contains("empty") === true && el.textContent?.replace(/\s+/g, " ").trim() === words)).toBeInTheDocument();
    expect(main.queryByText(/match these filters/)).toBeNull();
  });
});
