/**
 * Test helpers for the pad board screens: the screen inside the providers the page gives it, on the in-memory
 * LyreApi seeded from the prototype and a silent FakeLyreAudio.
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { createFakeLyreApi, type FakeLyreApi, type FakeLyreOptions } from "../../../common/lyre/fake";
import { LyreApiProvider } from "../../api";
import { LyreAudioProvider } from "../../audio/LyreAudioProvider";
import { FakeLyreAudio } from "../../audio/testing/fakeLyreAudio";
import { AnnouncerProvider } from "../../shell/Announcer";
import { ShellSettingsProvider } from "../../shell/ShellSettings";
import { parseRoute } from "../../shell/routes";
import type { ScreenComponent } from "..";

export function renderScreen(Screen: ScreenComponent, path: string, options: FakeLyreOptions & { audio?: FakeLyreAudio } = {}) {
  const api: FakeLyreApi = createFakeLyreApi(options);
  const audio = options.audio ?? new FakeLyreAudio();
  const view = render(
    <LyreApiProvider api={api}>
      <LyreAudioProvider audio={audio}>
        <ShellSettingsProvider>
          <AnnouncerProvider>
            <main>
              <Screen route={parseRoute(path)} />
            </main>
          </AnnouncerProvider>
        </ShellSettingsProvider>
      </LyreAudioProvider>
    </LyreApiProvider>,
  );
  return { ...view, api, audio };
}

/** What the polite live region says now (the announcer fills it a moment after `say`). */
export async function spoken(): Promise<string> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  return document.getElementById("lyre-live")?.textContent ?? "";
}

/** The short note at the bottom of the page. */
export function toastText(): string {
  return document.getElementById("lyre-toast")?.textContent ?? "";
}
