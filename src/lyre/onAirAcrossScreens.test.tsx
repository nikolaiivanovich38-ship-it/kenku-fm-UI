/**
 * BUG-12 and BUG-13: what plays is the page's, not a screen's. Preparing (adding, moving or removing anything in a
 * scene) never stops or restarts what is on air or in preview, and music keeps playing, with the On air bar, on every
 * screen until it is stopped. The whole page (providers, shell, every screen) over the in-memory LyreApi and the real
 * audio host on the engine's fake audio graph.
 */
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { createFakeLyreApi } from "../common/lyre/fake";
import { AppProviders } from "./AppProviders";
import { lyreAudioOnFakes } from "./audio/testing/onFakes";
import { loadInLive } from "./kit/liveSession";
import { SCREENS } from "./screens";
import { Shell } from "./shell/Shell";

beforeEach(() => {
  localStorage.clear();
  loadInLive(null);
});

async function openPage(path: string) {
  const api = createFakeLyreApi();
  const sound = lyreAudioOnFakes({ tracks: [], playlists: [], campaigns: [] });
  // Every library file is five minutes long on the fake graph.
  for (const track of await api.library.listTracks()) {
    if (track.url) {
      sound.context.mediaDurations.set(track.url, 300);
      sound.previewContext.mediaDurations.set(track.url, 300);
    }
  }
  window.history.replaceState(null, "", `#/${path}`);
  render(
    <AppProviders api={api} audio={sound.audio}>
      <Shell screens={SCREENS} />
    </AppProviders>,
  );
  return { api, sound };
}

function go(path: string) {
  act(() => {
    window.location.hash = `#/${path}`;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

const abbey = () => within(screen.getByRole("listitem", { name: /^Scene \d+: The abbey ruins$/ }));
const musicList = () => within(abbey().getByRole("list", { name: "Music in order" }));
const onAirBar = () => screen.queryByRole("region", { name: "On air" });

/** Let the fake graph play on for a while (fades, loading), then let React catch up. */
async function playOn(sound: Awaited<ReturnType<typeof openPage>>["sound"], seconds = 4) {
  await act(async () => {
    await sound.advance(seconds);
  });
}

describe("what plays belongs to the page, not to a screen", () => {
  it("adding, moving and removing in a scene leaves the music on air and the preview playing (BUG-12)", async () => {
    const { sound } = await openPage("session/crown/s14");
    await userEvent.click(await screen.findByRole("button", { name: "Scene 3: The abbey ruins" }));
    await userEvent.click(musicList().getByRole("button", { name: "Play on air: The Abbess" }));
    await userEvent.click(musicList().getByRole("button", { name: /^Preview Haunted sea shanty/ }));
    await playOn(sound);
    const onAir = sound.audio.getNowPlaying().rooms[0].music;
    const preview = sound.audio.getNowPlaying().preview;
    expect(onAir).not.toBeNull();
    expect(preview).not.toBeNull();
    expect(sound.hearRoom("table")).toBeGreaterThan(0);

    // Add a track through the picker.
    await userEvent.click(abbey().getByRole("button", { name: "Add tracks or playlists…" }));
    const sheet = within(screen.getByRole("dialog"));
    await userEvent.click(sheet.getByRole("checkbox", { name: /^Quiet grief, solo voice/ }));
    await userEvent.click(sheet.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(musicList().getAllByRole("listitem")).toHaveLength(5));
    await playOn(sound, 1);
    // Move one to the start.
    await userEvent.click(musicList().getByRole("button", { name: /^More for Quiet grief/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Start the scene with it" }));
    await playOn(sound, 1);
    // Remove one.
    await userEvent.click(musicList().getByRole("button", { name: "More for Quiet grief, solo voice - a fallen companion" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove from this scene" }));
    await waitFor(() => expect(musicList().getAllByRole("listitem")).toHaveLength(4));
    await playOn(sound);

    const now = sound.audio.getNowPlaying();
    expect(now.rooms[0].music).toMatchObject({ trackId: onAir!.trackId, paused: false });
    expect(now.rooms[0].music!.position).toBeGreaterThan(onAir!.position ?? 0);
    expect(now.preview?.key).toBe(preview!.key);
    expect(sound.hearRoom("table")).toBeGreaterThan(0);
    expect(sound.hearPreview()).toBeGreaterThan(0);
    expect(onAirBar()).toBeInTheDocument();
  });

  it.each([
    ["the Library", "library/t13", () => screen.findByRole("button", { name: "Play on air" })],
    ["the Audio profile, in a scene", "profile/t13/sc:crown:s14:sc3", () => screen.findByRole("button", { name: "Play on air" })],
    ["a playlist", "playlists", async () => (await screen.findAllByRole("button", { name: "Play on air: The Company themes" }))[0]],
    ["the session planner", "session/crown/s14", async () => (await screen.findAllByRole("button", { name: /^Play on air: Wistful/ }))[0]],
  ])("music started from %s keeps playing on the other screens", async (_where, path, button) => {
    const { sound } = await openPage(path);
    await userEvent.click(await button());
    await playOn(sound);
    const started = sound.audio.getNowPlaying().rooms[0].music;
    expect(started).not.toBeNull();
    for (const next of ["boards", "campaign/crown", "live", "profile/t02", "library"]) {
      go(next);
      await screen.findByRole("heading", { level: 1 });
      await playOn(sound, 2);
      expect(sound.audio.getNowPlaying().rooms[0].music, `music on ${next}`).toMatchObject({ trackId: started!.trackId, paused: false });
      expect(onAirBar(), `bar on ${next}`).toBeInTheDocument();
    }
  });

  it("music started on one screen keeps playing, with the On air bar, on every other screen until Stop (BUG-13)", async () => {
    const { sound } = await openPage("library/t13");
    await userEvent.click(await screen.findByRole("button", { name: "Play on air" }));
    await playOn(sound);
    const started = sound.audio.getNowPlaying().rooms[0].music;
    expect(started).not.toBeNull();
    for (const path of ["boards", "board/abbey", "playlists", "campaigns", "campaign/crown", "session/crown/s14", "profile/t13", "look", "live", "outputs", "library"]) {
      go(path);
      await screen.findByRole("heading", { level: 1 });
      await playOn(sound, 2);
      expect(sound.audio.getNowPlaying().rooms[0].music, `music on ${path}`).toMatchObject({ trackId: started!.trackId, paused: false });
      expect(sound.hearRoom("table"), `sound on ${path}`).toBeGreaterThan(0);
      expect(within(onAirBar()!).getByText(started!.title), `bar on ${path}`).toBeInTheDocument();
    }
    await userEvent.click(within(onAirBar()!).getByRole("button", { name: "Stop everything on air" }));
    await playOn(sound, 3);
    expect(sound.audio.getNowPlaying().rooms[0].music).toBeNull();
    expect(onAirBar()).not.toBeInTheDocument();
  });
});
