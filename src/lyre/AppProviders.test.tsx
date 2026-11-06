/**
 * The page root's providers (wave 3 wiring): the library API, the audio host fed with the library as it is now,
 * the campaigns' table themes for the shell, and a plain message while the library is down.
 */
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
import { loadInLive } from "./kit/liveSession";
import { FakeOutputs } from "./outputs/testing/fakeOutputs";

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

  describe("the Now playing bar at the foot of every screen (UX-16, core.js onAirBar)", () => {
    const quiet = { ...SCREENS, campaigns: () => <PlaceholderScreen title="Campaigns" />, library: () => <PlaceholderScreen title="Library" /> };
    const lane = (trackId: string, title: string) => ({ trackId, title, origin: { kind: "single" as const }, playlistId: null as string | null, position: 0, length: 200, paused: false, loading: false });
    const playing = (audio: FakeLyreAudio) =>
      act(() =>
        audio.setNowPlaying({
          rooms: [
            { roomId: "table", name: "Table", music: lane("t13", "Bridge of Death"), ambience: lane("t40", "Rain on the roof"), upNext: null, queued: [], effects: [{ trackId: "t60", title: "Thunder", padKey: null }] },
            { roomId: "side", name: "Side room", music: null, ambience: null, upNext: null, queued: [], effects: [{ trackId: "t61", title: "Door", padKey: null }] },
          ],
          preview: { key: "t02", label: "Wistful", from: "the Library" },
        }),
      );

    it("is hidden while nothing plays, and shows each room that plays and the preview, with Stop and Go to Live", async () => {
      window.history.replaceState(null, "", "#/library");
      const audio = new FakeLyreAudio();
      render(
        <AppProviders api={createFakeLyreApi()} audio={audio}>
          <Shell screens={quiet} />
        </AppProviders>,
      );
      expect(screen.queryByRole("region", { name: "Now playing" })).toBeNull();
      playing(audio);
      const bar = screen.getByRole("region", { name: "Now playing" });
      expect(bar).toHaveTextContent("Bridge of Death");
      expect(bar).toHaveTextContent("Ambience: Rain on the roof");
      expect(bar).toHaveTextContent("1 effect sounding");
      // The Side room plays only an effect, so it has no row.
      expect(within(bar).getAllByRole("group", { name: /^On air/ })).toHaveLength(1);
      expect(within(bar).getByRole("group", { name: "Only you" })).toHaveTextContent("Previewed from the Library");
      expect(screen.getByRole("link", { name: "Go to Live" })).toHaveAttribute("href", "#/live");
      await userEvent.click(within(bar).getByRole("button", { name: "Stop" }));
      expect(audio.calls).toContainEqual(["stopLane", "music", { target: { room: "table" }, fadeMs: 1000 }]);
    });

    it("on a Live screen that shows the rooms itself, has the preview row only", () => {
      window.history.replaceState(null, "", "#/live");
      const audio = new FakeLyreAudio();
      const Live = Object.assign(() => <PlaceholderScreen title="Live" />, { showsOnAir: true });
      render(
        <AppProviders api={createFakeLyreApi()} audio={audio}>
          <Shell screens={{ ...quiet, live: Live }} />
        </AppProviders>,
      );
      playing(audio);
      const bar = screen.getByRole("region", { name: "Now playing" });
      expect(within(bar).queryByRole("group", { name: /^On air/ })).toBeNull();
      expect(within(bar).getByRole("group", { name: "Only you" })).toBeInTheDocument();
    });

    it("the Live screen shows the rooms itself, so the bar there has no On air row (UX-16)", () => {
      expect(SCREENS.live.showsOnAir).toBe(true);
    });

    it("previews started on a screen say which screen (UX-16)", async () => {
      window.history.replaceState(null, "", "#/library");
      const audio = new FakeLyreAudio();
      const Library = () => {
        const sound = useLyreAudio();
        return <button type="button" onClick={() => sound.previewTrack("t13")}>Preview it</button>;
      };
      render(
        <AppProviders api={createFakeLyreApi()} audio={audio}>
          <Shell screens={{ ...quiet, library: Library }} />
        </AppProviders>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Preview it" }));
      expect(audio.calls).toContainEqual(["previewTrack", "t13", { from: "the Library" }]);
    });
  });

  describe("the Discord bots (w4-outputs)", () => {
    it("counts on the rail's Outputs link the bots connected in a voice channel, and follows a join", async () => {
      window.history.replaceState(null, "", "#/campaigns");
      const outputs = new FakeOutputs();
      render(
        <AppProviders api={createFakeLyreApi()} audio={new FakeLyreAudio()} outputs={outputs}>
          <Shell screens={{ ...SCREENS, campaigns: () => <PlaceholderScreen title="Campaigns" /> }} />
        </AppProviders>,
      );
      expect(await screen.findByRole("link", { name: "Outputs (1/2)" })).toHaveAttribute("href", "#/outputs");
      act(() => outputs.move(outputs.state.bots[1].id, "1012"));
      await act(() => outputs.settle());
      expect(screen.getByRole("link", { name: "Outputs (2/2)" })).toBeInTheDocument();
    });
  });

  describe("the session loaded in Live, in the rail and the theme (core.js railHTML)", () => {
    const quiet = { ...SCREENS, campaigns: () => <PlaceholderScreen title="Campaigns" />, library: () => <PlaceholderScreen title="Library" /> };

    it("names the loaded session on the rail's Live link, follows a change, and gives Live that campaign's theme", async () => {
      loadInLive(null);
      window.history.replaceState(null, "", "#/live");
      // A stand-in Live: the real one loads a session as soon as it opens, which is not what this checks.
      const Live = () => <PlaceholderScreen title="Live" />;
      render(
        <AppProviders api={createFakeLyreApi()} audio={new FakeLyreAudio()}>
          <Shell screens={{ ...quiet, live: Live }} />
        </AppProviders>,
      );
      const nav = await screen.findByRole("navigation", { name: "Lyre" });
      expect(nav).toHaveTextContent(/Live$|LiveOutputs/);
      act(() => loadInLive({ campaignId: "crown", sessionId: "s14" }));
      // Seen as "Live: S14", read as "Live: session 14" (review w3-polish 11).
      const live = await screen.findByRole("link", { name: "Live: session 14" });
      expect(live).toHaveAttribute("href", "#/live");
      expect(live).toHaveTextContent("Live: S14");
      await waitFor(() => expect(document.documentElement.dataset.theme).toBe("hearth"));
      act(() => loadInLive({ campaignId: "crown", sessionId: "s12" }));
      expect(await screen.findByRole("link", { name: "Live: session 12" })).toBeInTheDocument();
      act(() => loadInLive(null));
      expect(await screen.findByRole("link", { name: "Live" })).toBeInTheDocument();
    });
  });

  describe("the sound's messages, heard once for the whole page", () => {
    it("says the audio host's announcements in the live region and shows its errors as a toast, on any screen", async () => {
      window.history.replaceState(null, "", "#/outputs");
      const audio = new FakeLyreAudio();
      render(
        <AppProviders api={createFakeLyreApi()} audio={audio}>
          <Shell screens={SCREENS} />
        </AppProviders>,
      );
      await screen.findByRole("heading", { level: 1 });
      expect(audio.listenerCount("announce")).toBe(1);
      expect(audio.listenerCount("error")).toBe(1);
      act(() => {
        audio.emit("announce", "Music: Tavern");
      });
      await waitFor(() => expect(document.getElementById("lyre-live")).toHaveTextContent("Music: Tavern"));
      act(() => {
        audio.emit("error", "That track is no longer in the library.");
      });
      expect(document.getElementById("lyre-toast")).toHaveTextContent("That track is no longer in the library.");
    });

    it.each(["library", "playlists", "boards", "campaign/crown", "session/crown/s14"])("%s does not listen a second time", async (path) => {
      window.history.replaceState(null, "", `#/${path}`);
      const audio = new FakeLyreAudio();
      render(
        <AppProviders api={createFakeLyreApi()} audio={audio}>
          <Shell screens={SCREENS} />
        </AppProviders>,
      );
      await screen.findByRole("heading", { level: 1 });
      expect(audio.listenerCount("announce")).toBe(1);
      expect(audio.listenerCount("error")).toBe(1);
    });
  });
});
