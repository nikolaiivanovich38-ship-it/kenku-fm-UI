/**
 * Nik's test of 0.5.0 (11 Nov): the preview from a track's details and the Now playing bar, on the whole page
 * (providers, shell, every screen's own audio host with its name, ScreenSound) over the in-memory LyreApi and the real
 * audio host on the engine's fake audio graph.
 */
import React from "react";
import { act, render, screen, within } from "@testing-library/react";
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
  await screen.findByRole("heading", { level: 1 });
  return { api, sound };
}

/** Let the fake graph play on, then let React catch up. */
async function playOn(sound: Awaited<ReturnType<typeof openPage>>["sound"], seconds: number) {
  await act(async () => {
    await sound.advance(seconds);
  });
}

const details = () => within(screen.getByRole("region", { name: "Details" }));

describe("Preview in a track's details", () => {
  it("Stop preview stops it, and the button is Preview again (Nik, 0.5.0: it started the track again)", async () => {
    const { sound } = await openPage("library/t13");
    await userEvent.click(details().getByRole("button", { name: "Preview" }));
    await playOn(sound, 2);
    expect(sound.audio.getNowPlaying().preview?.key).toBe("t13");
    await userEvent.click(details().getByRole("button", { name: "Stop preview" }));
    await playOn(sound, 2);
    expect(sound.audio.getNowPlaying().preview).toBeNull();
    expect(sound.hearPreview()).toBe(0);
    expect(details().getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "false");
  });
});
