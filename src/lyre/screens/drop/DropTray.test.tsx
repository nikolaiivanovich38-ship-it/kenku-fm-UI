/**
 * The drop tray's document listeners (ORG-5) with the page's drop guard (SEC-7) installed, as in src/lyre/index.tsx.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeLyreApi } from "../../../common/lyre/fake";
import { installDocumentDropGuard } from "../../../common/security/dragGuard";
import { LyreApiProvider } from "../../api";
import { LyreAudioProvider } from "../../audio/LyreAudioProvider";
import { FakeLyreAudio } from "../../audio/testing/fakeLyreAudio";
import { AnnouncerProvider } from "../../shell/Announcer";
import { ShellSettingsProvider } from "../../shell/ShellSettings";
import { DropTray } from "./DropTray";

let removeGuard: () => void;
beforeEach(() => {
  removeGuard = installDocumentDropGuard(document);
});
afterEach(() => removeGuard());

function renderTray() {
  return render(
    <LyreApiProvider api={createFakeLyreApi()}>
      <LyreAudioProvider audio={new FakeLyreAudio()}>
        <ShellSettingsProvider>
          <AnnouncerProvider>
            <main>
              <div draggable data-track="t1">
                A track
              </div>
              <p>Somewhere else on the page</p>
            </main>
            <DropTray resolve={(el) => (el.dataset.track ? { ids: [el.dataset.track], from: null } : null)} />
          </AnnouncerProvider>
        </ShellSettingsProvider>
      </LyreAudioProvider>
    </LyreApiProvider>,
  );
}

describe("the drop tray and the page's drop guard (SEC-7)", () => {
  it("CR-8 (review 0.5.0): after Esc, a file dragged over the page still cannot be dropped there", async () => {
    const view = renderTray();
    fireEvent.dragStart(view.getByText("A track"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    fireEvent.keyDown(document.body, { key: "Escape" });
    const dataTransfer = { types: ["Files"], dropEffect: "copy" };
    const allowed = fireEvent.dragOver(view.getByText("Somewhere else on the page"), { dataTransfer });
    // The browser's own handling (open the file in the page) is prevented, and the pointer says "no drop".
    expect(allowed).toBe(false);
    expect(dataTransfer.dropEffect).toBe("none");
  });
});

/*
 * 29 (Nik's play test, 14 Nov): "With music playing, clicking to drag a track from the library tracks pane into the pop
 * up add to playlists pane crashed the interface." The whole page (providers, shell, the Library) over the in-memory
 * library and the real audio host on the fake audio graph, with music on air and a preview playing.
 */
describe("29: dragging Library rows onto the Drop on panel while music plays", () => {
  it("each drop lands (a playlist, Up next, a scene), the music and the preview play on, and nothing fails", async () => {
    const { AppProviders } = await import("../../AppProviders");
    const { lyreAudioOnFakes } = await import("../../audio/testing/onFakes");
    const { SCREENS } = await import("../index");
    const { Shell } = await import("../../shell/Shell");
    const { screen, within, waitFor } = await import("@testing-library/react");
    const failures: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => failures.push(args.map(String).join(" "));
    try {
      const api = createFakeLyreApi();
      const sound = lyreAudioOnFakes({ tracks: [], playlists: [], campaigns: [] });
      for (const track of await api.library.listTracks()) {
        if (track.url) {
          sound.context.mediaDurations.set(track.url, 300);
          sound.previewContext.mediaDurations.set(track.url, 300);
        }
      }
      const playlists = await api.playlists.list();
      const abbess = playlists.find((p) => p.name === "The Abbess")!;
      const company = playlists.find((p) => p.name === "The Company themes")!;
      window.history.replaceState(null, "", "#/library");
      render(
        <AppProviders api={api} audio={sound.audio}>
          <Shell screens={SCREENS} />
        </AppProviders>,
      );
      await screen.findByRole("checkbox", { name: "Select Ashes" });
      sound.audio.playPlaylist(abbess.id);
      sound.audio.previewPlaylist(company.id);
      await act(async () => void (await sound.advance(2)));
      const rowOf = (title: string) => screen.getByRole("checkbox", { name: `Select ${title}` }).closest("tr") as HTMLElement;
      for (const [title, place] of [
        ["Ashes", "The Abbess"],
        ["Memories of Mother", "Up next in Table"],
        ["Ashes", "Greyhollow inn"],
      ] as const) {
        fireEvent.dragStart(rowOf(title));
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
        const target = within(screen.getByRole("region", { name: "Drop on" })).getByRole("button", { name: place === "Greyhollow inn" ? "Greyhollow inn, scene" : place });
        fireEvent.dragOver(target);
        fireEvent.drop(target);
        fireEvent.dragEnd(rowOf(title));
        await act(async () => void (await sound.advance(0.5)));
      }
      await waitFor(async () => expect((await api.playlists.list()).find((p) => p.id === abbess.id)).toMatchObject({ trackIds: expect.arrayContaining([expect.any(String)]) }));
      expect(screen.queryByText(/went wrong/)).toBeNull();
      expect(sound.audio.getNowPlaying().rooms[0].music).not.toBeNull();
      expect(sound.audio.getNowPlaying().preview).not.toBeNull();
      expect(sound.audio.getNowPlaying().rooms[0].upNextList.some((e) => e.kind === "added")).toBe(true);
      expect(failures).toEqual([]);
    } finally {
      console.error = original;
    }
  });
});
