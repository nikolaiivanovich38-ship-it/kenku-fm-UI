/** What Settings keeps must work from the start, wherever Lyre is: the preview's device and the global keys. */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createFakeLyreApi } from "../../common/lyre/fake";
import { GLOBAL_KEY_EVENT, type GlobalKeyAction, type GlobalKeysRequest } from "../../common/globalKeys";
import { LyreApiProvider } from "../api";
import { LyreAudioProvider } from "../audio/LyreAudioProvider";
import { FakeLyreAudio } from "../audio/testing/fakeLyreAudio";
import type { LyreKeysBridge } from "../keys/preloadKeys";
import { SettingsAppliers, useGlobalKeyRefusals } from "./SettingsAppliers";

function fakeKeys(refused: { action: GlobalKeyAction; key: string; message: string }[] = []) {
  let press: ((action: GlobalKeyAction) => void) | null = null;
  const keys: LyreKeysBridge & { asked: GlobalKeysRequest[] } = {
    asked: [],
    setGlobal: vi.fn(async (request: GlobalKeysRequest) => {
      keys.asked.push(request);
      return { refused: request.on ? refused : [] };
    }),
    onGlobal: (listener) => {
      press = listener;
      return () => {
        press = null;
      };
    },
  };
  return { keys, press: (action: GlobalKeyAction) => press?.(action) };
}

function Refusals() {
  const refused = useGlobalKeyRefusals();
  return <p data-testid="refused">{refused.map((r) => r.message).join("|")}</p>;
}

function setup(keys: LyreKeysBridge | null) {
  const api = createFakeLyreApi();
  const audio = new FakeLyreAudio();
  const view = render(
    <LyreApiProvider api={api}>
      <LyreAudioProvider audio={audio}>
        <SettingsAppliers keys={keys}>
          <Refusals />
        </SettingsAppliers>
      </LyreAudioProvider>
    </LyreApiProvider>,
  );
  return { api, audio, view };
}

describe("SettingsAppliers", () => {
  it("gives the audio host this computer's devices after each change, and nothing while they are the defaults (PRV-2)", async () => {
    const { api, audio } = setup(null);
    // Left as they are, the preview already plays on the default device in both ears: asking again would only make
    // Chromium switch the device over for nothing (and say so in the capture window's console).
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))));
    expect(audio.calls.some(([m]) => m === "setAudioDevices")).toBe(false);
    await act(async () => void (await api.settings.setComputer({ devices: { split: true, previewEar: "right" } })));
    await waitFor(() => expect(audio.calls).toContainEqual(["setAudioDevices", expect.objectContaining({ split: true, previewEar: "right" })]));
  });

  it("asks the main process for no global keys while the switch is off, and for Next scene's and Fade everything out's keys once on (UX-12)", async () => {
    const { keys } = fakeKeys();
    const { api } = setup(keys);
    await waitFor(() => expect(keys.asked).toEqual([{ on: false, keys: { nextScene: "Space", fadeAll: "Shift+Esc" } }]));
    await act(async () => void (await api.settings.setShortcut("nextScene", "F9")));
    await act(async () => void (await api.settings.setComputer({ globalKeys: true })));
    await waitFor(() => expect(keys.asked[keys.asked.length - 1]).toEqual({ on: true, keys: { nextScene: "F9", fadeAll: "Shift+Esc" } }));
  });

  it("keeps the main process's refusals for Settings to show", async () => {
    const { keys } = fakeKeys([{ action: "fadeAll", key: "Shift+Esc", message: "Another program already uses Shift+Esc everywhere." }]);
    const { api, view } = setup(keys);
    await act(async () => void (await api.settings.setComputer({ globalKeys: true })));
    await waitFor(() => expect(view.getByTestId("refused")).toHaveTextContent("Another program already uses Shift+Esc everywhere."));
  });

  it("says so when the main process could not be asked to register the keys, instead of failing silently (w51-fix2)", async () => {
    const { keys } = fakeKeys();
    keys.setGlobal = vi.fn(async (request: GlobalKeysRequest) => {
      if (request.on) throw new Error("Lyre did not answer. Try again.");
      return { refused: [] };
    });
    const { api, view } = setup(keys);
    await act(async () => void (await api.settings.setShortcut("nextScene", "F9")));
    await act(async () => void (await api.settings.setComputer({ globalKeys: true })));
    await waitFor(() =>
      expect(view.getByTestId("refused")).toHaveTextContent(
        "Lyre could not take F9 from other programs, so Next scene works only in Lyre for now. Turn this off and on again to try once more.",
      ),
    );
    expect(view.getByTestId("refused")).toHaveTextContent("Lyre could not take Shift+Esc from other programs");
    await act(async () => void (await api.settings.setComputer({ globalKeys: false })));
    await waitFor(() => expect(view.getByTestId("refused")).toHaveTextContent(/^$/));
  });

  it("a press passes to the page as an event Live can take; Fade everything out fades on any screen when nobody took it", async () => {
    const { keys, press } = fakeKeys();
    const { audio } = setup(keys);
    await waitFor(() => expect(keys.asked.length).toBeGreaterThan(0));
    const heard: string[] = [];
    const take = (event: Event) => {
      heard.push((event as CustomEvent<{ action: string }>).detail.action);
      event.preventDefault();
    };
    window.addEventListener(GLOBAL_KEY_EVENT, take);
    act(() => press("nextScene"));
    act(() => press("fadeAll"));
    window.removeEventListener(GLOBAL_KEY_EVENT, take);
    expect(heard).toEqual(["nextScene", "fadeAll"]);
    expect(audio.calls.some(([m]) => m === "fadeAll")).toBe(false);
    act(() => press("fadeAll"));
    expect(audio.calls.filter(([m]) => m === "fadeAll")).toHaveLength(1);
  });

  it("Next scene's key pressed in Lyre on another screen, with the switch off, opens Live to start the next scene, if it is not a typing key (w51-fix2)", async () => {
    const { keys } = fakeKeys();
    const { api } = setup(keys);
    await act(async () => void (await api.settings.setShortcut("nextScene", "F9")));
    await waitFor(() => expect(keys.asked[keys.asked.length - 1]).toEqual({ on: false, keys: { nextScene: "F9", fadeAll: "Shift+Esc" } }));
    window.history.replaceState(null, "", "#/settings");
    fireEvent.keyDown(document.body, { key: "F9" });
    expect(window.location.hash).toBe("#/live");

    // Live's own keys take it there; a key typed in a box, and a single key such as Space, open nothing.
    window.history.replaceState(null, "", "#/settings");
    const box = document.body.appendChild(document.createElement("input"));
    fireEvent.keyDown(box, { key: "F9" });
    box.remove();
    expect(window.location.hash).toBe("#/settings");
    await act(async () => void (await api.settings.setShortcut("nextScene", "Space")));
    await waitFor(() => expect(keys.asked[keys.asked.length - 1]?.keys.nextScene).toBe("Space"));
    fireEvent.keyDown(document.body, { key: " " });
    expect(window.location.hash).toBe("#/settings");
  });
});
