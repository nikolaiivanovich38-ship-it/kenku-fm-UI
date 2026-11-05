/**
 * The page root's providers (wave 3 wiring): the library API, the audio host fed with the library as it is now,
 * the campaigns' table themes for the shell, and a plain message while the library is down.
 */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createFakeLyreApi } from "../common/lyre/fake";
import type { LyreApi, LyreEvent } from "../common/lyre/api";
import { AppProviders } from "./AppProviders";
import { useLyreApi } from "./api";
import { useLyreAudio } from "./audio";
import { FakeLyreAudio } from "./audio/testing/fakeLyreAudio";
import type { LyreAudioLibrary } from "./audio/lyreAudio";
import { useShellData } from "./shell/ShellData";
import { Shell } from "./shell/Shell";
import { SCREENS } from "./screens";
import { PlaceholderScreen } from "./screens/Placeholder";
import userEvent from "@testing-library/user-event";

// The page root can start the real audio host, whose worklet file is a webpack asset; tests give a fake host.
vi.mock("../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

function Probe() {
  const api = useLyreApi();
  const audio = useLyreAudio();
  const { campaignTheme } = useShellData();
  return (
    <p>
      {api ? "api" : ""} {audio ? "audio" : ""} theme:{campaignTheme?.("crown") ?? "none"}
    </p>
  );
}

/** The fake, plus a way to send events as the main process would. */
function apiWithEvents() {
  const api = createFakeLyreApi();
  const extra = new Set<(e: LyreEvent) => void>();
  const wrapped: LyreApi = {
    ...api,
    subscribe: (listener) => {
      extra.add(listener);
      const stop = api.subscribe(listener);
      return () => {
        extra.delete(listener);
        stop();
      };
    },
  };
  return { api: wrapped, fake: api, send: (e: LyreEvent) => extra.forEach((l) => l(e)) };
}

describe("AppProviders", () => {
  it("gives screens the library, the sound and each campaign's table theme", async () => {
    const audio = new FakeLyreAudio();
    render(
      <AppProviders api={createFakeLyreApi()} audio={audio}>
        <Probe />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByText(/theme:hearth/)).toBeInTheDocument());
    expect(screen.getByText(/api audio/)).toBeInTheDocument();
  });

  it("hands the audio host the library, and the library again after each change", async () => {
    const audio = new FakeLyreAudio();
    const libraries: LyreAudioLibrary[] = [];
    const host = audio as unknown as { setLibrary(library: LyreAudioLibrary): void };
    vi.spyOn(host, "setLibrary").mockImplementation((library: LyreAudioLibrary): void => void libraries.push(library));
    const { api, fake } = apiWithEvents();
    render(
      <AppProviders api={api} audio={audio}>
        <Probe />
      </AppProviders>,
    );
    await waitFor(() => expect(libraries.length).toBeGreaterThan(0));
    expect(libraries[0].track("t13")?.metaTitle).toBe("Bridge of Death");
    const before = libraries.length;
    await act(async () => {
      await fake.library.updateTrack("t13", { title: "Bridge" });
    });
    await waitFor(() => expect(libraries.length).toBeGreaterThan(before));
    expect(libraries[libraries.length - 1].track("t13")?.title).toBe("Bridge");
  });

  it("says plainly while the library is down, and stops when it is back", async () => {
    const { api, send } = apiWithEvents();
    render(
      <AppProviders api={api} audio={new FakeLyreAudio()}>
        <Probe />
      </AppProviders>,
    );
    act(() => send({ type: "library-status", ok: false, message: "Lyre's library stopped unexpectedly and is starting again." }));
    expect(screen.getByRole("alert")).toHaveTextContent("Lyre's library stopped unexpectedly and is starting again.");
    act(() => send({ type: "library-status", ok: true, message: "Lyre's library is working again." }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Lyre's library is working again.");
  });

  describe("the on-air bar: what the players hear, outside Live (core.js onAirBar)", () => {
    const quiet = { ...SCREENS, campaigns: () => <PlaceholderScreen title="Campaigns" />, library: () => <PlaceholderScreen title="Library" /> };
    const lane = (trackId: string, title: string) => ({ trackId, title, origin: "single" as never, playlistId: null as string | null, position: 0, length: 200, paused: false, loading: false });
    const playing = (audio: FakeLyreAudio) =>
      act(() =>
        audio.setNowPlaying({
          rooms: [
            { roomId: "table", name: "Table", music: lane("t13", "Bridge of Death"), ambience: lane("t40", "Rain on the roof"), upNext: null, queued: [], effects: [{ trackId: "t60", title: "Thunder", padKey: null }] },
            { roomId: "side", name: "Side room", music: null, ambience: null, upNext: null, queued: [], effects: [{ trackId: "t61", title: "Door", padKey: null }] },
          ],
        }),
      );

    it("is hidden while nothing plays, and shows music, ambience and effects with Stop and Go to Live", async () => {
      window.history.replaceState(null, "", "#/library");
      const audio = new FakeLyreAudio();
      render(
        <AppProviders api={createFakeLyreApi()} audio={audio}>
          <Shell screens={quiet} />
        </AppProviders>,
      );
      expect(screen.queryByRole("region", { name: "On air" })).toBeNull();
      playing(audio);
      const bar = screen.getByRole("region", { name: "On air" });
      expect(bar).toHaveTextContent("Bridge of Death");
      expect(bar).toHaveTextContent("Rain on the roof");
      expect(bar).toHaveTextContent("2 effects");
      expect(screen.getByRole("link", { name: "Go to Live" })).toHaveAttribute("href", "#/live");
      await userEvent.click(screen.getByRole("button", { name: "Stop" }));
      expect(audio.calls).toContainEqual(["fadeAll", 1000]);
    });

    it("is not shown on Live, which shows the rooms itself", () => {
      window.history.replaceState(null, "", "#/live");
      const audio = new FakeLyreAudio();
      render(
        <AppProviders api={createFakeLyreApi()} audio={audio}>
          <Shell screens={quiet} />
        </AppProviders>,
      );
      playing(audio);
      expect(screen.queryByRole("region", { name: "On air" })).toBeNull();
    });
  });
});
