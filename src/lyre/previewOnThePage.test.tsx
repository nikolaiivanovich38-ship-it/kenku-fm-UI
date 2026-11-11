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

  it("Preview plays the track as its audio profile says: The Thin Red Line's track from its Start, 0:08, fading in (Nik, 0.5.0)", async () => {
    const { sound } = await openPage("library/t02");
    await userEvent.click(details().getByRole("button", { name: "Preview" }));
    await playOn(sound, 0.5);
    expect(sound.audio.getNowPlaying().preview?.key).toBe("t02");
    expect(sound.audio.getNowPlaying().preview!.position!).toBeGreaterThanOrEqual(8);
    // Its fade in is 3 s long.
    expect(sound.hearPreview()).toBeGreaterThan(0);
    expect(sound.hearPreview()).toBeLessThan(0.5);
  });
});

describe("the time on the Now playing bar and in Live's On air (Nik, 0.5.0: it stayed at 0:00 until Pause)", () => {
  const bar = () => within(screen.getByRole("region", { name: "Now playing" }));
  const progressOf = (box: HTMLElement) => box.querySelector<HTMLElement>(".progress > span")!.style.width;
  const timeOf = (box: HTMLElement, selector = ".num") => box.querySelector(selector)!.textContent;

  /**
   * The progress line moves in each of three 0.3 s spans in a row: a redraw every 250 ms lands in each, a redraw once a
   * second in one at most.
   */
  async function movesEveryQuarterSecond(sound: Awaited<ReturnType<typeof openPage>>["sound"], box: () => HTMLElement) {
    for (let i = 0; i < 3; i++) {
      const before = progressOf(box());
      await playOn(sound, 0.3);
      expect(progressOf(box()), `span ${i + 1}`).not.toBe(before);
    }
  }

  it("the preview's row moves on while it plays, with nothing else happening", async () => {
    const { sound } = await openPage("library/t13");
    await userEvent.click(details().getByRole("button", { name: "Preview" }));
    await playOn(sound, 1);
    const row = () => bar().getByRole("group", { name: /^Only you/ });
    expect(timeOf(row())).toMatch(/ \/ 5:00$/);
    await movesEveryQuarterSecond(sound, row);
    const before = timeOf(row());
    await playOn(sound, 1);
    expect(timeOf(row())).not.toBe(before);
  });

  it("music on air moves on in the bar's room row, and in Live's On air box", async () => {
    const { sound } = await openPage("library/t13");
    await userEvent.click(details().getByRole("button", { name: "Play on air" }));
    await playOn(sound, 4);
    const row = () => bar().getByRole("group", { name: /^On air/ });
    await movesEveryQuarterSecond(sound, row);
    act(() => {
      window.location.hash = "#/live";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await screen.findByRole("heading", { level: 1, name: /Live/ });
    const box = () => screen.getAllByRole("region", { name: /^On air/ })[0];
    await movesEveryQuarterSecond(sound, box);
    const before = timeOf(box(), ".lv-time");
    await playOn(sound, 1);
    expect(timeOf(box(), ".lv-time")).not.toBe(before);
  });
});
